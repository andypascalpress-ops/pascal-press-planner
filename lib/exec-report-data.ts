/**
 * Gathers the live numbers for the executive-summary PDF straight from the source libraries
 * (Stripe, HubSpot), using the same definitions as the Business Units dashboard:
 *  - month to date versus the same days last month (Sydney dates)
 *  - ETZ new free trials = every trial deal started in the period; free trial to paid = paid orders / trials started
 *  - EHC from the shared HubSpot overview plus Stripe revenue and orders
 * Any failed source throws, so the report never shows silent zeros.
 */
import { fetchETZStripeRevenue, fetchHSCStripeRevenue, fetchETZDailyRevenue, zonedDateTimeToUnix } from '@/lib/stripe-revenue';
import { fetchTrialConversion, fetchOfflineTrials } from '@/lib/hubspot-trials';
import { fetchEhcOverview } from '@/lib/ehc-overview';
import { ETZ_MONTHLY_REVENUE_TARGETS } from '@/lib/constants';
import type { ExecReportData } from '@/lib/exec-report-pdf';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function subMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  let nm = m! - n, ny = y!;
  while (nm < 1) { nm += 12; ny--; }
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

function rangeLabel(s: string, e: string): string {
  const [, sm, sd] = s.split('-').map(Number);
  const [ey, em, ed] = e.split('-').map(Number);
  return sm === em ? `${sd}-${ed} ${MONTHS[em! - 1]} ${ey}` : `${sd} ${MONTHS[sm! - 1]}-${ed} ${MONTHS[em! - 1]} ${ey}`;
}

const msRange = (s: string, e: string) => ({
  startMs: zonedDateTimeToUnix(s, '00:00:00') * 1000,
  endMs: zonedDateTimeToUnix(e, '23:59:59') * 1000,
});

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function gatherExecReportData(): Promise<ExecReportData> {
  const today = sydneyToday();
  const start = `${today.slice(0, 7)}-01`;
  const pStart = subMonths(start, 1), pEnd = subMonths(today, 1);
  const cur = msRange(start, today), prior = msRange(pStart, pEnd);
  const day90 = addDays(today, -89);

  const [etzRevC, etzRevP, trialC, trialP, offlineC, daily, ehc, ehcRevC, ehcRevP] = await Promise.all([
    fetchETZStripeRevenue(today.slice(0, 7), { accurate: false, dateRange: { start, end: today } }),
    fetchETZStripeRevenue(pEnd.slice(0, 7), { accurate: false, dateRange: { start: pStart, end: pEnd } }),
    fetchTrialConversion('etz', cur.startMs, cur.endMs),
    fetchTrialConversion('etz', prior.startMs, prior.endMs),
    fetchOfflineTrials('etz', cur.startMs, cur.endMs),
    fetchETZDailyRevenue(day90, today),
    fetchEhcOverview(),
    fetchHSCStripeRevenue(today.slice(0, 7), { accurate: false, dateRange: { start, end: today } }),
    fetchHSCStripeRevenue(pEnd.slice(0, 7), { accurate: false, dateRange: { start: pStart, end: pEnd } }),
  ]);

  for (const [name, r] of [['ETZ revenue', etzRevC], ['ETZ prior revenue', etzRevP], ['EHC revenue', ehcRevC], ['EHC prior revenue', ehcRevP]] as const) {
    if (!r.connected) throw new Error(`${name} source (Stripe) is not connected`);
  }

  // Daily series with a 7-day average (today is a partial day and is left out of averages)
  const series: ExecReportData['etz']['daily'] = [];
  for (let i = 0; i < 90; i++) {
    const date = addDays(day90, i);
    series.push({ date, revenue: daily[date]?.revenue ?? 0, ma7: null, partial: date === today });
  }
  series.forEach((p, i) => { if (!p.partial && i >= 6) p.ma7 = avg(series.slice(i - 6, i + 1).map(x => x.revenue)); });
  const complete = series.filter(p => !p.partial).map(p => p.revenue);
  const last30 = complete.slice(-30), prior30 = complete.slice(-60, -30);
  const l30 = avg(last30), p30 = avg(prior30);

  const trialsCur = trialC.totalEverStarted, trialsPrior = trialP.totalEverStarted;
  const ordersCur = etzRevC.totalOrders, ordersPrior = etzRevP.totalOrders;
  const [ty, tm, td] = today.split('-').map(Number);
  const daysInMonth = new Date(ty!, tm!, 0).getDate();
  const firstAfter = ehc.trialCreation.lastFreeTrialWeek ? ehc.weekly.find(w => w.week > ehc.trialCreation.lastFreeTrialWeek!) : undefined;

  const prepared = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());

  return {
    preparedLabel: `${prepared} (Sydney time)`,
    periodLabel: rangeLabel(start, today),
    comparisonLabel: rangeLabel(pStart, pEnd),
    etz: {
      revenue: { cur: etzRevC.totalRevenue, prior: etzRevP.totalRevenue },
      orders: { cur: ordersCur, prior: ordersPrior },
      aov: { cur: ordersCur > 0 ? etzRevC.totalRevenue / ordersCur : 0, prior: ordersPrior > 0 ? etzRevP.totalRevenue / ordersPrior : 0 },
      trials: { cur: trialsCur, prior: trialsPrior, schoolImports: offlineC.ever },
      trialToPaid: {
        cur: trialsCur > 0 ? (ordersCur / trialsCur) * 100 : 0,
        prior: trialsPrior > 0 ? (ordersPrior / trialsPrior) * 100 : 0,
      },
      target: { monthlyTarget: ETZ_MONTHLY_REVENUE_TARGETS[tm!] ?? 0, monthPctElapsed: (td! / daysInMonth) * 100 },
      daily: series,
      trend: { last30Avg: l30, prior30Avg: p30, last30Change: p30 > 0 ? ((l30 - p30) / p30) * 100 : null },
    },
    ehc: {
      revenue: { cur: ehcRevC.totalRevenue, prior: ehcRevP.totalRevenue },
      orders: { cur: ehcRevC.totalOrders, prior: ehcRevP.totalOrders },
      paidActiveSubscriptions: ehc.paidSubscriptions.deals,
      last30: ehc.last30,
      weekly: ehc.weekly.map(w => ({ week: w.week, freeTrial: w.freeTrial, newPaid: w.newPaid, newZero: w.newZero })),
      stages: ehc.stages,
      subjects: ehc.paidSubscriptions.subjects,
      trialGap: {
        lastFreeTrialWeek: ehc.trialCreation.lastFreeTrialWeek,
        weeks: ehc.trialCreation.weeksWithoutFreeTrials,
        zeroDealsFirstWeekAfter: firstAfter ? firstAfter.newZero : null,
      },
    },
  };
}
