/**
 * GET /api/bc-product-yoy?range=30d|60d|90d|mtd|lastmonth
 *
 * Returns top/bottom 30 products by revenue for the selected period vs same period last year.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

function bcHeaders() {
  return { 'X-Auth-Token': ACCESS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' };
}

const EXCLUDED = new Set([
  'Cancelled', 'Refunded', 'Declined', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required',
]);

interface BCOrder    { id: number; total_inc_tax: string; status: string; date_created: string; }
interface BCLineItem { name: string; sku: string; quantity: number; price_inc_tax: string; }

export interface ProductMetrics { revenue: number; orders: number; units: number; aov: number; }
export interface ProductRow {
  name:          string;
  current:       ProductMetrics;
  lastYear:      ProductMetrics;
  yoyRevenuePct: number | null;
  yoyOrdersPct:  number | null;
  yoyUnitsPct:   number | null;
}

function yoyPct(curr: number, ly: number): number | null {
  if (ly === 0) return null;
  return Math.round(((curr - ly) / ly) * 1000) / 10;
}

function toAESTDateStr(d: Date): string {
  const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  return aest.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** BigCommerce v2 requires RFC 2822 format for date filter params */
function bcDateParam(dateStr: string, endOfDay = false): string {
  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  // Use UTC noon to reliably get the correct day-of-week for the given calendar date
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = MONTHS[mon! - 1]!;
  const rfc = `${dow}, ${dd} ${mmm} ${year} ${endOfDay ? '23:59:59' : '00:00:00'} +1000`;
  return encodeURIComponent(rfc);
}

/** Parse BC's RFC 2822 date_created and return YYYY-MM-DD in AEST */
function orderDateAEST(bcDateCreated: string): string {
  return toAESTDateStr(new Date(bcDateCreated));
}

/** Last day of month as YYYY-MM-DD */
function lastDayOfMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return new Date(y!, m!, 0).toISOString().split('T')[0]!;
}

/** Advance a YYYY-MM string by one month */
function nextMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return m! === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`;
}

/** Fetch all pages of orders for a single calendar month using BC month-level filter */
async function fetchMonthOrders(yearMon: string): Promise<BCOrder[]> {
  const results: BCOrder[] = [];
  const start = `${yearMon}-01`;
  const end   = lastDayOfMonth(yearMon);
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({
      min_date_created: bcDateParam(start),
      max_date_created: bcDateParam(end, true),
      limit: '250', page: String(page),
    });
    const res = await fetch(`${BC_BASE}/orders?${qs}`, { headers: bcHeaders() });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BigCommerce /orders -> ${res.status}`);
    const data: BCOrder[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 250) break;
    page++;
  }
  return results;
}

type RangeKey = '30d' | '60d' | '90d' | 'mtd' | 'lastmonth';

function deriveRanges(range: RangeKey, today: string): {
  currStart: string; currEnd: string; lyStart: string; lyEnd: string; label: string;
} {
  const year = parseInt(today.slice(0, 4));
  const mon  = parseInt(today.slice(5, 7));

  if (range === 'mtd') {
    const currStart = `${year}-${String(mon).padStart(2, '0')}-01`;
    const lyStart   = `${year - 1}-${String(mon).padStart(2, '0')}-01`;
    const lyEnd     = `${year - 1}-${today.slice(5)}`;
    return { currStart, currEnd: today, lyStart, lyEnd, label: 'Month to date' };
  }

  if (range === 'lastmonth') {
    const lm = mon === 1 ? 12 : mon - 1;
    const ly = mon === 1 ? year - 1 : year;
    const daysInLm = new Date(year, lm, 0).getDate();
    const currStart = `${ly}-${String(lm).padStart(2, '0')}-01`;
    const currEnd   = `${ly}-${String(lm).padStart(2, '0')}-${String(daysInLm).padStart(2, '0')}`;
    const lyStart   = `${ly - 1}-${String(lm).padStart(2, '0')}-01`;
    const lyEnd     = `${ly - 1}-${String(lm).padStart(2, '0')}-${String(daysInLm).padStart(2, '0')}`;
    const monthName = new Date(`${currStart}T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
    return { currStart, currEnd, lyStart, lyEnd, label: monthName };
  }

  const days = range === '30d' ? 30 : range === '60d' ? 60 : 90;
  const currStart = addDays(today, -(days - 1));
  const lyStart   = addDays(currStart, -365);
  const lyEnd     = addDays(today,    -365);
  return { currStart, currEnd: today, lyStart, lyEnd, label: `Last ${days} days` };
}

async function fetchProductsForPeriod(start: string, end: string): Promise<Map<string, ProductMetrics>> {
  // Fetch month-level orders (BC's sub-day date filter is unreliable), then JS post-filter
  const startMonth = start.slice(0, 7);
  const endMonth   = end.slice(0, 7);
  let allOrders: BCOrder[] = [];
  let cur = startMonth;
  while (cur <= endMonth) {
    const mo = await fetchMonthOrders(cur);
    allOrders.push(...mo);
    cur = nextMonth(cur);
  }
  // Filter to exact date range using AEST date parsed from each order's date_created
  const filtered = allOrders.filter(o => {
    const d = orderDateAEST(o.date_created);
    return d >= start && d <= end;
  });
  const valid = filtered.filter(o => !EXCLUDED.has(o.status));

  const lineItemResults = await Promise.allSettled(
    valid.slice(0, 40).map(o =>
      fetch(`${BC_BASE}/orders/${o.id}/products`, { headers: bcHeaders() })
        .then(r => (r.ok && r.status !== 204) ? r.json() as Promise<BCLineItem[]> : []),
    ),
  );

  const map = new Map<string, ProductMetrics>();
  lineItemResults.forEach((result, idx) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
    if (!valid[idx]?.id) return;
    for (const item of result.value) {
      const key = (item.name ?? item.sku ?? 'Unknown').trim();
      const qty = Number(item.quantity ?? 0);
      const rev = Number(item.price_inc_tax ?? 0) * qty;
      const existing = map.get(key);
      if (!existing) { map.set(key, { revenue: rev, orders: 1, units: qty, aov: 0 }); }
      else { existing.revenue += rev; existing.orders += 1; existing.units += qty; }
    }
  });
  for (const [, m] of map) {
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.aov = m.orders > 0 ? Math.round((m.revenue / m.orders) * 100) / 100 : 0;
  }
  return map;
}

function fmtLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function GET(request: Request) {
  if (!STORE_HASH || !ACCESS_TOKEN) return NextResponse.json({ connected: false });

  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') ?? '30d') as RangeKey;

  try {
    const today = toAESTDateStr(new Date());
    const { currStart, currEnd, lyStart, lyEnd, label } = deriveRanges(range, today);

    const [currentMap, lyMap] = await Promise.all([
      fetchProductsForPeriod(currStart, currEnd),
      fetchProductsForPeriod(lyStart,  lyEnd),
    ]);

    const allNames = new Set([...currentMap.keys(), ...lyMap.keys()]);
    const empty: ProductMetrics = { revenue: 0, orders: 0, units: 0, aov: 0 };

    const rows: ProductRow[] = [];
    for (const name of allNames) {
      const curr = currentMap.get(name) ?? { ...empty };
      const ly   = lyMap.get(name)      ?? { ...empty };
      rows.push({
        name, current: curr, lastYear: ly,
        yoyRevenuePct: yoyPct(curr.revenue, ly.revenue),
        yoyOrdersPct:  yoyPct(curr.orders,  ly.orders),
        yoyUnitsPct:   yoyPct(curr.units,   ly.units),
      });
    }

    const byRevDesc      = [...rows].sort((a, b) => b.current.revenue - a.current.revenue);
    const topProducts    = byRevDesc.slice(0, 30);
    const bottomProducts = [...rows]
      .filter(r => r.current.revenue > 0 || r.current.units > 0)
      .sort((a, b) => a.current.revenue - b.current.revenue)
      .slice(0, 30);

    return NextResponse.json({
      connected: true,
      rangeLabel:   label,
      currentLabel: `${fmtLabel(currStart)} – ${fmtLabel(currEnd)}`,
      lyLabel:      `${fmtLabel(lyStart)} – ${fmtLabel(lyEnd)}`,
      topProducts,
      bottomProducts,
    });

  } catch (e) {
    console.error('[bc-product-yoy]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
