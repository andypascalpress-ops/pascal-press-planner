/**
 * Coupon code usage for Excel Test Zone and Blake Education over a date range, so campaign revenue can be summarised.
 *
 *  - Excel Test Zone: every succeeded Stripe charge carries the code the parent entered in its metadata
 *    (`coupon_code`). Revenue is net of refunds, the same rule as the rest of the planner.
 *  - Blake Education: BigCommerce orders that had a coupon discount, with each code read from the order's coupons.
 *    Revenue is the order total including GST, the same rule as the rest of the planner.
 *
 * Only codes and totals are returned: no customer details leave this file (the Stripe metadata also holds an
 * email, which is deliberately never read into the result).
 */
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

export interface CouponRow {
  code: string;
  orders: number;
  /** Revenue from the orders that used this code (after the discount). */
  revenue: number;
  /** Dollars of discount given by this code (Blake only; null for Excel Test Zone). */
  discount: number | null;
}

export interface CouponUsage {
  brand: 'etz' | 'blake';
  start: string;
  end: string;
  rows: CouponRow[];
  totalOrders: number;
  totalRevenue: number;
  couponOrders: number;
  couponRevenue: number;
  note: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function finish(brand: 'etz' | 'blake', start: string, end: string, map: Map<string, CouponRow>, totalOrders: number, totalRevenue: number, couponOrders: number, couponRevenue: number, note: string): CouponUsage {
  const rows = [...map.values()]
    .map(r => ({ ...r, revenue: round2(r.revenue), discount: r.discount === null ? null : round2(r.discount) }))
    .sort((a, b) => b.revenue - a.revenue);
  return { brand, start, end, rows, totalOrders, totalRevenue: round2(totalRevenue), couponOrders, couponRevenue: round2(couponRevenue), note };
}

// ---------------------------------------------------------------- Excel Test Zone (Stripe)

export async function fetchEtzCouponUsage(start: string, end: string): Promise<CouponUsage> {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key) throw new Error('Stripe is not configured for Excel Test Zone');
  const gte = zonedDateTimeToUnix(start, '00:00:00');
  const lte = zonedDateTimeToUnix(end, '23:59:59');

  const map = new Map<string, CouponRow>();
  let totalOrders = 0, totalRevenue = 0, couponOrders = 0, couponRevenue = 0;
  let startingAfter: string | undefined;

  for (let page = 0; page < 60; page++) {
    const params = new URLSearchParams({ limit: '100', 'created[gte]': String(gte), 'created[lte]': String(lte) });
    if (startingAfter) params.set('starting_after', startingAfter);
    let json: { data: { id: string; amount: number; amount_refunded: number; paid: boolean; status: string; metadata?: Record<string, string> }[]; has_more: boolean } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      if (res.ok) { json = await res.json(); break; }
      if (res.status !== 429 && res.status < 500) throw new Error(`Stripe charges error (${res.status})`);
      await sleep(400 * 2 ** attempt);
    }
    if (!json) throw new Error('Stripe charges could not be read');
    for (const c of json.data) {
      if (!c.paid || c.status !== 'succeeded') continue;
      const net = ((c.amount ?? 0) - (c.amount_refunded ?? 0)) / 100;
      if (net <= 0) continue;
      totalOrders += 1; totalRevenue += net;
      const code = (c.metadata?.coupon_code ?? '').trim().toUpperCase();
      if (!code) continue;
      couponOrders += 1; couponRevenue += net;
      const row = map.get(code) ?? { code, orders: 0, revenue: 0, discount: null };
      row.orders += 1; row.revenue += net;
      map.set(code, row);
    }
    if (!json.has_more || json.data.length === 0) break;
    startingAfter = json.data[json.data.length - 1]!.id;
  }
  return finish('etz', start, end, map, totalOrders, totalRevenue, couponOrders, couponRevenue,
    'Codes come from the coupon recorded on each Stripe payment. Revenue is after the discount and net of refunds.');
}

// ---------------------------------------------------------------- Blake Education (BigCommerce)

interface BCOrderLite { id: number; status: string; total_inc_tax: string; coupon_discount?: string; discount_amount?: string; date_created: string }

const EXCLUDED = new Set(['Cancelled', 'Refunded', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required']);

const sydneyYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });

export async function fetchBlakeCouponUsage(start: string, end: string): Promise<CouponUsage> {
  const hash = process.env.BIGCOMMERCE_BLAKE_STORE_HASH ?? '';
  const token = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';
  if (!hash || !token) throw new Error('BigCommerce is not configured for Blake Education');
  const base = `https://api.bigcommerce.com/stores/${hash}/v2`;
  const headers = { 'X-Auth-Token': token, Accept: 'application/json' };

  const startISO = new Date(zonedDateTimeToUnix(start, '00:00:00') * 1000).toISOString();
  const endISO = new Date(zonedDateTimeToUnix(end, '23:59:59') * 1000).toISOString();
  const orders: BCOrderLite[] = [];
  for (let page = 1; page <= 40; page++) {
    const qs = new URLSearchParams({ min_date_created: startISO, max_date_created: endISO, limit: '250', page: String(page) });
    const res = await fetch(`${base}/orders?${qs}`, { headers, cache: 'no-store' });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BigCommerce orders error (${res.status})`);
    const data = await res.json() as BCOrderLite[];
    if (!Array.isArray(data) || data.length === 0) break;
    orders.push(...data);
    if (data.length < 250) break;
  }

  const valid = orders.filter(o => {
    const d = sydneyYmd.format(new Date(o.date_created));
    return d >= start && d <= end && !EXCLUDED.has(o.status);
  });
  let totalRevenue = 0;
  for (const o of valid) totalRevenue += parseFloat(o.total_inc_tax || '0');

  // only orders that actually had a coupon discount need their coupon list read
  const withCoupon = valid.filter(o => parseFloat(o.coupon_discount || '0') > 0);
  const map = new Map<string, CouponRow>();
  let couponOrders = 0, couponRevenue = 0, failed = 0;
  const BATCH = 15;
  for (let i = 0; i < withCoupon.length; i += BATCH) {
    const batch = withCoupon.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async o => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`${base}/orders/${o.id}/coupons`, { headers, cache: 'no-store' });
        if (res.ok) return await res.json() as { code?: string; discount?: string | number }[];
        if (res.status === 204 || res.status === 404) return [];
        if (res.status !== 429 && res.status < 500) break;
        await sleep(400 * 2 ** attempt);
      }
      failed += 1;
      return null;
    }));
    results.forEach((coupons, k) => {
      const o = batch[k]!;
      if (!Array.isArray(coupons) || coupons.length === 0) return;
      const revenue = parseFloat(o.total_inc_tax || '0');
      couponOrders += 1; couponRevenue += revenue;
      for (const c of coupons) {
        const code = (c.code ?? '').trim().toUpperCase();
        if (!code) continue;
        const row = map.get(code) ?? { code, orders: 0, revenue: 0, discount: 0 };
        row.orders += 1; row.revenue += revenue; row.discount = (row.discount ?? 0) + (parseFloat(String(c.discount ?? '0')) || 0);
        map.set(code, row);
      }
    });
  }
  return finish('blake', start, end, map, valid.length, totalRevenue, couponOrders, couponRevenue,
    'Codes come from each BigCommerce order. Revenue is the order total including GST. An order that used two codes appears under both.'
      + (failed > 0 ? ` ${failed} orders could not be read and are missing.` : ''));
}
