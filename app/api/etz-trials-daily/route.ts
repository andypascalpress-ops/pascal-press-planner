/**
 * GET /api/etz-trials-daily?days=90   (30 to 365)
 *
 * Excel Test Zone free trials started per day (Sydney dates, complete days up to yesterday) from the UMS
 * transaction list (one trial per pack; matches the UMS export), with a 7-day moving average and a
 * rising/falling summary. Counts only. Includes a few internal test sign-ups.
 */
import { NextResponse } from 'next/server';
import { fetchUmsDailyTrials } from '@/lib/ums-transactions';
import { umsConfigured } from '@/lib/ums-trials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function GET(request: Request) {
  if (!umsConfigured()) return NextResponse.json({ connected: false, error: 'UMS is not configured' }, { status: 503 });
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days') ?? '90') || 90, 30), 365);
  const end = addDays(sydneyToday(), -1);      // complete days only
  const start = addDays(end, -(days - 1));

  let byDay: Record<string, number>;
  try {
    byDay = await fetchUmsDailyTrials(start, end);
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message.slice(0, 200) : 'Failed to load' }, { status: 502 });
  }

  const series: { date: string; trials: number; ma7: number | null }[] = [];
  for (let i = 0; i < days; i++) series.push({ date: addDays(start, i), trials: byDay[addDays(start, i)] ?? 0, ma7: null });
  series.forEach((p, i) => { if (i >= 6) p.ma7 = r1(avg(series.slice(i - 6, i + 1).map(x => x.trials))); });

  const v = series.map(p => p.trials);
  const last30 = v.slice(-30), prior30 = v.slice(-60, -30), last7 = v.slice(-7), prior7 = v.slice(-14, -7);
  return NextResponse.json(
    {
      connected: true, days, start, end, series,
      summary: {
        last30Avg: r1(avg(last30)), prior30Avg: r1(avg(prior30)), last30Change: pct(avg(last30), avg(prior30)),
        last7Avg: r1(avg(last7)), prior7Avg: r1(avg(prior7)), last7Change: pct(avg(last7), avg(prior7)),
        hasPrior30: prior30.length === 30, total: v.reduce((a, b) => a + b, 0),
      },
    },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' } },
  );
}
