/**
 * Gathers the live numbers for the Excel Test Zone executive-summary PDF straight from the source libraries
 * (Stripe, HubSpot, Google Analytics, Google Ads and Meta Ads), using the same definitions as the dashboard and
 * the weekly performance deck.
 *
 * Emailed at about 9:30am, so everything covers COMPLETE days only: "yesterday" is the daily figure and month to
 * date runs through the end of yesterday. ETZ is seasonal and young, so the comparison is the SAME DAYS LAST MONTH
 * (the dashboard's MTD convention), not last year.
 * Stripe revenue, daily revenue and free trials are core: if any fails the report fails rather than showing
 * silent zeros. Website, channel, product and ad-spend sections are optional and say "not available" if unread.
 */
import { fetchETZStripeRevenue, fetchETZDailyRevenue, fetchStripeProductMap } from '@/lib/stripe-revenue';
import { fetchTrialConversion } from '@/lib/hubspot-trials';
import { fetchUmsTrials, umsConfigured } from '@/lib/ums-trials';
import { fetchEtzSiteEngagement, fetchEtzFunnelTraffic, fetchChannelRevenue, type EtzEngagement } from '@/lib/google-analytics';
import { etzSpend } from '@/lib/etz-spend';
import { ETZ_MONTHLY_REVENUE_TARGETS, ETZ_MONTHLY_MARKETING_BUDGET } from '@/lib/constants';
import { sydneyToday, addDays, rangeLabel, dayLabel, msRange, avg, round2 } from '@/lib/exec-report-data';
import type { DailyPoint, Trend } from '@/lib/exec-report-pdf';

export interface EtzReportData {
  preparedLabel: string;
  yesterdayLabel: string;
  periodLabel: string;        // month to date through yesterday, e.g. "1-13 Oct 2026"
  comparisonLabel: string;    // same days last month, e.g. "1-13 Sep 2026"
  yesterday: { revenue: number; orders: number; avg7: number };
  revenue: { cur: number; prior: number };
  orders: { cur: number; prior: number };
  aov: { cur: number; prior: number };
  /** Free trials started: UMS trial records (real parent trials) when reachable, otherwise HubSpot deals. */
  trials: { cur: number; prior: number; families: number | null; source: 'ums' | 'hubspot' };
  /**
   * UMS: families who bought after starting a trial, out of families who started one (this month and the same days
   * last month). If the UMS is unreachable: Stripe paid orders divided by HubSpot trials, and `unit` says so.
   */
  trialToPaid: { bought: number; base: number; pct: number | null; priorBought: number; priorBase: number; priorPct: number | null; unit: 'families' | 'orders' };
  target: { monthlyTarget: number; projected: number; daysElapsed: number; daysInMonth: number };
  daily: DailyPoint[];
  trend: Trend;
  products: { name: string; revenue: number; orders: number }[] | null;
  channels: { channel: string; sessions: number; orders: number; revenue: number; spend: number | null }[] | null;
  engagement: { cur: EtzEngagement; prior: EtzEngagement } | null;
  spend: { google: number; meta: number; total: number; googleOk: boolean; metaOk: boolean } | null;
  marketingBudget: number;   // total monthly marketing budget
  /** Total ad spend over the same days last month (null if it could not be read). */
  spendPrior: number | null;
}

/** Same day-of-month one month earlier, clamped to the shorter month. */
function subMonth(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  let pm = m! - 1, py = y!;
  if (pm < 1) { pm = 12; py--; }
  const last = new Date(py, pm, 0).getDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

async function optional<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

export async function gatherEtzReportData(): Promise<EtzReportData> {
  const today = sydneyToday();
  const yesterday = addDays(today, -1);
  const monthStart = `${yesterday.slice(0, 7)}-01`;
  const pStart = subMonth(monthStart), pEnd = subMonth(yesterday);
  const day90 = addDays(yesterday, -89);
  const [ty, tm, td] = yesterday.split('-').map(Number);
  const daysInMonth = new Date(ty!, tm!, 0).getDate();
  const cur = msRange(monthStart, yesterday), pri = msRange(pStart, pEnd);

  const [revC, revP, trialC, trialP, daily] = await Promise.all([
    fetchETZStripeRevenue(yesterday.slice(0, 7), { accurate: false, dateRange: { start: monthStart, end: yesterday } }),
    fetchETZStripeRevenue(pEnd.slice(0, 7), { accurate: false, dateRange: { start: pStart, end: pEnd } }),
    fetchTrialConversion('etz', cur.startMs, cur.endMs),
    fetchTrialConversion('etz', pri.startMs, pri.endMs),
    fetchETZDailyRevenue(day90, yesterday),
  ]);
  for (const [name, r] of [['ETZ revenue', revC], ['ETZ prior-period revenue', revP]] as const) {
    if (!r.connected) throw new Error(`${name} source (Stripe) is not connected`);
  }

  const [engC, engP, siteC, chanRev, spendC, prodC, umsC, umsP, spendPr] = await Promise.all([
    optional(fetchEtzSiteEngagement(monthStart, yesterday, true)),
    optional(fetchEtzSiteEngagement(pStart, pEnd, true)),
    optional(fetchEtzFunnelTraffic(monthStart, yesterday, false)),
    optional(fetchChannelRevenue(monthStart, yesterday, 'etz')),
    optional(etzSpend(monthStart, yesterday)),
    optional(fetchStripeProductMap(process.env.STRIPE_SECRET_KEY ?? '', monthStart, yesterday)),
    umsConfigured() ? optional(fetchUmsTrials(monthStart, yesterday)) : Promise.resolve(null),
    umsConfigured() ? optional(fetchUmsTrials(pStart, pEnd)) : Promise.resolve(null),
    optional(etzSpend(pStart, pEnd)),
  ]);
  const useUms = Boolean(umsC && umsP);

  const series: DailyPoint[] = [];
  for (let i = 0; i < 90; i++) {
    const date = addDays(day90, i);
    series.push({ date, revenue: daily[date]?.revenue ?? 0, ma7: null, partial: false });
  }
  const l30 = avg(series.slice(-30).map(p => p.revenue)), p30 = avg(series.slice(-60, -30).map(p => p.revenue));

  const orders = revC.totalOrders, ordersP = revP.totalOrders;
  const revenue = revC.totalRevenue;
  const projected = td! > 0 ? (revenue / td!) * daysInMonth : 0;

  const channels = siteC && chanRev && chanRev.connected
    ? (() => {
        const sessionsBy = (names: string[]) => siteC.byChannel.filter(r => names.includes(r.channel)).reduce((s, r) => s + r.sessions, 0);
        const revBy = (names: string[]) => {
          const items = chanRev.items.filter(r => names.includes(r.channel));
          return { revenue: items.reduce((s, r) => s + r.revenue, 0), orders: items.reduce((s, r) => s + r.transactions, 0) };
        };
        const main = ['Organic Search', 'Paid Search', 'Paid Social', 'Email'];
        const row = (channel: string, names: string[], spend: number | null) => ({ channel, sessions: sessionsBy(names), ...revBy(names), spend });
        const otherItems = chanRev.items.filter(r => !main.includes(r.channel));
        return [
          row('Google organic search', ['Organic Search'], null),
          row('Google Ads', ['Paid Search'], spendC?.googleOk ? spendC.google : null),
          row('Meta Ads', ['Paid Social'], spendC?.metaOk ? spendC.meta : null),
          row('Email', ['Email'], null),
          {
            channel: 'Direct and other',
            sessions: siteC.byChannel.filter(r => !main.includes(r.channel)).reduce((s, r) => s + r.sessions, 0),
            orders: otherItems.reduce((s, r) => s + r.transactions, 0),
            revenue: otherItems.reduce((s, r) => s + r.revenue, 0),
            spend: null,
          },
        ].map(r => ({ ...r, revenue: round2(r.revenue) }));
      })()
    : null;

  const products = prodC
    ? [...prodC.entries()].map(([name, v]) => ({ name, revenue: round2(v.revenue), orders: v.qty })).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    : null;

  const prepared = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());

  return {
    preparedLabel: `${prepared} (Sydney time)`,
    yesterdayLabel: dayLabel(yesterday),
    periodLabel: rangeLabel(monthStart, yesterday),
    comparisonLabel: rangeLabel(pStart, pEnd),
    yesterday: { revenue: round2(daily[yesterday]?.revenue ?? 0), orders: daily[yesterday]?.orders ?? 0, avg7: avg(series.slice(-7).map(p => p.revenue)) },
    revenue: { cur: round2(revenue), prior: round2(revP.totalRevenue) },
    orders: { cur: orders, prior: ordersP },
    aov: { cur: orders > 0 ? revenue / orders : 0, prior: ordersP > 0 ? revP.totalRevenue / ordersP : 0 },
    trials: useUms
      ? { cur: umsC!.trials, prior: umsP!.trials, families: umsC!.customers, source: 'ums' }
      : { cur: trialC.totalEverStarted, prior: trialP.totalEverStarted, families: null, source: 'hubspot' },
    trialToPaid: useUms
      ? { bought: umsC!.customersWhoBought, base: umsC!.customers, pct: umsC!.pct, priorBought: umsP!.customersWhoBought, priorBase: umsP!.customers, priorPct: umsP!.pct, unit: 'families' }
      : {
          bought: orders, base: trialC.totalEverStarted, pct: trialC.totalEverStarted > 0 ? Math.round((orders / trialC.totalEverStarted) * 100) : null,
          priorBought: ordersP, priorBase: trialP.totalEverStarted, priorPct: trialP.totalEverStarted > 0 ? Math.round((ordersP / trialP.totalEverStarted) * 100) : null,
          unit: 'orders',
        },
    target: { monthlyTarget: ETZ_MONTHLY_REVENUE_TARGETS[tm!] ?? 0, projected, daysElapsed: td!, daysInMonth },
    daily: series,
    trend: { last30Avg: l30, prior30Avg: p30, last30Change: p30 > 0 ? ((l30 - p30) / p30) * 100 : null },
    products,
    channels,
    engagement: engC && engP ? { cur: engC, prior: engP } : null,
    spend: spendC,
    marketingBudget: ETZ_MONTHLY_MARKETING_BUDGET,
    spendPrior: spendPr ? spendPr.total : null,
  };
}
