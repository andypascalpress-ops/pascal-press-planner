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

    // Excluded statuses that BigCommerce dashboard doesn't count as revenue
    const excluded = new Set(['Cancelled', 'Refunded', 'Incomplete', 'Awaiting Payment', 'Manual Verification Required']);

    // 1. Fetch this month's completed orders
    const ordersRes = await fetch(
      `${BC_BASE}/orders?min_date_created=${startISO}&max_date_created=${endISO}&limit=100`,
      { headers: bcHeaders() },
    );
    const ordersRaw = ordersRes.ok ? await ordersRes.json() : [];
    const validOrders: BCOrder[] = (Array.isArray(ordersRaw) ? ordersRaw : [])
      .filter((o: BCOrder) => !excluded.has(o.status));

    // 2. Fetch line items for first 40 orders (to avoid timeout)
    const slice = validOrders.slice(0, 40);
    const lineItemResults = await Promise.allSettled(
      slice.map(o =>
        fetch(`${BC_BASE}/orders/${o.id}/products`, { headers: bcHeaders() })
          .then(r => r.ok ? r.json() : []),
      ),
    );

    // 3. Aggregate by product name
    const productMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
    for (const result of lineItemResults) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
      for (const item of result.value as BCLineItem[]) {
        const name = item.name ?? item.sku ?? 'Unknown';
        if (!productMap[name]) productMap[name] = { name, quantity: 0, revenue: 0 };
        productMap[name].quantity += Number(item.quantity ?? 0);
        productMap[name].revenue  += Number(item.price_inc_tax ?? 0) * Number(item.quantity ?? 0);
      }
    }

    const sorted = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    const topProducts = sorted.slice(0, 12).map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));
    // Bottom performers — products with sales but lowest revenue this month
    const bottomProducts = sorted.slice(-5).reverse().map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    // 4. Abandoned carts = Incomplete orders in last 30 days
    const abandonedRes = await fetch(
      `${BC_BASE}/orders?min_date_created=${thirtyDaysAgo.toISOString()}&status_id=0&limit=100`,
      { headers: bcHeaders() },
    );
    const abandonedRaw = abandonedRes.ok ? await abandonedRes.json() : [];
    const abandoned = Array.isArray(abandonedRaw) ? abandonedRaw : [];
    const abandonedValue = abandoned.reduce(
      (s: number, o: BCOrder) => s + parseFloat(o.total_inc_tax || '0'),
      0,
    );

    return NextResponse.json({
      connected: true,
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
      connected:      false,
      topProducts:    [],
      abandonedCarts: { count: 0, value: 0 },
      error:          String(e),
    });
  }
}
