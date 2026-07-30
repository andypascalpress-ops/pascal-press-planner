/**
 * Blake Education — BigCommerce data fetchers
 *  - fetchBlakeDownloads:      digital product download counts (cumulative leaderboard)
 *  - fetchBlakeSubscriptions:  orders for product 1072, by month (last 12 months)
 */

const BLAKE_STORE_HASH   = process.env.BIGCOMMERCE_BLAKE_STORE_HASH   ?? '';
const BLAKE_ACCESS_TOKEN = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';

const SUBSCRIPTION_PRODUCT_ID = 1072;

const EXCLUDED_STATUSES = new Set([
  'Cancelled', 'Refunded', 'Incomplete',
  'Awaiting Payment', 'Manual Verification Required',
]);

function bcHeaders(token: string) {
  return { 'X-Auth-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
}

const RFC_DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RFC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toRFC2822(dateStr: string, endOfDay = false): string {
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = RFC_DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = RFC_MONTHS[mon! - 1]!;
  const time = endOfDay ? '23:59:59' : '00:00:00';
  return `${dow}, ${dd} ${mmm} ${year} ${time} +1000`;
}

function lastDayOfMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return new Date(y!, m!, 0).toISOString().split('T')[0]!;
}

interface BCOrder {
  id:            number;
  total_inc_tax: string;
  date_created:  string;
  status:        string;
}

async function fetchOrdersForMonth(month: string): Promise<BCOrder[]> {
  const base    = `https://api.bigcommerce.com/stores/${BLAKE_STORE_HASH}/v2`;
  const orders: BCOrder[] = [];
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({
      min_date_created: toRFC2822(`${month}-01`),
      max_date_created: toRFC2822(lastDayOfMonth(month), true),
      page: String(page), limit: '250',
    });
    const res = await fetch(`${base}/orders?${qs}`, {
      headers: bcHeaders(BLAKE_ACCESS_TOKEN), cache: 'no-store',
    });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`Blake BC orders ${month} -> ${res.status}`);
    const data: BCOrder[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    orders.push(...data);
    if (data.length < 250) break;
    page++;
  }
  return orders;
}

async function orderHasProduct(orderId: number, productId: number): Promise<boolean> {
  const base = `https://api.bigcommerce.com/stores/${BLAKE_STORE_HASH}/v2`;
  const res  = await fetch(`${base}/orders/${orderId}/products`, {
    headers: bcHeaders(BLAKE_ACCESS_TOKEN), cache: 'no-store',
  });
  if (!res.ok || res.status === 204) return false;
  const items = await res.json();
  return Array.isArray(items) && items.some((i: any) => Number(i.product_id) === productId);
}

// ── Downloads ─────────────────────────────────────────────────────────────────

export interface DownloadProduct {
  productId: number;
  name:      string;
  downloads: number; // purchase count (last 12 months)
}

export interface DownloadMonth {
  month: string; // YYYY-MM
  count: number;
}

export interface BlakeDownloadsData {
  topProducts:    DownloadProduct[];
  months:         DownloadMonth[];
  totalPurchases: number;
  connected:      boolean;
}

/**
 * Derives download data from order line items (last 12 months).
 * Uses the same order-fetching pattern as fetchBlakeSubscriptions so we know it works.
 * "downloads" here means PDF product purchases — the same data the beadmin page shows.
 */
export async function fetchBlakeDownloads(): Promise<BlakeDownloadsData> {
  const empty = { topProducts: [], months: [], totalPurchases: 0, connected: false };
  if (!BLAKE_STORE_HASH || !BLAKE_ACCESS_TOKEN) return empty;

  try {
    const base = `https://api.bigcommerce.com/stores/${BLAKE_STORE_HASH}/v2`;

    const now = new Date();
    const monthList: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Fetch all months in parallel
    const ordersByMonth = await Promise.all(
      monthList.map(async (month) => ({
        month,
        orders: (await fetchOrdersForMonth(month)).filter(o => !EXCLUDED_STATUSES.has(o.status)),
      }))
    );

    const allOrders = ordersByMonth.flatMap(({ orders }) => orders);

    // Fetch ALL line items in batches of 20 (same as subscriptions)
    const BATCH = 20;
    type LineItem = { product_id: number; name: string; quantity: number };
    const itemsByOrder = new Map<number, LineItem[]>();

    for (let i = 0; i < allOrders.length; i += BATCH) {
      const batch = allOrders.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (o) => {
          const res = await fetch(`${base}/orders/${o.id}/products`, {
            headers: bcHeaders(BLAKE_ACCESS_TOKEN), cache: 'no-store',
          });
          if (!res.ok || res.status === 204) return { id: o.id, items: [] as LineItem[] };
          const data = await res.json();
          const items: LineItem[] = Array.isArray(data)
            ? data.map((x: any) => ({
                product_id: Number(x.product_id),
                name:       String(x.name ?? ''),
                quantity:   Number(x.quantity) || 1,
              }))
            : [];
          return { id: o.id, items };
        })
      );
      for (const { id, items } of results) itemsByOrder.set(id, items);
    }

    // Aggregate — exclude subscription product
    const productCounts = new Map<number, { name: string; count: number }>();
    const monthCounts   = new Map<string, number>();

    for (const { month, orders } of ordersByMonth) {
      let mCount = 0;
      for (const order of orders) {
        for (const item of (itemsByOrder.get(order.id) ?? [])) {
          if (item.product_id === SUBSCRIPTION_PRODUCT_ID) continue;
          const existing = productCounts.get(item.product_id);
          if (existing) existing.count += item.quantity;
          else productCounts.set(item.product_id, { name: item.name, count: item.quantity });
          mCount += item.quantity;
        }
      }
      monthCounts.set(month, mCount);
    }

    // Top 50 by purchase count — we'll enrich with actual BC num_downloads
    const topByPurchase = [...productCounts.entries()]
      .map(([productId, { name, count }]) => ({ productId, name, purchaseCount: count }))
      .sort((a, b) => b.purchaseCount - a.purchaseCount)
      .slice(0, 50);

    // Enrich with actual cumulative download counts from BC product downloads API.
    // This captures subscribers downloading files without a purchase order.
    const enriched = await Promise.all(
      topByPurchase.map(async (p) => {
        const res = await fetch(`${base}/products/${p.productId}/downloads`, {
          headers: bcHeaders(BLAKE_ACCESS_TOKEN), cache: 'no-store',
        });
        if (!res.ok || res.status === 204) return { ...p, downloads: p.purchaseCount };
        const files = await res.json();
        const numDownloads = Array.isArray(files)
          ? files.reduce((s: number, f: any) => s + (Number(f.num_downloads) || 0), 0)
          : 0;
        // Fall back to purchase count if the product has no attached download files
        return { ...p, downloads: numDownloads > 0 ? numDownloads : p.purchaseCount };
      })
    );

    const topProducts = enriched
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 25)
      .map(({ productId, name, downloads }) => ({ productId, name, downloads }));

    const months         = monthList.map(m => ({ month: m, count: monthCounts.get(m) ?? 0 }));
    const totalPurchases = months.reduce((s, m) => s + m.count, 0);

    return { topProducts, months, totalPurchases, connected: true };
  } catch (err) {
    console.error('[blake-downloads]', err);
    return { topProducts: [], months: [], totalPurchases: 0, connected: false };
  }
}

// ── Subscriptions (product 1072) ──────────────────────────────────────────────

export interface SubscriptionMonth {
  month:   string; // YYYY-MM
  count:   number;
  revenue: number;
}

export interface BlakeSubscriptionsData {
  months:       SubscriptionMonth[];
  totalCount:   number;
  totalRevenue: number;
  connected:    boolean;
}

export async function fetchBlakeSubscriptions(): Promise<BlakeSubscriptionsData> {
  if (!BLAKE_STORE_HASH || !BLAKE_ACCESS_TOKEN) {
    return { months: [], totalCount: 0, totalRevenue: 0, connected: false };
  }

  try {
    // Build list of last 12 calendar months (oldest first)
    const now = new Date();
    const monthList: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Fetch all months' orders in parallel
    const ordersByMonth = await Promise.all(
      monthList.map(async (month) => ({
        month,
        orders: (await fetchOrdersForMonth(month)).filter(o => !EXCLUDED_STATUSES.has(o.status)),
      }))
    );

    const allOrders = ordersByMonth.flatMap(({ orders }) => orders);

    // Check line items in parallel batches of 20
    const BATCH = 20;
    const hasProduct = new Map<number, boolean>();
    for (let i = 0; i < allOrders.length; i += BATCH) {
      const batch = allOrders.slice(i, i + BATCH);
      const checks = await Promise.all(
        batch.map(async (o) => ({ id: o.id, match: await orderHasProduct(o.id, SUBSCRIPTION_PRODUCT_ID) }))
      );
      for (const { id, match } of checks) hasProduct.set(id, match);
    }

    const months: SubscriptionMonth[] = ordersByMonth.map(({ month, orders }) => {
      const matching = orders.filter(o => hasProduct.get(o.id) === true);
      return {
        month,
        count:   matching.length,
        revenue: matching.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0),
      };
    });

    return {
      months,
      totalCount:   months.reduce((s, m) => s + m.count,   0),
      totalRevenue: months.reduce((s, m) => s + m.revenue, 0),
      connected:    true,
    };
  } catch (err) {
    console.error('[blake-subscriptions]', err);
    return { months: [], totalCount: 0, totalRevenue: 0, connected: false };
  }
}
