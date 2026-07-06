/**
 * GET /api/bc-performance
 *
 * Returns top-selling products this calendar month (by revenue),
 * worst-performing products over the last 30 days, and an
 * abandoned-cart summary for the last 30 days.
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
  id: number;
  total_inc_tax: string;
  status: string;
}

interface BCLineItem {
  name:           string;
  sku:            string;
  quantity:       number;
  price_inc_tax:  string;
}

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({
      connected: false,
      topProducts: [],
      bottomProducts: [],
      abandonedCarts: { count: 0, value: 0 },
    });
  }

  try {
    // AEST month range
    const nowUTC = new Date();
    const aestMs  = nowUTC.getTime() + 10 * 60 * 60 * 1000;
    const aestNow = new Date(aestMs);
    const y = aestNow.getUTCFullYear();
    const m = aestNow.getUTCMonth();
    const startOfMonth  = new Date(Date.UTC(y, m, 1));
    const thirtyDaysAgo = new Date(aestMs - 30 * 24 * 60 * 60 * 1000);

    const startISO     = `${startOfMonth.toISOString().split('T')[0]}T00:00:00+10:00`;
    const endISO       = `${aestNow.toISOString().split('T')[0]}T23:59:59+10:00`;
    const thirty30ISO  = thirtyDaysAgo.toISOString();

    // Statuses excluded from revenue (same as BC dashboard)
    const excluded = new Set(['Cancelled', 'Refunded', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required']);

    // 1. Three parallel fetches: current-month orders, last-30-days orders, abandoned carts
    const [ordersRes, orders30Res, abandonedRes] = await Promise.all([
      fetch(`${BC_BASE}/orders?min_date_created=${startISO}&max_date_created=${endISO}&limit=100`, { headers: bcHeaders() }),
      fetch(`${BC_BASE}/orders?min_date_created=${thirty30ISO}&max_date_created=${endISO}&limit=100`, { headers: bcHeaders() }),
      fetch(`${BC_BASE}/orders?status_id=0&min_date_created=${thirty30ISO}&limit=50`, { headers: bcHeaders() }),
    ]);

    const ordersRaw    = ordersRes.ok    ? await ordersRes.json()    : [];
    const orders30Raw  = orders30Res.ok  ? await orders30Res.json()  : [];
    const abandonedRaw = abandonedRes.ok ? await abandonedRes.json() : [];

    const validOrders:    BCOrder[] = (Array.isArray(ordersRaw)    ? ordersRaw    : []).filter((o: BCOrder) => !excluded.has(o.status));
    const validOrders30:  BCOrder[] = (Array.isArray(orders30Raw)  ? orders30Raw  : []).filter((o: BCOrder) => !excluded.has(o.status));
    const abandonedOrders: BCOrder[] = Array.isArray(abandonedRaw) ? abandonedRaw : [];

    // 2. Helper: fetch line items for up to 40 orders and aggregate by product name
    const buildProductMap = async (orders: BCOrder[]): Promise<Record<string, { name: string; quantity: number; revenue: number }>> => {
      const results = await Promise.allSettled(
        orders.slice(0, 40).map(o =>
          fetch(`${BC_BASE}/orders/${o.id}/products`, { headers: bcHeaders() })
            .then(r => r.ok ? r.json() : []),
        ),
      );
      const map: Record<string, { name: string; quantity: number; revenue: number }> = {};
      for (const res of results) {
        if (res.status !== 'fulfilled' || !Array.isArray(res.value)) continue;
        for (const item of res.value as BCLineItem[]) {
          const name = item.name ?? item.sku ?? 'Unknown';
          if (!map[name]) map[name] = { name, quantity: 0, revenue: 0 };
          map[name].quantity += Number(item.quantity ?? 0);
          map[name].revenue  += Number(item.price_inc_tax ?? 0) * Number(item.quantity ?? 0);
        }
      }
      return map;
    };

    // 3. Build both product maps in parallel
    const [productMap, productMap30] = await Promise.all([
      buildProductMap(validOrders),
      buildProductMap(validOrders30),
    ]);

    // 4. Top products = current month, highest revenue first
    const sortedDesc = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    const topProducts = sortedDesc.slice(0, 12).map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    // 5. Bottom products = last 30 days, lowest revenue first (must have sold at least 1 unit)
    const sortedAsc = Object.values(productMap30)
      .filter(p => p.quantity > 0)
      .sort((a, b) => a.revenue - b.revenue);
    const bottomProducts = sortedAsc.slice(0, 10).map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    // 6. Abandoned carts summary
    const abandonedCount = abandonedOrders.length;
    const abandonedValue = abandonedOrders.reduce((sum: number, o: BCOrder) => sum + Number(o.total_inc_tax ?? 0), 0);

    return NextResponse.json({
      connected: true,
      topProducts,
      bottomProducts,
      abandonedCarts: { count: abandonedCount, value: Math.round(abandonedValue * 100) / 100 },
    });

  } catch (e) {
    console.error('[bc-performance]', e);
    return NextResponse.json({
      connected: false,
      error: String(e),
      topProducts: [],
      bottomProducts: [],
      abandonedCarts: { count: 0, value: 0 },
    }, { status: 500 });
  }
}
