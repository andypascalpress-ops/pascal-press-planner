/**
 * Shopify Admin API client for Excel Study Guides (read-only).
 *
 * Environment variables (set in Vercel, never in code or chat):
 *   SHOPIFY_CLIENT_ID      the app's client ID (Dev Dashboard app installed on the store)
 *   SHOPIFY_CLIENT_SECRET  the app's client secret
 *   SHOPIFY_STORE_DOMAIN   the store's .myshopify.com address; several can be given separated by commas
 *                          (a store can have more than one), the first one that signs in is used
 *
 * Sign-in is the client-credentials grant: the app exchanges its client ID and secret for a short-lived access token
 * (about 24 hours), which is cached here. Only order, product and marketing-source data is read; no customer details.
 */

const API_VERSION = '2026-07';

const clean = (v: string | undefined) => (v ?? '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[\r\n]/g, '');
const domains = () => clean(process.env.SHOPIFY_STORE_DOMAIN).split(',').map(d => d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);

export const shopifyConfigured = () => Boolean(clean(process.env.SHOPIFY_CLIENT_ID) && clean(process.env.SHOPIFY_CLIENT_SECRET) && domains().length);

let cached: { shop: string; token: string; expiresAt: number } | null = null;

async function getToken(): Promise<{ shop: string; token: string }> {
  if (cached && Date.now() < cached.expiresAt) return cached;
  const id = clean(process.env.SHOPIFY_CLIENT_ID), secret = clean(process.env.SHOPIFY_CLIENT_SECRET);
  if (!id || !secret || !domains().length) throw new Error('Shopify is not configured (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN)');
  const shape = `client id ${id.length} chars, secret ${secret.length} chars`;
  const problems: string[] = [];
  for (const shop of domains()) {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
      cache: 'no-store',
    });
    const text = await res.text();
    let json: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.ok && json.access_token) {
      cached = { shop, token: json.access_token, expiresAt: Date.now() + Math.max(((json.expires_in ?? 86_399) - 600) * 1000, 60_000) };
      return cached;
    }
    problems.push(`${shop}: HTTP ${res.status} ${json.error ?? ''} ${(json.error_description ?? text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  throw new Error(`Shopify sign-in failed. ${problems.join(' | ')} [${shape}]`);
}

/** Run a GraphQL query against the Admin API. */
export async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { shop, token } = await getToken();
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Shopify API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Shopify API: ${json.errors.map(e => e.message).join('; ').slice(0, 300)}`);
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Orders summary for a date range (Sydney days)
// ---------------------------------------------------------------------------

const sydneyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
function sydneyOffset(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', timeZoneName: 'longOffset' }).formatToParts(new Date(Date.UTC(y!, m! - 1, d!, 12))).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+10:00';
  return part.replace('GMT', '') || '+10:00';
}

interface OrderNode {
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  totalPriceSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  totalDiscountsSet: { shopMoney: { amount: string } };
  discountCodes: string[];
  sourceName: string | null;
  customerJourneySummary: { lastVisit: { source: string | null; sourceType: string | null; utmParameters: { source: string | null; medium: string | null } | null } | null } | null;
}

const ORDERS_QUERY = `query($q: String!, $cursor: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt cancelledAt test discountCodes sourceName
      totalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      customerJourneySummary { lastVisit { source sourceType utmParameters { source medium } } }
    }
  }
}`;

export interface ShopifySales {
  orders: number;
  revenue: number;            // order totals (incl. GST and shipping) less refunds
  refunds: number;
  discounts: number;
  discountedOrders: number;
  byDay: Record<string, { revenue: number; orders: number }>;
  bySource: { source: string; orders: number; revenue: number }[];
  byDiscountCode: { code: string; orders: number; revenue: number }[];
}

export async function fetchShopifySales(start: string, end: string): Promise<ShopifySales> {
  const q = `created_at:>='${start}T00:00:00${sydneyOffset(start)}' AND created_at:<='${end}T23:59:59${sydneyOffset(end)}'`;
  const nodes: OrderNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await shopifyGraphql(ORDERS_QUERY, { q, cursor });
    nodes.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  const num = (v: string | undefined) => parseFloat(v ?? '0') || 0;
  const out: ShopifySales = { orders: 0, revenue: 0, refunds: 0, discounts: 0, discountedOrders: 0, byDay: {}, bySource: [], byDiscountCode: [] };
  const src = new Map<string, { orders: number; revenue: number }>(), codes = new Map<string, { orders: number; revenue: number }>();
  for (const o of nodes) {
    if (o.test || o.cancelledAt) continue;
    const gross = num(o.totalPriceSet.shopMoney.amount), refunded = num(o.totalRefundedSet.shopMoney.amount), net = gross - refunded;
    out.orders += 1; out.revenue += net; out.refunds += refunded;
    const disc = num(o.totalDiscountsSet.shopMoney.amount);
    out.discounts += disc; if (disc > 0) out.discountedOrders += 1;
    const day = sydneyDay.format(new Date(o.createdAt));
    const cell = (out.byDay[day] ??= { revenue: 0, orders: 0 }); cell.revenue += net; cell.orders += 1;
    const lv = o.customerJourneySummary?.lastVisit;
    const s = (lv?.utmParameters?.source || lv?.source || (lv?.sourceType) || (o.sourceName === 'web' ? 'Direct / unknown' : o.sourceName) || 'Unknown').toString();
    const sc = src.get(s) ?? { orders: 0, revenue: 0 }; sc.orders += 1; sc.revenue += net; src.set(s, sc);
    for (const code of o.discountCodes ?? []) { const c = codes.get(code) ?? { orders: 0, revenue: 0 }; c.orders += 1; c.revenue += net; codes.set(code, c); }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.revenue = r2(out.revenue); out.refunds = r2(out.refunds); out.discounts = r2(out.discounts);
  for (const d of Object.values(out.byDay)) d.revenue = r2(d.revenue);
  out.bySource = [...src.entries()].map(([source, v]) => ({ source, orders: v.orders, revenue: r2(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  out.byDiscountCode = [...codes.entries()].map(([code, v]) => ({ code, orders: v.orders, revenue: r2(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  return out;
}
