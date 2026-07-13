/**
 * Product performance across brands:
 *  - Pascal Press + Blake Education: BigCommerce order line items
 *  - Excel Test Zone + Excel HSC Copilot: Stripe charge descriptions
 */

export type ProductBrand =
  | 'Pascal Press'
  | 'Blake Education'
  | 'Excel Test Zone'
  | 'Excel HSC Copilot';

export type RangeKey = '30d' | '60d' | '90d' | 'mtd' | 'lastmonth';

export interface ProductMetrics {
  revenue: number;
  orders: number;
  units: number;
  aov: number;
}

export interface ProductRow {
  name: string;
  brand: ProductBrand;
  current: ProductMetrics;
  lastYear: ProductMetrics;
  yoyRevenuePct: number | null;
  yoyOrdersPct: number | null;
  yoyUnitsPct: number | null;
  /** hot | steady | soft | cold | new | dead */
  status: 'hot' | 'steady' | 'soft' | 'cold' | 'new' | 'dead';
}

export interface BrandProductSlice {
  brand: ProductBrand;
  source: 'bigcommerce' | 'stripe' | 'none';
  connected: boolean;
  summary: {
    revenue: number;
    units: number;
    orders: number;
    productsSold: number;
    lyRevenue: number;
    yoyRevenuePct: number | null;
    topProduct: string | null;
    topRevenue: number;
  };
  products: ProductRow[];
  top: ProductRow[];
  bottom: ProductRow[];
  declining: ProductRow[]; // sold both periods, YoY down
}

export interface ProductPerformanceResponse {
  connected: boolean;
  range: RangeKey;
  rangeLabel: string;
  currentLabel: string;
  lyLabel: string;
  byBrand: Record<ProductBrand, BrandProductSlice>;
  combined: {
    summary: BrandProductSlice['summary'];
    top: ProductRow[];
    bottom: ProductRow[];
    declining: ProductRow[];
    products: ProductRow[];
  };
}

// ─── Date helpers (Sydney) ───────────────────────────────────────────────────

function toSydneyDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function lastDayOfMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

function nextMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`;
}

export function deriveRanges(range: RangeKey, today: string): {
  currStart: string; currEnd: string; lyStart: string; lyEnd: string; label: string;
} {
  const year = parseInt(today.slice(0, 4), 10);
  const mon  = parseInt(today.slice(5, 7), 10);

  if (range === 'mtd') {
    const currStart = `${year}-${String(mon).padStart(2, '0')}-01`;
    const lyStart   = `${year - 1}-${String(mon).padStart(2, '0')}-01`;
    const lyEnd     = `${year - 1}-${today.slice(5)}`;
    return { currStart, currEnd: today, lyStart, lyEnd, label: 'Month to date' };
  }

  if (range === 'lastmonth') {
    const lm = mon === 1 ? 12 : mon - 1;
    const ly = mon === 1 ? year - 1 : year;
    const daysInLm = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
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
  const lyEnd     = addDays(today, -365);
  return { currStart, currEnd: today, lyStart, lyEnd, label: `Last ${days} days` };
}

function yoyPct(curr: number, ly: number): number | null {
  if (ly === 0) return curr > 0 ? null : 0;
  return Math.round(((curr - ly) / ly) * 1000) / 10;
}

function emptyMetrics(): ProductMetrics {
  return { revenue: 0, orders: 0, units: 0, aov: 0 };
}

function classifyStatus(curr: ProductMetrics, ly: ProductMetrics, yoy: number | null): ProductRow['status'] {
  if (curr.revenue <= 0 && curr.units <= 0) return 'dead';
  if (ly.revenue === 0 && curr.revenue > 0) return 'new';
  if (yoy !== null && yoy >= 25) return 'hot';
  if (yoy !== null && yoy <= -25) return 'cold';
  if (yoy !== null && yoy < 0) return 'soft';
  return 'steady';
}

function buildRows(
  brand: ProductBrand,
  currentMap: Map<string, ProductMetrics>,
  lyMap: Map<string, ProductMetrics>,
): ProductRow[] {
  const names = new Set([...currentMap.keys(), ...lyMap.keys()]);
  const rows: ProductRow[] = [];
  for (const name of names) {
    const current = currentMap.get(name) ?? emptyMetrics();
    const lastYear = lyMap.get(name) ?? emptyMetrics();
    // Skip pure free / zero-everything noise
    if (current.revenue <= 0 && current.units <= 0 && lastYear.revenue <= 0 && lastYear.units <= 0) continue;
    const yoyRevenuePct = yoyPct(current.revenue, lastYear.revenue);
    rows.push({
      name,
      brand,
      current,
      lastYear,
      yoyRevenuePct,
      yoyOrdersPct: yoyPct(current.orders, lastYear.orders),
      yoyUnitsPct: yoyPct(current.units, lastYear.units),
      status: classifyStatus(current, lastYear, yoyRevenuePct),
    });
  }
  return rows.sort((a, b) => b.current.revenue - a.current.revenue);
}

function sliceFromRows(brand: ProductBrand, source: BrandProductSlice['source'], connected: boolean, rows: ProductRow[]): BrandProductSlice {
  const isNoise = (name: string) =>
    /^free\s*gift/i.test(name) || /voucher/i.test(name) || name.toLowerCase() === 'unknown';

  // Paid product sales only for ranking (exclude free gifts / $0 lines)
  const sold = rows.filter(r => r.current.revenue > 0 && !isNoise(r.name));
  const revenue = sold.reduce((s, r) => s + r.current.revenue, 0);
  const units = sold.reduce((s, r) => s + r.current.units, 0);
  const orders = sold.reduce((s, r) => s + r.current.orders, 0);
  const lyRevenue = sold.reduce((s, r) => s + r.lastYear.revenue, 0);
  const top = sold.slice(0, 15);
  // Soft sellers: lowest paid revenue, still actually sold (>$0)
  const bottom = [...sold]
    .filter(r => r.current.revenue > 0)
    .sort((a, b) => a.current.revenue - b.current.revenue)
    .slice(0, 15);
  const declining = sold
    .filter(r => r.lastYear.revenue > 0 && (r.yoyRevenuePct ?? 0) < 0)
    .sort((a, b) => (a.yoyRevenuePct ?? 0) - (b.yoyRevenuePct ?? 0))
    .slice(0, 15);

  return {
    brand,
    source,
    connected,
    summary: {
      revenue: Math.round(revenue * 100) / 100,
      units,
      orders,
      productsSold: sold.length,
      lyRevenue: Math.round(lyRevenue * 100) / 100,
      yoyRevenuePct: yoyPct(revenue, lyRevenue),
      topProduct: top[0]?.name ?? null,
      topRevenue: top[0]?.current.revenue ?? 0,
    },
    products: rows,
    top,
    bottom,
    declining,
  };
}

// ─── BigCommerce ─────────────────────────────────────────────────────────────

const EXCLUDED = new Set([
  'Cancelled', 'Refunded', 'Declined', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required',
]);

interface BCOrder { id: number; total_inc_tax: string; status: string; date_created: string; }
interface BCLineItem { name: string; sku: string; quantity: number; price_inc_tax: string; }

function bcHeaders(token: string) {
  return { 'X-Auth-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function bcDateParam(dateStr: string, endOfDay = false): string {
  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const rfc = `${DAYS[d.getUTCDay()]}, ${String(day!).padStart(2, '0')} ${MONTHS[mon! - 1]} ${year} ${endOfDay ? '23:59:59' : '00:00:00'} +1000`;
  return encodeURIComponent(rfc);
}

function orderDateAEST(bcDateCreated: string): string {
  return toSydneyDateStr(new Date(bcDateCreated));
}

async function fetchMonthOrders(base: string, token: string, yearMon: string): Promise<BCOrder[]> {
  const results: BCOrder[] = [];
  const start = `${yearMon}-01`;
  const end   = lastDayOfMonth(yearMon);
  let page = 1;
  while (true) {
    const url = `${base}/orders?min_date_created=${bcDateParam(start)}&max_date_created=${bcDateParam(end, true)}&limit=250&page=${page}`;
    const res = await fetch(url, { headers: bcHeaders(token), cache: 'no-store' });
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

async function mapBcProducts(
  storeHash: string,
  token: string,
  start: string,
  end: string,
  maxOrders = 300,
): Promise<Map<string, ProductMetrics>> {
  const base = `https://api.bigcommerce.com/stores/${storeHash}/v2`;
  const startMonth = start.slice(0, 7);
  const endMonth   = end.slice(0, 7);
  let allOrders: BCOrder[] = [];
  let cur = startMonth;
  while (cur <= endMonth) {
    allOrders.push(...await fetchMonthOrders(base, token, cur));
    cur = nextMonth(cur);
  }

  const valid = allOrders
    .filter(o => {
      const d = orderDateAEST(o.date_created);
      return d >= start && d <= end && !EXCLUDED.has(o.status);
    })
    // Prefer larger orders for representative product mix when capped
    .sort((a, b) => Number(b.total_inc_tax || 0) - Number(a.total_inc_tax || 0))
    .slice(0, maxOrders);

  const map = new Map<string, ProductMetrics>();
  const CONC = 12;
  for (let i = 0; i < valid.length; i += CONC) {
    const batch = valid.slice(i, i + CONC);
    const results = await Promise.allSettled(
      batch.map(o =>
        fetch(`${base}/orders/${o.id}/products`, { headers: bcHeaders(token), cache: 'no-store' })
          .then(r => (r.ok && r.status !== 204) ? r.json() as Promise<BCLineItem[]> : []),
      ),
    );
    results.forEach((result) => {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
      for (const item of result.value) {
        const key = (item.name ?? item.sku ?? 'Unknown').trim();
        if (!key) continue;
        // Skip free-gift noise from ranking tables later if $0
        const qty = Number(item.quantity ?? 0);
        const rev = Number(item.price_inc_tax ?? 0) * qty;
        const existing = map.get(key);
        if (!existing) map.set(key, { revenue: rev, orders: 1, units: qty, aov: 0 });
        else {
          existing.revenue += rev;
          existing.orders += 1;
          existing.units += qty;
        }
      }
    });
  }

  for (const [, m] of map) {
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.aov = m.orders > 0 ? Math.round((m.revenue / m.orders) * 100) / 100 : 0;
  }
  return map;
}

async function fetchBcBrandSlice(
  brand: ProductBrand,
  storeHash: string,
  token: string,
  currStart: string,
  currEnd: string,
  lyStart: string,
  lyEnd: string,
): Promise<BrandProductSlice> {
  if (!storeHash || !token) {
    return sliceFromRows(brand, 'none', false, []);
  }
  try {
    const [curr, ly] = await Promise.all([
      mapBcProducts(storeHash, token, currStart, currEnd),
      mapBcProducts(storeHash, token, lyStart, lyEnd),
    ]);
    return sliceFromRows(brand, 'bigcommerce', true, buildRows(brand, curr, ly));
  } catch (e) {
    console.error(`[product-performance] ${brand}`, e);
    return sliceFromRows(brand, 'bigcommerce', false, []);
  }
}

// ─── Stripe (ETZ / HSC) ──────────────────────────────────────────────────────

function zonedDateTimeToUnix(ymd: string, hms: string, timeZone = 'Australia/Sydney'): number {
  const [Y, M, D] = ymd.split('-').map(Number);
  const [h, m, s] = hms.split(':').map(Number);
  const desiredAsUtcMs = Date.UTC(Y!, M! - 1, D!, h!, m!, s!);
  let utcMs = desiredAsUtcMs;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcMs)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
    ) as Record<string, string>;
    const asLocalMs = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const diff = desiredAsUtcMs - asLocalMs;
    if (diff === 0) break;
    utcMs += diff;
  }
  return Math.floor(utcMs / 1000);
}

interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  paid: boolean;
  status: string;
  description: string | null;
  created: number;
  metadata?: Record<string, string>;
}

async function mapStripeProducts(
  secretKey: string,
  start: string,
  end: string,
): Promise<Map<string, ProductMetrics>> {
  const map = new Map<string, ProductMetrics>();
  if (!secretKey) return map;

  const gte = zonedDateTimeToUnix(start, '00:00:00');
  const lte = zonedDateTimeToUnix(end, '23:59:59');
  let startingAfter: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      limit: '100',
      'created[gte]': String(gte),
      'created[lte]': String(lte),
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
    });
    if (!res.ok) break;
    const json = await res.json() as { data: StripeCharge[]; has_more: boolean };
    const charges = json.data ?? [];
    for (const c of charges) {
      if (!c.paid || c.status !== 'succeeded') continue;
      const net = (c.amount - (c.amount_refunded || 0)) / 100;
      if (net <= 0) continue;
      const name = (
        c.metadata?.product_name
        || c.metadata?.product
        || c.metadata?.plan
        || c.description
        || 'Subscription / unspecified'
      ).trim();
      const existing = map.get(name);
      if (!existing) map.set(name, { revenue: net, orders: 1, units: 1, aov: net });
      else {
        existing.revenue += net;
        existing.orders += 1;
        existing.units += 1;
      }
    }
    if (!json.has_more || charges.length === 0) break;
    startingAfter = charges[charges.length - 1]!.id;
  }

  for (const [, m] of map) {
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.aov = m.orders > 0 ? Math.round((m.revenue / m.orders) * 100) / 100 : 0;
  }
  return map;
}

async function fetchStripeBrandSlice(
  brand: ProductBrand,
  secretKey: string,
  currStart: string,
  currEnd: string,
  lyStart: string,
  lyEnd: string,
): Promise<BrandProductSlice> {
  if (!secretKey) return sliceFromRows(brand, 'none', false, []);
  try {
    const [curr, ly] = await Promise.all([
      mapStripeProducts(secretKey, currStart, currEnd),
      mapStripeProducts(secretKey, lyStart, lyEnd),
    ]);
    return sliceFromRows(brand, 'stripe', true, buildRows(brand, curr, ly));
  } catch (e) {
    console.error(`[product-performance] ${brand}`, e);
    return sliceFromRows(brand, 'stripe', false, []);
  }
}

// ─── Public entry ────────────────────────────────────────────────────────────

export async function fetchProductPerformance(range: RangeKey = '30d'): Promise<ProductPerformanceResponse> {
  const today = toSydneyDateStr();
  const { currStart, currEnd, lyStart, lyEnd, label } = deriveRanges(range, today);

  const ppHash   = process.env.BIGCOMMERCE_STORE_HASH ?? '';
  const ppToken  = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
  const blakeHash  = process.env.BIGCOMMERCE_BLAKE_STORE_HASH ?? '';
  const blakeToken = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';
  const etzKey = process.env.STRIPE_SECRET_KEY ?? '';
  const hscKey = process.env.STRIPE_HSC_SECRET_KEY ?? '';

  const [pp, blake, etz, hsc] = await Promise.all([
    fetchBcBrandSlice('Pascal Press', ppHash, ppToken, currStart, currEnd, lyStart, lyEnd),
    fetchBcBrandSlice('Blake Education', blakeHash, blakeToken, currStart, currEnd, lyStart, lyEnd),
    fetchStripeBrandSlice('Excel Test Zone', etzKey, currStart, currEnd, lyStart, lyEnd),
    fetchStripeBrandSlice('Excel HSC Copilot', hscKey, currStart, currEnd, lyStart, lyEnd),
  ]);

  const byBrand: Record<ProductBrand, BrandProductSlice> = {
    'Pascal Press': pp,
    'Blake Education': blake,
    'Excel Test Zone': etz,
    'Excel HSC Copilot': hsc,
  };

  const allProducts = [...pp.products, ...blake.products, ...etz.products, ...hsc.products]
    .sort((a, b) => b.current.revenue - a.current.revenue);

  const isNoise = (name: string) =>
    /^free\s*gift/i.test(name) || /voucher/i.test(name) || name.toLowerCase() === 'unknown';
  const sold = allProducts.filter(r => r.current.revenue > 0 && !isNoise(r.name));
  const revenue = sold.reduce((s, r) => s + r.current.revenue, 0);
  const units = sold.reduce((s, r) => s + r.current.units, 0);
  const orders = sold.reduce((s, r) => s + r.current.orders, 0);
  const lyRevenue = sold.reduce((s, r) => s + r.lastYear.revenue, 0);
  const top = sold.slice(0, 20);
  const bottom = [...sold].sort((a, b) => a.current.revenue - b.current.revenue).slice(0, 20);
  const declining = sold
    .filter(r => r.lastYear.revenue > 0 && (r.yoyRevenuePct ?? 0) < 0)
    .sort((a, b) => (a.yoyRevenuePct ?? 0) - (b.yoyRevenuePct ?? 0))
    .slice(0, 20);

  const anyConnected = pp.connected || blake.connected || etz.connected || hsc.connected;

  return {
    connected: anyConnected,
    range,
    rangeLabel: label,
    currentLabel: `${fmtLabel(currStart)} – ${fmtLabel(currEnd)}`,
    lyLabel: `${fmtLabel(lyStart)} – ${fmtLabel(lyEnd)}`,
    byBrand,
    combined: {
      summary: {
        revenue: Math.round(revenue * 100) / 100,
        units,
        orders,
        productsSold: sold.length,
        lyRevenue: Math.round(lyRevenue * 100) / 100,
        yoyRevenuePct: yoyPct(revenue, lyRevenue),
        topProduct: top[0]?.name ?? null,
        topRevenue: top[0]?.current.revenue ?? 0,
      },
      top,
      bottom,
      declining,
      products: allProducts,
    },
  };
}
