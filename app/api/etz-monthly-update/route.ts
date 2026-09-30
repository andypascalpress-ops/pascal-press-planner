/**
 * GET /api/etz-monthly-update?month=YYYY-MM
 *
 * Answers the standing monthly report questions for Excel Test Zone:
 *   1. Revenue this month vs the same month last year
 *   2. Free trials started this month vs the same month last year
 *   3. Trial-to-paid % vs last year
 *   4. Best channel driving revenue, by %
 *
 * `month` defaults to the current calendar month (AEST). The comparison
 * month is the same calendar month one year earlier (e.g. September 2026
 * vs September 2025) — a plain year shift, since unlike a week there's no
 * day-of-week alignment to preserve.
 *
 * Trial-to-paid is a live snapshot, not a matured-cohort result — see
 * lib/hubspot-trials.ts's fetchTrialConversion for why a still-in-progress
 * month's % reads artificially high and keeps changing as more of its
 * trials resolve.
 */
import { NextResponse } from 'next/server';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';
import { fetchChannelRevenue } from '@/lib/google-analytics';
import { fetchTrialConversion } from '@/lib/hubspot-trials';

export const dynamic = 'force-dynamic';

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based here
}

function ymdToMsRangeAEST(start: string, end: string): { startMs: number; endMs: number } {
  return {
    startMs: new Date(`${start}T00:00:00+10:00`).getTime(),
    endMs:   new Date(`${end}T23:59:59+10:00`).getTime(),
  };
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-AU', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function pctChange(cur: number, prior: number): number | null {
  return prior > 0 ? Math.round(((cur - prior) / prior) * 100) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const todayYmd = toYMD(new Date());
  const currentMonth = todayYmd.slice(0, 7);
  const month = searchParams.get('month') ?? currentMonth;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param must be YYYY-MM' }, { status: 400 });
  }

  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const fullMonthEnd = `${month}-${String(daysInMonth(y!, m!)).padStart(2, '0')}`;
  // Cap at today if this is the current (in-progress) month
  const monthEnd = (month === currentMonth && fullMonthEnd > todayYmd) ? todayYmd : fullMonthEnd;
  const isPartial = monthEnd !== fullMonthEnd;

  // Same calendar month, one year earlier
  const compMonth = `${y! - 1}-${String(m).padStart(2, '0')}`;
  const compMonthStart = `${compMonth}-01`;
  const compMonthEnd = `${compMonth}-${String(Math.min(Number(monthEnd.slice(8, 10)), daysInMonth(y! - 1, m!))).padStart(2, '0')}`;

  const { startMs: curStartMs, endMs: curEndMs }   = ymdToMsRangeAEST(monthStart, monthEnd);
  const { startMs: compStartMs, endMs: compEndMs } = ymdToMsRangeAEST(compMonthStart, compMonthEnd);

  const [curRevR, compRevR, curTrialR, compTrialR, channelR] = await Promise.allSettled([
    fetchETZStripeRevenue(month,     { accurate: false, dateRange: { start: monthStart, end: monthEnd } }),
    fetchETZStripeRevenue(compMonth, { accurate: false, dateRange: { start: compMonthStart, end: compMonthEnd } }),
    fetchTrialConversion('etz', curStartMs, curEndMs),
    fetchTrialConversion('etz', compStartMs, compEndMs),
    fetchChannelRevenue(monthStart, monthEnd, 'etz'),
  ]);

  const curRev    = curRevR.status    === 'fulfilled' ? curRevR.value    : null;
  const compRev   = compRevR.status   === 'fulfilled' ? compRevR.value   : null;
  const curTrial  = curTrialR.status  === 'fulfilled' ? curTrialR.value  : null;
  const compTrial = compTrialR.status === 'fulfilled' ? compTrialR.value : null;
  const channels  = channelR.status   === 'fulfilled' ? channelR.value   : null;

  const bestChannel = channels?.items?.length
    ? [...channels.items].sort((a, b) => b.revenue - a.revenue)[0]!
    : null;

  const curRevenue  = curRev?.totalRevenue  ?? 0;
  const compRevenue = compRev?.totalRevenue ?? 0;
  const curOrders   = curRev?.totalOrders   ?? 0;
  const compOrders  = compRev?.totalOrders  ?? 0;

  return NextResponse.json({
    connected: true,
    month:           { key: month,     start: monthStart,     end: monthEnd,     label: monthLabel(month),     isPartial },
    comparisonMonth: { key: compMonth, start: compMonthStart, end: compMonthEnd, label: monthLabel(compMonth) },
    revenue: { current: curRevenue, prior: compRevenue, pctChange: pctChange(curRevenue, compRevenue) },
    orders:  { current: curOrders,  prior: compOrders,  pctChange: pctChange(curOrders, compOrders) },
    trials: {
      current: curTrial?.trialsStarted  ?? 0,
      prior:   compTrial?.trialsStarted ?? 0,
      pctChange: pctChange(curTrial?.trialsStarted ?? 0, compTrial?.trialsStarted ?? 0),
    },
    trialToPaid: {
      current: curTrial  ? { converted: curTrial.converted,  totalEverStarted: curTrial.totalEverStarted,  pct: curTrial.pct  } : null,
      prior:   compTrial ? { converted: compTrial.converted, totalEverStarted: compTrial.totalEverStarted, pct: compTrial.pct } : null,
    },
    bestChannel: bestChannel ? { name: bestChannel.channel, revenue: bestChannel.revenue, pct: bestChannel.pct } : null,
    channels: channels?.items ?? [],
  });
}
