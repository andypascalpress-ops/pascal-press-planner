/**
 * GET /api/bc-abandoned-carts?days=30
 * Analyses BigCommerce Incomplete orders (abandoned carts) for the given rolling window.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

function bcHeaders() {
  return { 'X-Auth-Token': ACCESS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' };
}

const COMPLETED_STATUSES = new Set([
  'Completed', 'Shipped', 'Partially Shipped', 'Awaiting Fulfillment',
  'Awaiting Shipment', 'Awaiting Pickup', 'Pending',
]);

interface BCOrder {
  id: number;
  status: string;
  total_inc_tax: string;
  customer_id: number;
  date_created: string;
  referral_source: string;
  billing_address: { email: string };
}

interface BCLineItem {
  name: string;
  sku: string;
  quantity: number;
  price_inc_tax: string;
}

function toAESTDateStr(d: Date) {
  return new Date(d.getTime() + 10 * 3600000).toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bcDateParam(dateStr: string, endOfDay = false) {
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = MONTHS[mon! - 1]!;
  return encodeURIComponent(`${dow}, ${dd} ${mmm} ${year} ${endOfDay ? '23:59:59' : '00:00:00'} +1000`);
}

async function fetchOrdersWithStatus(status: string, start: string, end: string): Promise<BCOrder[]> {
  const results: BCOrder[] = [];
  let page = 1;
  while (true) {
    const url = `${BC_BASE}/orders?status_id=${status}&min_date_created=${bcDateParam(start)}&max_date_created=${bcDateParam(end, true)}&limit=250&page=${page}`;
    const res = await fetch(url, { headers: bcHeaders() });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BC orders -> ${res.status}`);
    const data: BCOrder[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 250) break;
    page++;
  }
  return results;
}

async function fetchLineItems(orderId: number): Promise<BCLineItem[]> {
  const res = await fetch(`${BC_BASE}/orders/${orderId}/products`, { headers: bcHeaders() });
  if (!res.ok || res.status === 204) return [];
  return res.json();
}

export async function GET(request: Request) {
  if (!STORE_HASH || !ACCESS_TOKEN) return NextResponse.json({ connected: false });

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') ?? '30'), 90);

  try {
    const today = toAESTDateStr(new Date());
    const start = addDays(today, -(days - 1));

    // Fetch incomplete (abandoned) orders — status_id 0
    const abandoned = await fetchOrdersWithStatus('0', start, today);

    // JS post-filter to exact AEST date range (BC date filter unreliable for sub-month)
    const inRange = abandoned.filter(o => {
      const d = toAESTDateStr(new Date(o.date_created));
      return d >= start && d <= today;
    });

    const totalCarts = inRange.length;
    const totalValue = inRange.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);
    const avgValue   = totalCarts > 0 ? totalValue / totalCarts : 0;

    // Cart value buckets
    const buckets = { under20: 0, t20_50: 0, t50_100: 0, t100_200: 0, over200: 0 };
    for (const o of inRange) {
      const v = parseFloat(o.total_inc_tax || '0');
      if      (v < 20)  buckets.under20++;
      else if (v < 50)  buckets.t20_50++;
      else if (v < 100) buckets.t50_100++;
      else if (v < 200) buckets.t100_200++;
      else              buckets.over200++;
    }

    // Guest vs registered
    const guestCount      = inRange.filter(o => o.customer_id === 0).length;
    const registeredCount = inRange.length - guestCount;

    // Top abandoned products (fetch line items for up to 60 orders)
    const sample = inRange.slice(0, 60);
    const lineItemResults = await Promise.allSettled(sample.map(o => fetchLineItems(o.id)));
    const productMap = new Map<string, { units: number; carts: number; value: number }>();
    lineItemResults.forEach(r => {
      if (r.status !== 'fulfilled') return;
      for (const item of r.value) {
        const key = (item.name ?? item.sku ?? 'Unknown').trim();
        const qty = Number(item.quantity ?? 0);
        const val = Number(item.price_inc_tax ?? 0) * qty;
        const existing = productMap.get(key);
        if (!existing) productMap.set(key, { units: qty, carts: 1, value: val });
        else { existing.units += qty; existing.carts += 1; existing.value += val; }
      }
    });

    const topProducts = [...productMap.entries()]
      .map(([name, m]) => ({ name, ...m, value: Math.round(m.value * 100) / 100 }))
      .sort((a, b) => b.carts - a.carts)
      .slice(0, 20);

    // Referral source breakdown
    const sourceMap = new Map<string, number>();
    for (const o of inRange) {
      const ref = (o.referral_source ?? '').trim();
      let label = 'Direct / Unknown';
      if (ref.includes('googleadservices')) label = 'Google Ads';
      else if (ref.includes('google'))      label = 'Google Organic';
      else if (ref.includes('facebook') || ref.includes('instagram')) label = 'Social';
      else if (ref.includes('email') || ref.includes('hubspot'))      label = 'Email';
      else if (ref.length > 0)              label = 'Other Referral';
      sourceMap.set(label, (sourceMap.get(label) ?? 0) + 1);
    }
    const sources = [...sourceMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      connected: true,
      days,
      start,
      today,
      totalCarts,
      totalValue: Math.round(totalValue * 100) / 100,
      avgValue:   Math.round(avgValue   * 100) / 100,
      buckets,
      guestCount,
      registeredCount,
      topProducts,
      sources,
    });

  } catch (e) {
    console.error('[bc-abandoned-carts]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
