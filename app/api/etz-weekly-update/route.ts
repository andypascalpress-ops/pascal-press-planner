/**
 * GET /api/etz-weekly-update?week=YYYY-MM-DD
 *
 * Answers the standing weekly report questions for Excel Test Zone:
 *   1. Revenue this week vs the same week last year
 *   2. Free trials started this week vs the same week last year
 *   3. Trial-to-paid % vs last year
 *   4. Best channel driving revenue, by %
 *
 * `week` is any date inside the target week (Mon-Sun, AEST); defaults to
 * today. The comparison week is 364 days earlier (52 weeks), not a plain
 * calendar-year shift, so the same day-of-week lines up on both sides.
 *
 * Trial-to-paid is a live snapshot, not a matured-cohort result — see
 * lib/hubspot-trials.ts's fetchTrialConversion for why a recent week's %
 * reads artificially high and keeps changing as more of its trials resolve.
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

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `ymd`. */
function mondayOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(ymd, diff);
}

function ymdToMsRangeAEST(start: string, end: string): { startMs: number; endMs: number } {
  return {
    startMs: new Date(`${start}T00:00:00+10:00`).getTime(),
    endMs:   new Date(`${end}T23:59:59+10:00`).getTime(),
  };
}

function formatLabel(start: string, end: string): string {
  const fmt = (ymd: string) => new Date(`${ymd}T12:00:00Z`)
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function pctChange(cur: number, prior: number): number | null {
  return prior > 0 ? Math.round(((cur - prior) / prior) * 100) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const todayYmd = toYMD(new Date());
  const anchor = searchParams.get('week') ?? todayYmd;

  const weekStart = mondayOfWeek(anchor);
  const fullWeekEnd = addDays(weekStart, 6);
  // Cap at today if this is the current (in-progress) week
  const weekEnd = fullWeekEnd > todayYmd ? todayYmd : fullWeekEnd;
  const isPartial = weekEnd !== fullWeekEnd;

  // Same week last year — shift by 364 days (52 weeks) so day-of-week stays aligned
  const compStart = addDays(weekStart, -364);
  const compEnd   = addDays(weekEnd, -364);

  const curMonth  = weekStart.slice(0, 7);
  const compMonth = compStart.slice(0, 7);
  const { startMs: curStartMs, endMs: curEndMs }   = ymdToMsRangeAEST(weekStart, weekEnd);
  const { startMs: compStartMs, endMs: compEndMs } = ymdToMsRangeAEST(compStart, compEnd);

  const [curRevR, compRevR, curTrialR, compTrialR, channelR] = await Promise.allSettled([
    fetchETZStripeRevenue(curMonth,  { accurate: false, dateRange: { start: weekStart, end: weekEnd } }),
    fetchETZStripeRevenue(compMonth, { accurate: false, dateRange: { start: compStart, end: compEnd } }),
    fetchTrialConversion('etz', curStartMs, curEndMs),
    fetchTrialConversion('etz', compStartMs, compEndMs),
    fetchChannelRevenue(weekStart, weekEnd, 'etz'),
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
    week:           { start: weekStart, end: weekEnd, label: formatLabel(weekStart, weekEnd), isPartial },
    comparisonWeek: { start: compStart, end: compEnd, label: formatLabel(compStart, compEnd) },
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
