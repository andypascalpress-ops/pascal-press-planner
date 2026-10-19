/**
 * Blake Education PDF downloads for any date range, with a comparison period.
 *
 * "Downloads" are digital product purchases: the quantity of each product on valid BigCommerce orders (the same
 * definition as the Downloads leaderboard on the Blake tab). The subscription product (1072) is a subscription,
 * not a PDF, so it is left out of downloads and reported separately.
 */
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

const SUBSCRIPTION_PRODUCT_ID = 1072;
const EXCLUDED = new Set(['Cancelled', 'Refunded', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required']);
const sydneyYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DownloadProduct { productId: number; name: string; downloads: number; orders: number; revenue: number }
export interface DownloadsPeriod {
  start: string;
  end: string;
  /** Units of PDF products downloaded (subscription excluded). */
  downloads: number;
  /** Orders that contained at least one PDF product. */
  orders: number;
  /** Subscriptions started (product 1072). */
  subscriptions: number;
  products: DownloadProduct[];
  /** Orders whose lines could not be read (should be 0). */
  failedOrders: number;
}

async function fetchPeriod(start: string, end: string): Promise<DownloadsPeriod> {
  const hash = process.env.BIGCOMMERCE_BLAKE_STORE_HASH ?? '';
  const token = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';
  if (!hash || !token) throw new Error('BigCommerce is not configured for Blake Education');
  const base = `https://api.bigcommerce.com/stores/${hash}/v2`;
  const headers = { 'X-Auth-Token': token, Accept: 'application/json' };

  const startISO = new Date(zonedDateTimeToUnix(start, '00:00:00') * 1000).toISOString();
  const endISO = new Date(zonedDateTimeToUnix(end, '23:59:59') * 1000).toISOString();
  const orders: { id: number; status: string; date_created: string }[] = [];
  for (let page = 1; page <= 40; page++) {
    const qs = new URLSearchParams({ min_date_created: startISO, max_date_created: endISO, limit: '250', page: String(page) });
    const res = await fetch(`${base}/orders?${qs}`, { headers, cache: 'no-store' });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BigCommerce orders error (${res.status})`);
    const data = await res.json() as typeof orders;
    if (!Array.isArray(data) || data.length === 0) break;
    orders.push(...data);
    if (data.length < 250) break;
  }
  const valid = orders.filter(o => {
    const d = sydneyYmd.format(new Date(o.date_created));
    return d >= start && d <= end && !EXCLUDED.has(o.status);
  });

  const products = new Map<number, DownloadProduct>();
  let downloads = 0, downloadOrders = 0, subscriptions = 0, failed = 0;
  const BATCH = 20;
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async o => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`${base}/orders/${o.id}/products?limit=250`, { headers, cache: 'no-store' });
        if (res.ok) return await res.json() as { product_id: number; name: string; quantity: number; total_inc_tax?: string }[];
        if (res.status === 204 || res.status === 404) return [];
        if (res.status !== 429 && res.status < 500) break;
        await sleep(400 * 2 ** attempt);
      }
      failed += 1;
      return null;
    }));
    for (const lines of results) {
      if (!Array.isArray(lines)) continue;
      let hasPdf = false;
      for (const li of lines) {
        const qty = Number(li.quantity) || 1;
        if (Number(li.product_id) === SUBSCRIPTION_PRODUCT_ID) { subscriptions += qty; continue; }
        hasPdf = true;
        downloads += qty;
        const id = Number(li.product_id);
        const row = products.get(id) ?? { productId: id, name: String(li.name ?? 'Unknown'), downloads: 0, orders: 0, revenue: 0 };
        row.downloads += qty; row.orders += 1; row.revenue += parseFloat(li.total_inc_tax ?? '0') || 0;
        products.set(id, row);
      }
      if (hasPdf) downloadOrders += 1;
    }
  }
  return {
    start, end, downloads, orders: downloadOrders, subscriptions, failedOrders: failed,
    products: [...products.values()].map(p => ({ ...p, revenue: round2(p.revenue) })).sort((a, b) => b.downloads - a.downloads || b.revenue - a.revenue),
  };
}

export async function fetchBlakeDownloadsRange(
  start: string, end: string, compStart: string, compEnd: string,
): Promise<{ current: DownloadsPeriod; prior: DownloadsPeriod }> {
  const [current, prior] = await Promise.all([fetchPeriod(start, end), fetchPeriod(compStart, compEnd)]);
  return { current, prior };
}
