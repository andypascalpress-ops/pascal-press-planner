/**
 * GET /api/etz-revenue-streams?start&end&compStart&compEnd
 *
 * Excel Test Zone school revenue (invoice orders) from the UMS transaction list, for the selected period, a comparison
 * period and the last 12 months by month. Counts and totals only. Parent (online) revenue is NOT taken from here: the UMS
 * card totals include duplicated bundle rows before Sep 2026, so the dashboard uses Stripe for that.
 */
import { NextResponse } from 'next/server';
import { fetchUmsDailyStreams, type DailyStreams } from '@/lib/ums-transactions';
import { umsConfigured } from '@/lib/ums-trials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const r2 = (n: number) => Math.round(n * 100) / 100;

function sum(days: Record<string, DailyStreams>, from: string, to: string) {
  let invoiceOrders = 0, invoiceTotal = 0, paid = 0, alloc = 0;
  for (const [d, v] of Object.entries(days)) {
    if (d < from || d > to) continue;
    invoiceOrders += v.invoiceOrders; invoiceTotal += v.invoiceTotal; paid += v.invoicePaidOrders; alloc += v.invoiceAllocations;
  }
  return { revenue: r2(invoiceTotal), orders: invoiceOrders, paidOrders: paid, allocations: alloc };
}

export async function GET(request: Request) {
  if (!umsConfigured()) return NextResponse.json({ connected: false, error: 'UMS is not configured' }, { status: 503 });
  const sp = new URL(request.url).searchParams;
  const start = sp.get('start') ?? '', end = sp.get('end') ?? '', cs = sp.get('compStart') ?? '', ce = sp.get('compEnd') ?? '';
  if (![start, end, cs, ce].every(v => ymd.test(v)) || start > end || cs > ce) {
    return NextResponse.json({ connected: false, error: 'start, end, compStart and compEnd required (YYYY-MM-DD)' }, { status: 400 });
  }

  // last 12 calendar months ending with the current month (same months as the dashboard's monthly trend), plus the comparison period
  const lastMonth = sydneyToday();
  const [ey, em] = lastMonth.split('-').map(Number);
  const first = new Date(Date.UTC(ey!, em! - 12, 1, 12)).toISOString().slice(0, 10);   // 11 months before + the current month
  const winStart = [first, cs].sort()[0]!;
  let days: Record<string, DailyStreams>;
  try {
    days = await fetchUmsDailyStreams(winStart, lastMonth > end ? lastMonth : end);
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message.slice(0, 200) : 'Failed to load' }, { status: 502 });
  }

  const months: { month: string; schools: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(Date.UTC(ey!, em! - 12 + i, 1, 12));
    const key = m.toISOString().slice(0, 7);
    const a = `${key}-01`, b = `${key}-31`;
    const t = sum(days, a, b);
    months.push({ month: key, schools: t.revenue });
  }

  return NextResponse.json(
    { connected: true, current: sum(days, start, end), prior: sum(days, cs, ce), months, period: { start, end }, comparison: { start: cs, end: ce } },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' } },
  );
}
