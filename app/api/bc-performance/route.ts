/**
 * GET /api/bc-performance
 *
 * Returns top-selling and worst-selling products over the last 30 days,
 * plus an abandoned-cart summary for the same window.
 *
 * Uses BigCommerce v2 REST API.
 * Env: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN
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

interface BCOrder {
  id:            number;
  total_inc_tax: string;
  status:        string;
  date_created:  string;
}

interface BCLineItem {
  name:          string;
  sku:           string;
  quantity:      number;
  price_inc_tax: string;
}

// Statuses excluded from revenue (mirrors BigCommerce dashboard)
const EXCLUDED = new Set([
  'Cancelled', 'Refunded', 'Declined',
  'Incomplete', 'Awaiting Payment', 'Manual Verification Required',
]);

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({
      connected: false, topProducts: [], bottomProducts: [],
      abandonedCarts: { count: 0, value: 0 },
    });
  }

  try {
    // ── Date range: last 30 days (plain UTC, no timezone suffix so BC accepts it) ──
    const now         = new Date();
    const thirtyAgo   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const minDate     = thirtyAgo.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const maxDate     = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const minEncoded  = encodeURIComponent(minDate);
    const maxEncoded  = encodeURIComponent(maxDate);

    // ── 1. Fetch last-30-day completed orders + abandoned carts in parallel ──
    const [ordersRes, abandonedRes] = await Promise.all([
      fetch(`${BC_BASE}/orders?min_date_created=${minEncoded}&max_date_created=${maxEncoded}&limit=150`, { headers: bcHeaders() }),
      fetch(`${BC_BASE}/orders?min_date_created=${minEncoded}&max_date_created=${maxEncoded}&status_id=0&limit=100`, { headers: bcHeaders() }),
    ]);

    const ordersRaw    = ordersRes.ok    ? await ordersRes.json()    : [];
    const abandonedRaw = abandonedRes.ok ? await abandonedRes.json() : [];

    const allOrders:   BCOrder[] = Array.isArray(ordersRaw)    ? ordersRaw    : [];
    const abandoned:   BCOrder[] = Array.isArray(abandonedRaw) ? abandonedRaw : [];

    // Filter to revenue-counting statuses only
    const validOrders = allOrders.filter(o => !EXCLUDED.has(o.status));

    // ── 2. Fetch line items for up to 50 valid orders ──
    const lineItemResults = await Promise.allSettled(
      validOrders.slice(0, 50).map(o =>
        fetch(`${BC_BASE}/orders/${o.id}/products`, { headers: bcHeaders() })
          .then(r => r.ok ? r.json() : []),
      ),
    );

    // ── 3. Aggregate by product name ──
    const map: Record<string, { name: string; quantity: number; revenue: number }> = {};
    for (const res of lineItemResults) {
      if (res.status !== 'fulfilled' || !Array.isArray(res.value)) continue;
      for (const item of res.value as BCLineItem[]) {
        const name = item.name ?? item.sku ?? 'Unknown';
        if (!map[name]) map[name] = { name, quantity: 0, revenue: 0 };
        map[name].quantity += Number(item.quantity  ?? 0);
        map[name].revenue  += Number(item.price_inc_tax ?? 0) * Number(item.quantity ?? 0);
      }
    }

    const allProducts = Object.values(map)
      .filter(p => p.quantity > 0)
      .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    // Highest revenue → top performers
    const topProducts = [...allProducts].sort((a, b) => b.revenue - a.revenue).slice(0, 12);
    // Lowest revenue → worst performers (rolling 30 days)
    const bottomProducts = [...allProducts].sort((a, b) => a.revenue - b.revenue).slice(0, 10);

    // ── 4. Abandoned carts summary ──
    const abandonedValue = abandoned.reduce(
      (s, o) => s + parseFloat(o.total_inc_tax || '0'), 0,
    );

    return NextResponse.json({
      connected:     true,
      topProducts,
      bottomProducts,
      abandonedCarts: {
        count: abandoned.length,
        value: Math.round(abandonedValue * 100) / 100,
      },
    });

  } catch (e) {
    console.error('[bc-performance]', e);
    return NextResponse.json({
      connected: false, error: String(e),
      topProducts: [], bottomProducts: [],
      abandonedCarts: { count: 0, value: 0 },
    }, { status: 500 });
  }
}
