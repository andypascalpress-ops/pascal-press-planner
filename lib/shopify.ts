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
  customerJourneySummary: { lastVisit: { source: string | null; sourceType: string | null; landingPage: string | null; utmParameters: { source: string | null; medium: string | null; campaign: string | null } | null } | null } | null;
}

const ORDERS_QUERY = `query($q: String!, $cursor: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt cancelledAt test discountCodes sourceName
      totalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      customerJourneySummary { lastVisit { source sourceType landingPage utmParameters { source medium campaign } } }
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
  byCampaign?: { campaign: string; channel: string; orders: number; revenue: number }[];
  debug?: unknown;
}


const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social', 'social_paid', 'cpm', 'display', 'shopping', 'paid_search', 'paidsearch']);
function platformName(raw: string): string {
  const s = raw.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
  if (s.startsWith('google') || s === 'adwords') return s.includes('mail') ? 'Gmail' : 'Google';
  if (/(facebook|^fb$|instagram|^ig$|^meta$)/.test(s)) return 'Facebook & Instagram';
  if (s.startsWith('bing')) return 'Bing';
  if (s === 'direct' || s === '(direct)' || s === '') return 'Direct';
  if (s.startsWith('duckduckgo')) return 'DuckDuckGo';
  if (s.startsWith('search.brave')) return 'Brave';
  if (s.startsWith('android-app')) return s.includes('gm') ? 'Gmail' : 'App';
  return raw.length > 24 ? raw.slice(0, 24) + '...' : raw.charAt(0).toUpperCase() + raw.slice(1);
}
/** Channel such as "Google - paid" or "Google - organic search", from the visit's tracking tags and click IDs. */
function classifyVisit(lv: NonNullable<OrderNode['customerJourneySummary']>['lastVisit'], sourceName: string | null): { channel: string; campaign: string } {
  const utm = lv?.utmParameters;
  const rawSource = (utm?.source || lv?.source || lv?.sourceType || (sourceName === 'web' ? 'direct' : sourceName) || 'Unknown').toString();
  const platform = platformName(rawSource);
  let medium = (utm?.medium ?? '').toLowerCase();
  let clickId = '';
  try {
    const u = new URL(lv?.landingPage ?? '', 'https://x.invalid');
    if (u.searchParams.get('gclid') || u.searchParams.get('gbraid') || u.searchParams.get('wbraid')) clickId = 'google';
    else if (u.searchParams.get('msclkid')) clickId = 'bing';
    if (!medium) medium = (u.searchParams.get('utm_medium') ?? '').toLowerCase();
  } catch { /* no landing page */ }
  const paid = PAID_MEDIUMS.has(medium) || Boolean(clickId);
  let channel = platform;
  if (platform === 'Direct') channel = 'Direct';
  else if (paid) channel = `${platform === 'Unknown' ? (clickId === 'bing' ? 'Bing' : 'Google') : platform} \u2013 paid`;
  else if (platform === 'Google' || platform === 'Bing' || platform === 'DuckDuckGo' || platform === 'Brave') channel = `${platform} \u2013 organic search`;
  else if (platform === 'Facebook & Instagram') channel = `${platform} \u2013 no ad tag (organic or untagged ad)`;
  else if (medium === 'email') channel = `${platform} \u2013 email`;
  return { channel, campaign: (utm?.campaign ?? '').trim() };
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
  const camps = new Map<string, { channel: string; orders: number; revenue: number }>();
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
    const { channel: s, campaign } = classifyVisit(lv ?? null, o.sourceName);
    if (campaign) { const key = `${s}||${campaign}`; const cc = camps.get(key) ?? { channel: s, orders: 0, revenue: 0 }; cc.orders += 1; cc.revenue += net; camps.set(key, cc); }
    const sc = src.get(s) ?? { orders: 0, revenue: 0 }; sc.orders += 1; sc.revenue += net; src.set(s, sc);
    for (const code of o.discountCodes ?? []) { const c = codes.get(code) ?? { orders: 0, revenue: 0 }; c.orders += 1; c.revenue += net; codes.set(code, c); }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.revenue = r2(out.revenue); out.refunds = r2(out.refunds); out.discounts = r2(out.discounts);
  for (const d of Object.values(out.byDay)) d.revenue = r2(d.revenue);
  out.byCampaign = [...camps.entries()].map(([k, v]) => ({ campaign: k.split('||')[1]!, channel: v.channel, orders: v.orders, revenue: r2(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  out.bySource = [...src.entries()].map(([source, v]) => ({ source, orders: v.orders, revenue: r2(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  out.byDiscountCode = [...codes.entries()].map(([code, v]) => ({ code, orders: v.orders, revenue: r2(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  return out;
}


// ---------------------------------------------------------------------------
// Sales from Shopify's own sales report (ShopifyQL). Needs only read_reports, so it can look back further than the
// 60 days the order list allows without read_all_orders. Revenue (total sales: after discounts and returns, including
// GST and shipping), orders and discounts by day. No source or discount-code breakdown.
// ---------------------------------------------------------------------------

export async function fetchShopifySalesReport(start: string, end: string): Promise<ShopifySales> {
  const q = `FROM sales SHOW orders, total_sales, discounts, returns GROUP BY day SINCE ${start} UNTIL ${end} ORDER BY day`;
  const data = await shopifyGraphql<{ shopifyqlQuery: { parseErrors?: unknown; tableData?: { columns?: { name: string }[]; rows?: unknown } | null } }>(
    `query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`, { q });
  const res = data.shopifyqlQuery;
  const errs = Array.isArray(res?.parseErrors) ? (res.parseErrors as unknown[]).map(e => (typeof e === 'string' ? e : (e as { message?: string })?.message ?? JSON.stringify(e))) : [];
  if (errs.length) throw new Error(`Shopify report query rejected: ${errs.join('; ').slice(0, 250)}`);
  const cols = (res?.tableData?.columns ?? []).map(c => c.name);
  const rawRows = Array.isArray(res?.tableData?.rows) ? (res!.tableData!.rows as unknown[]) : [];
  const num = (v: unknown) => Math.abs(parseFloat(String(v ?? '0'))) || 0;
  const signed = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  const out: ShopifySales = { orders: 0, revenue: 0, refunds: 0, discounts: 0, discountedOrders: 0, byDay: {}, bySource: [], byDiscountCode: [] };
  for (const raw of rawRows) {
    const row: Record<string, unknown> = Array.isArray(raw) ? Object.fromEntries(cols.map((c, i) => [c, (raw as unknown[])[i]])) : (raw as Record<string, unknown>);
    const day = String(row.day ?? '').slice(0, 10);
    const orders = Math.round(signed(row.orders)), revenue = signed(row.total_sales);
    out.orders += orders; out.revenue += revenue; out.discounts += num(row.discounts); out.refunds += num(row.returns);
    if (day) out.byDay[day] = { revenue: Math.round(revenue * 100) / 100, orders };
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.revenue = r2(out.revenue); out.discounts = r2(out.discounts); out.refunds = r2(out.refunds);
  out.debug = { columns: cols, rowCount: rawRows.length, firstRows: rawRows.slice(0, 3) };
  return out;
}


// ---------------------------------------------------------------------------
// Sales by product from Shopify's sales report (any date range, needs only read_reports).
// Revenue is net sales: after discounts and returns, before GST and shipping.
// ---------------------------------------------------------------------------

export interface ShopifyProductSales { title: string; units: number | null; revenue: number }

export async function fetchShopifyProductSales(start: string, end: string): Promise<ShopifyProductSales[]> {
  // the units metric is tried under its likely names; the table still works (revenue only) if none is accepted
  const unitMetrics = ['net_items_sold', 'ordered_item_quantity', ''];
  let lastErr = '';
  for (const um of unitMetrics) {
    const q = `FROM sales SHOW ${um ? `${um}, ` : ''}net_sales GROUP BY product_title SINCE ${start} UNTIL ${end} ORDER BY net_sales DESC LIMIT 25`;
    try {
      const data = await shopifyGraphql<{ shopifyqlQuery: { parseErrors?: unknown; tableData?: { columns?: { name: string }[]; rows?: unknown } | null } }>(
        `query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`, { q });
      const res = data.shopifyqlQuery;
      if (Array.isArray(res?.parseErrors) && res.parseErrors.length) { lastErr = JSON.stringify(res.parseErrors).slice(0, 200); continue; }
      const cols = (res?.tableData?.columns ?? []).map(c => c.name);
      const rows = Array.isArray(res?.tableData?.rows) ? (res!.tableData!.rows as unknown[]) : [];
      return rows.map(raw => {
        const row: Record<string, unknown> = Array.isArray(raw) ? Object.fromEntries(cols.map((c, i) => [c, (raw as unknown[])[i]])) : (raw as Record<string, unknown>);
        return {
          title: String(row.product_title ?? '(no product)') || '(no product)',
          units: um ? Math.round(parseFloat(String(row[um] ?? '0')) || 0) : null,
          revenue: Math.round((parseFloat(String(row.net_sales ?? '0')) || 0) * 100) / 100,
        };
      }).filter(r => r.revenue !== 0 || (r.units ?? 0) !== 0);
    } catch (e) { lastErr = e instanceof Error ? e.message : 'failed'; }
  }
  throw new Error(`Shopify product report failed: ${lastErr.slice(0, 250)}`);
}
