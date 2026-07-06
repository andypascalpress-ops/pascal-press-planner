/**
 * GET /api/bc-performance
 *
 * Returns top-selling products this calendar month (by revenue) and
 * an abandoned-cart summary for the last 30 days.
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
      abandonedCarts: { count: 0, value: 0 },
    });
  }

  try {
    // AEST month range
    const nowUTC = new Date();
    // Offset to AEST (UTC+10)
    const aestMs  = nowUTC.getTime() + 10 * 60 * 60 * 1000;
    const aestNow = new Date(aestMs);
    const y = aestNow.getUTCFullYear();
    const m = aestNow.getUTCMonth();
    const startOfMonth  = new Date(Date.UTC(y, m,  1));
    const thirtyDaysAgo = new Date(aestMs - 30 * 24 * 60 * 60 * 1000);

    const startISO = `${startOfMonth.toISOString().split('T')[0]}T00:00:00+10:00`;
    const endISO   = `${aestNow.toISOString().split('T')[0]}T23:59:59+10:00`;
    const thirty30ISO = thirtyDaysAgo.toISOString();

    // Excluded statuses that BigCommerce dashboard doesn't count as revenue
    const excluded = new Set(['Cancelled', 'Refunded', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required']);

    // 1. Fetch orders — two windows in parallel: current month (for top products) + last 30 days (for bottom products)
    const [ordersRes, orders30Res] = await Promise.all([
      fetch(`${BC_BASE}/orders?min_date_created=${startISO}&max_date_created=${endISO}&limit=100`, { headers: bcHeaders() }),
      fetch(`${BC_BASE}/orders?min_date_created=${thirty30ISO}&max_date_created=${endISO}&limit=100`, { headers: bcHeaders() }),
    ]);
    const ordersRaw   = ordersRes.ok   ? await ordersRes.json()   : [];
    const orders30Raw = orders30Res.ok ? await orders30Res.json() : [];

    const validOrders:   BCOrder[] = (Array.isArray(ordersRaw)   ? ordersRaw   : []).filter((o: BCOrder) => !excluded.has(o.status));
    const validOrders30: BCOrder[] = (Array.isArray(orders30Raw) ? orders30Raw : []).filter((o: BCOrder) => !excluded.has(o.status));

    // Helper: fetch line items for a set of orders and aggregate into a product map
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
    }

    // 2. Build product maps for both windows in parallel
    const [productMap, productMap30] = await Promise.all([
      buildProductMap(validOrders),
      buildProductMap(validOrders30),
    ]);

    // 3. Top products = current month sorted by revenue
    const sorted    = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    const sorted30  = Object.values(productMap30).sort((a, b) => b.revenue - a.revenue);
    const topProducts    = sorted.slice(0, 12).map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));
    // Bottom performers = last 30 days, lowest revenue products that had at least 1 sale
    const botto