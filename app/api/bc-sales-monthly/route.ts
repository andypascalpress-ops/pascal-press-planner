/**
 * GET /api/bc-sales-monthly
 * Returns all-time monthly revenue + order counts from BigCommerce.
 * Fetches year-by-year in parallel for performance.
 */
import { NextResponse } from 'next/server';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

const COMPLETED_STATUSES = new Set([
  'Completed', 'Shipped', 'Partially Shipped', 'Awaiting Fulfillment',
  'Awaiting Shipment', 'Awaiting Pickup', 'Pending',
]);

function bcHeaders() {
  return { 'X-Auth-Token': ACCESS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function bcDateParam(dateStr: string, endOfDay = false) {
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = MONTHS[mon! - 1]!;
  return encodeURIComponent(`${dow}, ${dd} ${mmm} ${year} ${endOfDay ? '23:59:59' : '00:00:00'} +1000`);
}

interface BCOrder {
  id: number;
  status: string;
  total_inc_tax: string;
  date_created: string;
}

async function fetchOrdersForYear(year: number): Promise<BCOrder[]> {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  const results: BCOrder[] = [];
  let page = 1;
  while (true) {
    const url = `${BC_BASE}/orders?min_date_created=${bcDateParam(start)}&max_date_created=${bcDateParam(end, true)}&limit=250&page=${page}&status_id=10`;
    const res = await fetch(url, { headers: bcHeaders(), cache: 'no-store' });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BC orders ${year} p${page} -> ${res.status}`);
    const data: BCOrder[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    // Filter to completed/shipped orders only for revenue accuracy
    results.push(...data.filter(o => COMPLETED_STATUSES.has(o.status)));
    if (data.length < 250) break;
    page++;
  }
  return results;
}

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) return NextResponse.json({ connected: false });

  try {
    const currentYear = new Date().getFullYear();
    const startYear   = 2019; // Pascal Press BC store history
    const years: number[] = [];
    for (let y = startYear; y <= currentYear; y++) years.push(y);

    // Fetch all years in parallel
    const yearResults = await Promise.all(years.map(y => fetchOrdersForYear(y)));
    const allOrders   = yearResults.flat();

    // Aggregate by YYYY-MM
    const monthMap = new Map<string, { revenue: number; orders: number }>();
    for (const order of allOrders) {
      // Parse date — BC returns RFC2822 or ISO
      const d = new Date(order.date_created);
      // Convert to AEST (UTC+10)
      const aest   = new Date(d.getTime() + 10 * 3600 * 1000);
      const month  = `${aest.getUTCFullYear()}-${String(aest.getUTCMonth() + 1).padStart(2, '0')}`;
      const rev    = parseFloat(order.total_inc_tax || '0');
      const entry  = monthMap.get(month);
      if (!entry) monthMap.set(month, { revenue: rev, orders: 1 });
      else { entry.revenue += rev; entry.orders += 1; }
    }

    // Sort chronologically and round revenue
    const months = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { revenue, orders }]) => ({
        month,
        revenue: Math.round(revenue * 100) / 100,
        orders,
      }));

    // Mark current month as partial
    const today     = new Date();
    const aestToday = new Date(today.getTime() + 10 * 3600 * 1000);
    const currentMonth = `${aestToday.getUTCFullYear()}-${String(aestToday.getUTCMonth() + 1).padStart(2, '0')}`;

    return NextResponse.json(
      { connected: true, months, currentMonth },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } }
    );

  } catch (e) {
    console.error('[bc-sales-monthly]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
