/**
 * GET /api/business-unit-daily?brand=pp|etz|ehc|blake&days=90
 *
 * Daily revenue and orders for the last N days (Sydney dates, today included as a partial day),
 * with a 7-day moving average and a rising/falling summary. Revenue rules match the Business Units
 * cards: Stripe net of refunds (ETZ, EHC) and BigCommerce valid orders inc. tax (PP, Blake).
 * Summary figures use complete days only, so the partial total for today never drags the trend down.
 */
import { NextResponse } from 'next/server';
import { fetchETZDailyRevenue, fetchHSCDailyRevenue } from '@/lib/stripe-revenue';
import { fetchPPDailyRevenue, fetchBlakeDailyRevenue } from '@/lib/bigcommerce-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Brand = 'pp' | 'etz' | 'ehc' | 'blake';

function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const brand = (sp.get('brand') ?? 'pp') as Brand;
  const days = Math.min(Math.max(Number(sp.get('days') ?? '90') || 90, 14), 180);
  if (!['pp', 'etz', 'ehc', 'blake'].includes(brand)) {
    return NextResponse.json({ error: 'brand must be pp, etz, ehc or blake' }, { status: 400 });
  }

  const today = sydneyToday();
  const start = addDays(today, -(days - 1));

  let byDay: Record<string, { revenue: number; orders: number }>;
  try {
    byDay =
      brand === 'etz' ? await fetchETZDailyRevenue(start, today) :
      brand === 'ehc' ? await fetchHSCDailyRevenue(start, today) :
      brand === 'blake' ? await fetchBlakeDailyRevenue(start, today) :
      await fetchPPDailyRevenue(start, today);
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : 'Failed to load' }, { status: 502 });
  }

  const series: { date: string; revenue: number; orders: number; ma7: number | null; partial: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const v = byDay[date] ?? { revenue: 0, orders: 0 };
    series.push({ date, revenue: v.revenue, orders: v.orders, ma7: null, partial: date === today });
  }
  series.forEach((p, i) => {
    if (p.partial || i < 6) return;
    p.ma7 = Math.round(avg(series.slice(i - 6, i + 1).map(x => x.revenue)) * 100) / 100;
  });

  const complete = series.filter(p => !p.partial).map(p => p.revenue);
  const last30 = complete.slice(-30), prior30 = complete.slice(-60, -30);
  const last7 = complete.slice(-7), prior7 = complete.slice(-14, -7);

  return NextResponse.json(
    {
      connected: true, brand, days, start, end: today,
      series,
      summary: {
        last30Avg: Math.round(avg(last30)), prior30Avg: Math.round(avg(prior30)), last30Change: pct(avg(last30), avg(prior30)),
        last7Avg: Math.round(avg(last7)), prior7Avg: Math.round(avg(prior7)), last7Change: pct(avg(last7), avg(prior7)),
        hasPrior30: prior30.length === 30,
        total: Math.round(series.reduce((s, p) => s + p.revenue, 0) * 100) / 100,
      },
    },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' } },
  );
}
