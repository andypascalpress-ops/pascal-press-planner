/**
 * Gathers the live numbers for the executive-summary PDF straight from the source libraries
 * (Stripe, HubSpot, Google Ads), using the same definitions as the Business Units dashboard.
 *
 * The PDF is emailed at about 9:30am, so everything covers COMPLETE days only: "yesterday" is the daily figure,
 * "month to date" runs through the end of yesterday, and it is compared with the same dates last year.
 * It is an Excel HSC Copilot report. Excel Test Zone is kept behind `includeEtz` for when it is wanted again.
 *  - EHC orders are split into new (first payment of a new subscription), recurring (renewals) and annual plans
 *  - Subscriber counts come from every Stripe subscription (fully paginated)
 *  - Deals and subjects are this month's HubSpot deals only
 * Any failed core source throws, so the report never shows silent zeros. Google Ads spend is the one optional
 * figure: if it cannot be read the report says "not available" rather than failing.
 */
import {
  fetchETZStripeRevenue, fetchETZDailyRevenue, fetchHSCClassifiedDaily, fetchHSCSubscriptionSummary, zonedDateTimeToUnix,
  type ClassifiedDay, type OrderBucket,
} from '@/lib/stripe-revenue';
import { fetchTrialConversion, fetchOfflineTrials } from '@/lib/hubspot-trials';
import { fetchEhcMonthDeals, fetchLastFreeTrialDate } from '@/lib/ehc-overview';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { ETZ_MONTHLY_REVENUE_TARGETS, HSC_MONTHLY_REVENUE_TARGETS } from '@/lib/constants';
import type { ExecReportData } from '@/lib/exec-report-pdf';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same calendar date one year earlier (29 Feb becomes 28 Feb). */
function subYear(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(y! - 1, m!, 0).getDate();
  return `${y! - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

function rangeLabel(s: string, e: string): string {
  const [, sm, sd] = s.split('-').map(Number);
  const [ey, em, ed] = e.split('-').map(Number);
  return sm === em ? `${sd}-${ed} ${MONTHS[em! - 1]} ${ey}` : `${sd} ${MONTHS[sm! - 1]}-${ed} ${MONTHS[em! - 1]} ${ey}`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS[dow]} ${d} ${MONTHS[m! - 1]} ${y}`;
}

const msRange = (s: string, e: string) => ({
  startMs: zonedDateTimeToUnix(s, '00:00:00') * 1000,
  endMs: zonedDateTimeToUnix(e, '23:59:59') * 1000,
});

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

type Kind = 'new' | 'recurring' | 'annual' | 'other';
const KINDS: Kind[] = ['new', 'recurring', 'annual', 'other'];

function sumDays(days: Record<string, ClassifiedDay>, from: string, to: string) {
  const t = { revenue: 0, orders: 0, failed: 0, refunds: 0, refunded: 0, new: { orders: 0, revenue: 0 }, recurring: { orders: 0, revenue: 0 }, annual: { orders: 0, revenue: 0 }, other: { orders: 0, revenue: 0 } };
  for (const [date, d] of Object.entries(days)) {
    if (date < from || date > to) continue;
    t.revenue += d.revenue; t.orders += d.orders; t.failed += d.failed; t.refunds += d.refunds ?? 0; t.refunded += d.refunded ?? 0;
    for (const k of KINDS) { t[k].orders += d[k].orders; t[k].revenue += d[k].revenue; }
  }
  return t;
}

const bucket = (b: OrderBucket) => ({ orders: b.orders, revenue: round2(b.revenue) });

async function optionalGoogleSpend(start: string, end: string): Promise<number | null> {
  try {
    const cfg = buildConfig('hsc');
    const rows = await fetchMonthlySpend(cfg, start, end);
    return round2(rows.reduce((a, r) => a + r.actualSpend, 0));
  } catch {
    return null;
  }
}

export async function gatherExecReportData(options: { includeEtz?: boolean } = {}): Promise<ExecReportData> {
  const today = sydneyToday();
  const yesterday = addDays(today, -1);
  const monthStart = `${yesterday.slice(0, 7)}-01`;
  const lyStart = subYear(monthStart), lyEnd = subYear(yesterday);
  const day90 = addDays(yesterday, -89);
  const [ty, tm, td] = yesterday.split('-').map(Number);
  const daysInMonth = new Date(ty!, tm!, 0).getDate();

  // 12 complete Monday-to-Sunday weeks ending on the most recent Sunday that is not after yesterday
  const yDow = new Date(`${yesterday}T12:00:00Z`).getUTCDay();
  const lastSunday = addDays(yesterday, -yDow);
  const weeksStart = addDays(lastSunday, -(12 * 7 - 1));
  const ehcFrom = [day90, weeksStart, monthStart].sort()[0]!;

  const [ehcRecent, ehcLy, subs, monthDeals, lastTrial, spend] = await Promise.all([
    fetchHSCClassifiedDaily(ehcFrom, yesterday),
    fetchHSCClassifiedDaily(lyStart, lyEnd),
    fetchHSCSubscriptionSummary(monthStart),
    fetchEhcMonthDeals(monthStart, yesterday),
    fetchLastFreeTrialDate(),
    optionalGoogleSpend(monthStart, yesterday),
  ]);

  const mtd = sumDays(ehcRecent, monthStart, yesterday);
  const mtdLy = sumDays(ehcLy, lyStart, lyEnd);
  const yest = sumDays(ehcRecent, yesterday, yesterday);

  const series: { date: string; revenue: number; ma7: number | null; partial: boolean }[] = [];
  for (let i = 0; i < 90; i++) {
    const date = addDays(day90, i);
    series.push({ date, revenue: ehcRecent[date]?.revenue ?? 0, ma7: null, partial: false });
  }
  series.forEach((p, i) => { if (i >= 6) p.ma7 = avg(series.slice(i - 6, i + 1).map(x => x.revenue)); });
  const l30 = avg(series.slice(-30).map(p => p.revenue)), p30 = avg(series.slice(-60, -30).map(p => p.revenue));

  const weeklyOrders: ExecReportData['ehc']['weeklyOrders'] = [];
  for (let w = 0; w < 12; w++) {
    const s = addDays(weeksStart, 7 * w), e = addDays(s, 6);
    const t = sumDays(ehcRecent, s, e);
    weeklyOrders.push({ week: s, new: t.new.orders, recurring: t.recurring.orders, annual: t.annual.orders, other: t.other.orders });
  }

  const target = HSC_MONTHLY_REVENUE_TARGETS[tm!] ?? 0;
  const projected = td! > 0 ? (mtd.revenue / td!) * daysInMonth : 0;

  const prepared = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());

  const data: ExecReportData = {
    preparedLabel: `${prepared} (Sydney time)`,
    yesterdayLabel: dayLabel(yesterday),
    periodLabel: rangeLabel(monthStart, yesterday),
    comparisonLabel: rangeLabel(lyStart, lyEnd),
    ehc: {
      yesterday: { revenue: round2(yest.revenue), orders: yest.orders, new: yest.new.orders, recurring: yest.recurring.orders, annual: yest.annual.orders, avg7: avg(series.slice(-7).map(p => p.revenue)) },
      revenue: { cur: round2(mtd.revenue), prior: round2(mtdLy.revenue) },
      orders: { cur: mtd.orders, prior: mtdLy.orders },
      mix: { new: bucket(mtd.new), recurring: bucket(mtd.recurring), annual: bucket(mtd.annual), other: bucket(mtd.other) },
      mixPrior: { new: bucket(mtdLy.new), recurring: bucket(mtdLy.recurring), annual: bucket(mtdLy.annual), other: bucket(mtdLy.other) },
      target: { monthlyTarget: target, monthPctElapsed: (td! / daysInMonth) * 100, projected, daysElapsed: td!, daysInMonth },
      subscriptions: { ...subs },
      marketing: { adSpend: spend, failedPayments: mtd.failed, refunds: mtd.refunds, refunded: round2(mtd.refunded) },
      daily: series,
      trend: { last30Avg: l30, prior30Avg: p30, last30Change: p30 > 0 ? ((l30 - p30) / p30) * 100 : null },
      weeklyOrders,
      deals: { total: monthDeals.total, freeTrial: monthDeals.freeTrial, newPaid: monthDeals.newPaid, newZero: monthDeals.newZero, subjects: monthDeals.subjects, lastFreeTrialDate: lastTrial },
    },
  };

  if (options.includeEtz) {
    const cur = msRange(monthStart, yesterday), ly = msRange(lyStart, lyEnd);
    const [etzRevC, etzRevL, trialC, trialL, offlineC, etzDaily] = await Promise.all([
      fetchETZStripeRevenue(yesterday.slice(0, 7), { accurate: false, dateRange: { start: monthStart, end: yesterday } }),
      fetchETZStripeRevenue(lyEnd.slice(0, 7), { accurate: false, dateRange: { start: lyStart, end: lyEnd } }),
      fetchTrialConversion('etz', cur.startMs, cur.endMs),
      fetchTrialConversion('etz', ly.startMs, ly.endMs),
      fetchOfflineTrials('etz', cur.startMs, cur.endMs),
      fetchETZDailyRevenue(day90, yesterday),
    ]);
    for (const [name, r] of [['ETZ revenue', etzRevC], ['ETZ last-year revenue', etzRevL]] as const) {
      if (!r.connected) throw new Error(`${name} source (Stripe) is not connected`);
    }
    const eSeries: { date: string; revenue: number; ma7: number | null; partial: boolean }[] = [];
    for (let i = 0; i < 90; i++) {
      const date = addDays(day90, i);
      eSeries.push({ date, revenue: etzDaily[date]?.revenue ?? 0, ma7: null, partial: false });
    }
    eSeries.forEach((p, i) => { if (i >= 6) p.ma7 = avg(eSeries.slice(i - 6, i + 1).map(x => x.revenue)); });
    const e30 = avg(eSeries.slice(-30).map(p => p.revenue)), ep30 = avg(eSeries.slice(-60, -30).map(p => p.revenue));
    const trialsCur = trialC.totalEverStarted, trialsLy = trialL.totalEverStarted;
    const ordersCur = etzRevC.totalOrders, ordersLy = etzRevL.totalOrders;
    data.etz = {
      yesterday: { revenue: etzDaily[yesterday]?.revenue ?? 0, orders: etzDaily[yesterday]?.orders ?? 0, avg7: avg(eSeries.slice(-7).map(p => p.revenue)) },
      revenue: { cur: etzRevC.totalRevenue, prior: etzRevL.totalRevenue },
      orders: { cur: ordersCur, prior: ordersLy },
      aov: { cur: ordersCur > 0 ? etzRevC.totalRevenue / ordersCur : 0, prior: ordersLy > 0 ? etzRevL.totalRevenue / ordersLy : 0 },
      trials: { cur: trialsCur, prior: trialsLy, schoolImports: offlineC.ever },
      trialToPaid: { cur: trialsCur > 0 ? (ordersCur / trialsCur) * 100 : 0, prior: trialsLy > 0 ? (ordersLy / trialsLy) * 100 : 0 },
      target: { monthlyTarget: ETZ_MONTHLY_REVENUE_TARGETS[tm!] ?? 0, monthPctElapsed: (td! / daysInMonth) * 100 },
      daily: eSeries,
      trend: { last30Avg: e30, prior30Avg: ep30, last30Change: ep30 > 0 ? ((e30 - ep30) / ep30) * 100 : null },
    };
  }
  return data;
}
