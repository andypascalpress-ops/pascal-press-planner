/**
 * GET /api/bc-product-yoy
 *
 * Returns product performance for:
 *   - Current MTD  (e.g. July 1–7 2026)
 *   - Same MTD last year (e.g. July 1–7 2025)
 *
 * Per product: revenue, orders (distinct), units sold, AOV — plus YOY % changes.
 * Returns top 20 and bottom 20 by current revenue.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

function bcHeaders() {
  return {
    'X-Auth-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

const EXCLUDED = new Set([
  'Cancelled', 'Refunded', 'Declined',
  'Incomplete', 'Awaiting Payment', 'Manual Verification Required',
]);

interface BCOrder { id: number; total_inc_tax: string; status: string; }
interface BCLineItem { name: string; sku: string; quantity: number; price_inc_tax: string; }

export interface ProductMetrics {
  revenue: number;
  orders:  number;
  units:   number;
  aov:     number;
}

export interface ProductRow {
  name:           string;
  current:        ProductMetrics;
  lastYear:       ProductMetrics;
  yoyRevenuePct:  number | null;
  yoyOrdersPct:   number | null;
  yoyUnitsPct:    number | null;
}

function yoyPct(curr: number, ly: number): number | null {
  if (ly === 0 && curr === 0) return null;
  if (ly === 0) return null; // new product — show null (UI handles as "NEW")
  return Math.round(((curr - ly) / ly) * 1000) / 10; // 1 dp
}

function toAESTDateStr(d: Date): string {
  // Shift to AEST (UTC+10)
  const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  return aest.toISOString().slice(0, 10); // YYYY-MM-DD
}

function bcDateParam(dateStr: string, endOfDay = false): string {
  const dt = endOfDay
    ? `${dateStr}T23:59:59+10:00`
    : `${dateStr}T00:00:00+10:00`;
  return encodeURIComponent(dt);
}

async function fetchProductsForPeriod(
  start: string, // YYYY-MM-DD AEST
  end:   string,
): Promise<Map<string, ProductMetrics>> {
  const url = `${BC_BASE}/orders?min_date_created=${bcDateParam(start)}&max_date_created=${bcDateParam(end, true)}&limit=100`;
  const res = await fetch(url, { headers: bcHeaders() });
  const raw = res.ok ? await res.json() : [];
  const allOrders: BCOrder[] = Array.isArray(raw) ? raw : [];
  const valid = allOrders.filter(o => !EXCLUDED.has(o.status));

  // Fetch line items for up to 40 orders in parallel
  const lineItemResults = await Promise.allSettled(
    valid.slice(0, 40).map(o =>
      fetch(`${BC_BASE}/orders/${o.id}/products`, { headers: bcHeaders() })
        .then(r => r.ok ? r.json() as Promise<BCLineItem[]> : []),
    ),
  );

  const map = new Map<string, ProductMetrics>();

  lineItemResults.forEach((result, idx) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
    const orderId = valid[idx]?.id;
    if (!orderId) return;

    for (const item of result.value) {
      const key = (item.name ?? item.sku ?? 'Unknown').trim();
      const qty = Number(item.quantity ?? 0);
      const rev = Number(item.price_inc_tax ?? 0) * qty;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, { revenue: rev, orders: 1, units: qty, aov: 0 });
      } else {
        existing.revenue += rev;
        existing.orders  += 1; // 1 per order this product appears in
        existing.units   += qty;
      }
    }
  });

  // Compute AOV and round revenue
  for (const [, m] of map) {
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.aov     = m.orders > 0 ? Math.round((m.revenue / m.orders) * 100) / 100 : 0;
  }

  return map;
}

function formatLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({ connected: false });
  }

  try {
    const now   = new Date();
    const today = toAESTDateStr(now);
    const year  = parseInt(today.slice(0, 4));
    const mon   = parseInt(today.slice(5, 7));
    const monthStart = `${year}-${String(mon).padStart(2, '0')}-01`;

    // Last year same MTD
    const lyStart = `${year - 1}-${String(mon).padStart(2, '0')}-01`;
    const lyEnd   = `${year - 1}-${today.slice(5)}`; // same day-of-month

    const [currentMap, lyMap] = await Promise.all([
      fetchProductsForPeriod(monthStart, today),
      fetchProductsForPeriod(lyStart, lyEnd),
    ]);

    // Union of all product names from both periods
    const allNames = new Set([...currentMap.keys(), ...lyMap.keys()]);

    const empty: ProductMetrics = { revenue: 0, orders: 0, units: 0, aov: 0 };

    const rows: ProductRow[] = [];
    for (const name of allNames) {
      const curr = currentMap.get(name) ?? { ...empty };
      const ly   = lyMap.get(name)      ?? { ...empty };
      rows.push({
        name,
        current:       curr,
        lastYear:      ly,
        yoyRevenuePct: yoyPct(curr.revenue, ly.revenue),
        yoyOrdersPct:  yoyPct(curr.orders,  ly.orders),
        yoyUnitsPct:   yoyPct(curr.units,   ly.units),
      });
    }

    // Sort by current revenue desc for top, asc for bottom
    const byRevDesc = [...rows].sort((a, b) => b.current.revenue - a.current.revenue);
    const topProducts    = byRevDesc.slice(0, 20);
    const bottomProducts = [...rows]
      .filter(r => r.current.revenue > 0 || r.current.units > 0)
      .sort((a, b) => a.current.revenue - b.current.revenue)
      .slice(0, 20);

    return NextResponse.json({
      connected:    true,
      currentLabel: `${formatLabel(monthStart)} – ${formatLabel(today)}`,
      lyLabel:      `${formatLabel(lyStart)} – ${formatLabel(lyEnd)}`,
      topProducts,
      bottomProducts,
    });

  } catch (e) {
    console.error('[bc-product-yoy]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
