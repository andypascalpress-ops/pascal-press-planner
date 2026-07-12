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

export const revalidate = 0; // always fresh — tracker data changes frequently

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

/**
 * Search multiple keyword variants and validate results by name.
 * Returns products whose names actually contain "band 6" / "band6" / "60 days".
 */
async function findBand6Products(): Promise<BCCatalogProduct[]> {
  const TERMS = ['60 days', 'band 6', '60days', 'band6', '60 day'];
  const batches = await Promise.all(TERMS.map(t => searchProducts(t)));

  const seen = new Set<number>();
  const products: BCCatalogProduct[] = [];
  for (const p of batches.flat()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const name = p.name.toLowerCase();
    // Keep only products whose name actually references Band 6 or 60 Days
    if (
      name.includes('band 6') || name.includes('band6') ||
      name.includes('60 days') || name.includes('60days') || name.includes('60-days')
    ) {
      products.push(p);
    }
  }
  return products;
}

export async function GET(request: Request) {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({ connected: false, error: 'BigCommerce not configured' });
  }

  const debug = new URL(request.url).searchParams.get('debug') === '1';

  try {
    // ── 1. Discover products via catalog search (best-effort; used for display + ID match)
    const products = await findBand6Products();
    // Product IDs for exact matching — may be empty if catalog search misses them
    const productIds = new Set(products.map(p => p.id));

    // ── 2. Fetch all orders from July 2026 → today ───────────────────────────
    // Use Australia/Sydney "today" so the window matches AU storefront days
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const orders = await fetchAllOrderPages({
      min_date_created: `${START_DATE}T00:00:00+10:00`,
      max_date_created: `${today}T23:59:59+10:00`,
    });
    const validOrders = orders.filter(o => !EXCLUDED_STATUSES.has(o.status));

    // ── 3. Walk order line items in batches of 10 ────────────────────────────
    let totalRevenue = 0;
    let totalOrders  = 0;
    let totalUnits   = 0;
    // productId → aggregate stats for the UI breakdown
    const byProductMap = new Map<number, {
      productId: number;
      name: string;
      units: number;
      revenue: number;
      orderIds: Set<number>;
    }>();
    const breakdown: Array<{
      orderId: number;
      status: string;
      date: string;
      productId: number;
      name: string;
      quantity: number;
      unitPriceIncTax: number;
      lineTotalIncTax: number;
      totalFieldIncTax: number | null;
      match: 'product_id' | 'name';
    }> = [];

    const BATCH = 10;
    for (let i = 0; i < validOrders.length; i += BATCH) {
      const batch = validOrders.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(order =>
          fetch(`${BC_BASE}/orders/${order.id}/products?limit=250`, { headers: bcHeaders() })
            .then(r => r.ok ? (r.json() as Promise<any[]>) : Promise.resolve([] as any[]))
            .catch(() => [] as any[]),
        ),
      );

      for (let j = 0; j < batch.length; j++) {
        const order = batch[j]!;
        const result = results[j];
        if (result?.status !== 'fulfilled') continue;
        const lineItems: any[] = Array.isArray(result.value) ? result.value : [];

        const matched: Array<{ li: any; match: 'product_id' | 'name' }> = [];
        for (const li of lineItems) {
          if (productIds.size > 0 && productIds.has(li.product_id)) {
            matched.push({ li, match: 'product_id' });
            continue;
          }
          const n = (li.name ?? '').toLowerCase();
          if (
            n.includes('band 6') || n.includes('band6') ||
            n.includes('60 days') || n.includes('60days') || n.includes('60-days')
          ) {
            matched.push({ li, match: 'name' });
          }
        }
        if (matched.length === 0) continue;

        // Prefer BC line total_inc_tax when present (already qty × unit); else unit × qty
        let orderRevenue = 0;
        let orderUnits = 0;
        for (const { li, match } of matched) {
          const qty = Number(li.quantity) || 0;
          const unit = parseFloat(li.price_inc_tax || '0') || 0;
          const totalField = li.total_inc_tax != null ? parseFloat(li.total_inc_tax) : null;
          const lineTotal = totalField != null && !Number.isNaN(totalField)
            ? totalField
            : unit * qty;
          orderRevenue += lineTotal;
          orderUnits += qty;

          const pid = Number(li.product_id) || 0;
          const existing = byProductMap.get(pid);
          if (existing) {
            existing.units += qty;
            existing.revenue += lineTotal;
            existing.orderIds.add(order.id);
          } else {
            byProductMap.set(pid, {
              productId: pid,
              name: String(li.name ?? 'Unknown'),
              units: qty,
              revenue: lineTotal,
              orderIds: new Set([order.id]),
            });
          }

          if (debug) {
            breakdown.push({
              orderId: order.id,
              status: order.status,
              date: order.date_created,
              productId: pid,
              name: li.name,
              quantity: qty,
              unitPriceIncTax: unit,
              lineTotalIncTax: Math.round(lineTotal * 100) / 100,
              totalFieldIncTax: totalField,
              match,
            });
          }
        }
        totalRevenue += orderRevenue;
        totalOrders++;
        totalUnits += orderUnits;
      }
    }

    const productBreakdown = [...byProductMap.values()]
      .map(p => ({
        productId: p.productId,
        name: p.name,
        // Short label: strip leading "Excel 60 Days to Band 6" noise for UI
        shortName: p.name
          .replace(/^Excel\s+/i, '')
          .replace(/60\s*Days\s*to\s*Band\s*6\s*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim() || p.name,
        units: p.units,
        orders: p.orderIds.size,
        revenue: Math.round(p.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const daysRemaining = Math.max(
      0,
      Math.round((new Date(END_DATE).getTime() - Date.now()) / 86_400_000),
    );

    const payload: Record<string, unknown> = {
      connected:    true,
      products:     products.map(p => ({ id: p.id, name: p.name, sku: p.sku })),
      productBreakdown,
      revenue:      Math.round(totalRevenue * 100) / 100,
      orders:       totalOrders,
      units:        totalUnits,
      target:       TARGET_REVENUE,
      startDate:    START_DATE,
      endDate:      END_DATE,
      daysRemaining,
      method:       'line_items total_inc_tax (fallback price_inc_tax × qty), GST-inclusive',
      orderWindow:  { min: `${START_DATE}T00:00:00+10:00`, max: `${today}T23:59:59+10:00` },
      validOrderCount: validOrders.length,
      catalogMatchCount: products.length,
    };
    if (debug) {
      payload.breakdown = breakdown;
      payload.excludedStatuses = [...EXCLUDED_STATUSES];
    }

    return NextResponse.json(payload);

  } catch (e) {
    return NextResponse.json({
      connected: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}
