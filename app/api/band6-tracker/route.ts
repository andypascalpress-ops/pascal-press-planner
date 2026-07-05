/**
 * GET /api/band6-tracker
 *
 * Searches BigCommerce catalog for "60 Days to Band 6" products,
 * then aggregates revenue, orders, and units from July 2026 onward.
 * Used by the Overview tab tracker card.
 *
 * Target: $50,000 by 30 November 2026.
 */
import { NextResponse } from 'next/server';

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const BC_BASE_V3   = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;

// Tracker config
const TARGET_REVENUE = 50_000;
const START_DATE     = '2026-07-01'; // When the series launched
const END_DATE       = '2026-11-30'; // Target deadline

export const revalidate = 3600; // 1-hour cache

function bcHeaders() {
  return {
    'X-Auth-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function fetchAllOrderPages(params: Record<string, string>): Promise<BCOrder[]> {
  const results: BCOrder[] = [];
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({ ...params, page: String(page), limit: '250' });
    const res = await fetch(`${BC_BASE}/orders?${qs}`, { headers: bcHeaders() });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BC /orders -> ${res.status}`);
    const data: BCOrder[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 250) break;
    page++;
  }
  return results;
}

interface BCCatalogProduct {
  id:   number;
  name: string;
  sku:  string;
}

interface BCOrder {
  id:             number;
  total_inc_tax:  string;
  status:         string;
  date_created:   string;
}

interface BCOrderProduct {
  product_id:    number;
  name:          string;
  quantity:      number;
  price_inc_tax: string;
}

const EXCLUDED_STATUSES = new Set([
  'Cancelled', 'Refunded', 'Incomplete',
  'Awaiting Payment', 'Manual Verification Required',
]);

async function searchProducts(keyword: string): Promise<BCCatalogProduct[]> {
  const res = await fetch(
    `${BC_BASE_V3}/catalog/products?keyword=${encodeURIComponent(keyword)}&limit=50&include_fields=id,name,sku`,
    { headers: bcHeaders() },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as BCCatalogProduct[];
}

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({ connected: false, error: 'BigCommerce not configured' });
  }

  try {
    // ── 1. Discover "60 Days to Band 6" products ──────────────────────────────
    const [r1, r2] = await Promise.all([
      searchProducts('60 days'),
      searchProducts('band 6'),
    ]);

    // Merge, dedup by product id
    const seen = new Set<number>();
    const products: BCCatalogProduct[] = [];
    for (const p of [...r1, ...r2]) {
      if (!seen.has(p.id)) { seen.add(p.id); products.push(p); }
    }

    if (products.length === 0) {
      return NextResponse.json({
        connected: true,
        error: 'No "60 Days to Band 6" products found in the BigCommerce catalogue. Check product names include "60 days" or "band 6".',
        products: [],
        revenue: 0, orders: 0, units: 0,
        target: TARGET_REVENUE, startDate: START_DATE, endDate: END_DATE,
        daysRemaining: Math.max(0, Math.round((new Date(END_DATE).getTime() - Date.now()) / 86_400_000)),
      });
    }

    const productIds = new Set(products.map(p => p.id));

    // ── 2. Fetch all orders from July 2026 → today ───────────────────────────
    const today = new Date().toISOString().split('T')[0]!;
    const orders = await fetchAllOrderPages({
      min_date_created: `${START_DATE}T00:00:00+10:00`,
      max_date_created: `${today}T23:59:59+10:00`,
    });
    const validOrders = orders.filter(o => !EXCLUDED_STATUSES.has(o.status));

    // ── 3. Walk order line items in batches of 10 ────────────────────────────
    let totalRevenue = 0;
    let totalOrders  = 0;
    let totalUnits   = 0;

    const BATCH = 10;
    for (let i = 0; i < validOrders.length; i += BATCH) {
      const batch = validOrders.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(order =>
          fetch(`${BC_BASE}/orders/${order.id}/products?limit=250`, { headers: bcHeaders() })
            .then(r => r.ok ? (r.json() as Promise<BCOrderProduct[]>) : Promise.resolve([] as BCOrderProduct[]))
            .catch(() => [] as BCOrderProduct[]),
        ),
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result?.status !== 'fulfilled') continue;
        const lineItems: BCOrderProduct[] = Array.isArray(result.value) ? result.value : [];
        const band6Items = lineItems.filter(li => productIds.has(li.product_id));
        if (band6Items.length === 0) continue;

        const orderRevenue = band6Items.reduce(
          (s, li) => s + parseFloat(li.price_inc_tax || '0') * li.quantity, 0,
        );
        totalRevenue += orderRevenue;
        totalOrders++;
        totalUnits += band6Items.reduce((s, li) => s + li.quantity, 0);
      }
    }

    const daysRemaining = Math.max(
      0,
      Math.round((new Date(END_DATE).getTime() - Date.now()) / 86_400_000),
    );

    return NextResponse.json({
      connected:    true,
      products:     products.map(p => ({ id: p.id, name: p.name, sku: p.sku })),
      revenue:      Math.round(totalRevenue * 100) / 100,
      orders:       totalOrders,
      units:        totalUnits,
      target:       TARGET_REVENUE,
      startDate:    START_DATE,
      endDate:      END_DATE,
      daysRemaining,
    });

  } catch (e) {
    return NextResponse.json({
      connected: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}
