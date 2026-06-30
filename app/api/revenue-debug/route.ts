/**
 * Debug endpoint to diagnose BigCommerce and Stripe revenue discrepancies.
 * Usage: GET /api/revenue-debug?month=2026-06
 */
import { NextRequest, NextResponse } from 'next/server';

const STORE_HASH    = process.env.BIGCOMMERCE_STORE_HASH    ?? '';
const ACCESS_TOKEN  = process.env.BIGCOMMERCE_ACCESS_TOKEN  ?? '';
const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY         ?? '';
const BC_BASE       = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const STRIPE_BASE   = 'https://api.stripe.com/v1';

function bcHeaders()     { return { 'X-Auth-Token': ACCESS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' }; }
function stripeHeaders() { return { Authorization: `Bearer ${STRIPE_KEY}` }; }

function monthRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year!, mon!, 0).getDate();
  const start = `${year}-${String(mon).padStart(2,'0')}-01`;
  const end   = `${year}-${String(mon).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  return { start, end };
}

// ─── BigCommerce ──────────────────────────────────────────────────────────────

async function debugBC(month: string) {
  if (!STORE_HASH || !ACCESS_TOKEN) return { error: 'BigCommerce env vars not set' };

  const { start, end } = monthRange(month);
  const allOrders: any[] = [];

  for (const tz of ['+10:00', '+11:00', '+00:00']) {
    const orders: any[] = [];
    let page = 1;
    while (true) {
      const qs = new URLSearchParams({
        min_date_created: `${start}T00:00:00${tz}`,
        max_date_created: `${end}T23:59:59${tz}`,
        page: String(page),
        limit: '250',
      });
      const res = await fetch(`${BC_BASE}/orders?${qs}`, { headers: bcHeaders() });
      if (res.status === 204 || res.status === 404) break;
      if (!res.ok) { break; }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      orders.push(...data);
      if (data.length < 250) break;
      page++;
    }

    const byStatus: Record<string, { count: number; totalIncTax: number; totalExTax: number }> = {};
    for (const o of orders) {
      const s = o.status ?? 'Unknown';
      if (!byStatus[s]) byStatus[s] = { count: 0, totalIncTax: 0, totalExTax: 0 };
      byStatus[s].count++;
      byStatus[s].totalIncTax += parseFloat(o.total_inc_tax || '0');
      byStatus[s].totalExTax  += parseFloat(o.total_ex_tax  || '0');
    }

    const EXCLUDED = new Set(['Cancelled', 'Refunded', 'Incomplete']);
    const valid = orders.filter(o => !EXCLUDED.has(o.status));

    allOrders.push({
      timezone: tz,
      totalOrders: orders.length,
      validOrders: valid.length,
      revenue_incTax_allStatuses: orders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0).toFixed(2),
      revenue_incTax_valid:       valid.reduce((s, o)  => s + parseFloat(o.total_inc_tax || '0'), 0).toFixed(2),
      revenue_exTax_valid:        valid.reduce((s, o)  => s + parseFloat(o.total_ex_tax  || '0'), 0).toFixed(2),
      byStatus,
      firstOrder: orders[0]  ? { id: orders[0].id,  date: orders[0].date_created,  status: orders[0].status,  total_inc: orders[0].total_inc_tax }  : null,
      lastOrder:  orders[orders.length - 1] ? { id: orders[orders.length-1].id, date: orders[orders.length-1].date_created, status: orders[orders.length-1].status, total_inc: orders[orders.length-1].total_inc_tax } : null,
    });
  }

  return allOrders;
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

async function debugStripe(month: string) {
  if (!STRIPE_KEY) return { error: 'STRIPE_SECRET_KEY not set' };

  const { start, end } = monthRange(month);
  const [year, mon] = month.split('-').map(Number);

  // Try 3 timezone offsets: AEST (-10h), AEDT (-11h), UTC (0h)
  const offsets = [
    { label: 'AEST UTC+10', offsetMs: 10 * 3600 * 1000 },
    { label: 'AEDT UTC+11', offsetMs: 11 * 3600 * 1000 },
    { label: 'UTC',          offsetMs: 0 },
  ];

  const results = [];

  for (const { label, offsetMs } of offsets) {
    const gte = Math.floor((Date.UTC(year!, mon! - 1, 1)                    - offsetMs) / 1000);
    const lte = Math.floor((Date.UTC(year!, mon!, 0, 23, 59, 59)            - offsetMs) / 1000);

    let totalCents = 0;
    let totalOrders = 0;
    const byCurrency: Record<string, number> = {};
    let startingAfter: string | null = null;

    while (true) {
      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
      if (!res.ok) break;

      const data = await res.json();
      for (const charge of data.data) {
        if (charge.paid && charge.status === 'succeeded') {
          const net = charge.amount - (charge.amount_refunded ?? 0);
          totalCents += net;
          totalOrders++;
          byCurrency[charge.currency] = (byCurrency[charge.currency] ?? 0) + net;
        }
      }
      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1].id;
    }

    results.push({
      timezone: label,
      gteUnix: gte,
      lteUnix: lte,
      gteDate: new Date(gte * 1000).toISOString(),
      lteDate: new Date(lte * 1000).toISOString(),
      totalOrders,
      totalAUD: (totalCents / 100).toFixed(2),
      byCurrency: Object.fromEntries(
        Object.entries(byCurrency).map(([k, v]) => [k, (v / 100).toFixed(2)])
      ),
    });
  }

  return results;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '2026-06';

  const [bcData, stripeData] = await Promise.all([
    debugBC(month),
    debugStripe(month),
  ]);

  return NextResponse.json({ month, bigcommerce: bcData, stripe: stripeData }, { status: 200 });
}
