/**
 * GET /api/overview
 * Aggregates current-month data for the executive overview tab.
 * Calls underlying lib functions in parallel — no double-hop through other routes.
 *
 * Returns: spend, revenue, ROAS, email snapshot, pacing info, computed alerts.
 */
import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';
import { fetchEmailCampaigns } from '@/lib/hubspot-email';
import { MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';
import { OverviewAlert } from '@/lib/types';

export const dynamic = 'force-dynamic'; // range param must be read at request time

const ETZ_START_MONTH = '2026-07';

type RangeParam = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function deriveRange(range: RangeParam): {
  startDate: string; endDate: string;
  month: string; daysInMonth: number; currentDay: number;
  rangeLabel: string; isMonthly: boolean;
} {
  const now  = new Date();
  const ym   = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dIM  = (y: number, m: number) => new Date(y, m, 0).getDate(); // days in month (1-based m)

  switch (range) {
    case 'today': {
      const s = toYMD(now);
      return { startDate: s, endDate: s, month: ym(now),
        daysInMonth: dIM(now.getFullYear(), now.getMonth() + 1), currentDay: now.getDate(),
        rangeLabel: 'Today', isMonthly: false };
    }
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const s = toYMD(y);
      return { startDate: s, endDate: s, month: ym(y),
        daysInMonth: dIM(y.getFullYear(), y.getMonth() + 1), currentDay: y.getDate(),
        rangeLabel: 'Yesterday', isMonthly: false };
    }
    case 'last7': {
      const s = new Date(now); s.setDate(s.getDate() - 6);
      return { startDate: toYMD(s), endDate: toYMD(now), month: ym(now),
        daysInMonth: dIM(now.getFullYear(), now.getMonth() + 1), currentDay: now.getDate(),
        rangeLabel: 'Last 7 days', isMonthly: false };
    }
    case 'last30': {
      const s = new Date(now); s.setDate(s.getDate() - 29);
      return { startDate: toYMD(s), endDate: toYMD(now), month: ym(now),
        daysInMonth: dIM(now.getFullYear(), now.getMonth() + 1), currentDay: now.getDate(),
        rangeLabel: 'Last 30 days', isMonthly: false };
    }
    case 'lastmonth': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = ym(lm);
      const days  = dIM(lm.getFullYear(), lm.getMonth() + 1);
      const label = lm.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return { startDate: `${month}-01`, endDate: `${month}-${String(days).padStart(2, '0')}`,
        month, daysInMonth: days, currentDay: days,
        rangeLabel: label, isMonthly: true };
    }
    case 'mtd':
    default: {
      const month = ym(now);
      const days  = dIM(now.getFullYear(), now.getMonth() + 1);
      const label = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return { startDate: `${month}-01`, endDate: toYMD(now),
        month, daysInMonth: days, currentDay: now.getDate(),
        rangeLabel: `${label} (MTD)`, isMonthly: true };
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = (searchParams.get('range') ?? 'mtd') as RangeParam;
  const { startDate, endDate, month, daysInMonth, currentDay, rangeLabel, isMonthly } = deriveRange(rangeParam);

  let ppCfg, etzCfg;
  try { ppCfg  = buildConfig('pp');  } catch (e) { console.error('[overview] buildConfig(pp) failed:', e);  }
  try { etzCfg = buildConfig('etz'); } catch (e) { console.error('[overview] buildConfig(etz) failed:', e); }

  const useOwnEtzAccount = month >= ETZ_START_MONTH;

  const noAds = () => Promise.reject(new Error('Google Ads config missing'));

  const [ppAdsResult, etzAdsResult, ppRevResult, etzRevResult, emailResult] =
    await Promise.allSettled([
      ppCfg
        ? fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' })
        : noAds(),
      ppCfg
        ? (useOwnEtzAccount && etzCfg
            ? fetchMonthlySpend(etzCfg, startDate, endDate)
            : fetchMonthlySpend(ppCfg,  startDate, endDate, { contains: 'ETZ' }))
        : noAds(),
      fetchPPRevenue(month, { start: startDate, end: endDate }),
      fetchETZStripeRevenue(month, { dateRange: { start: startDate, end: endDate } }),
      fetchEmailCampaigns(month, { dateRange: { start: startDate, end: endDate } }),
    ]);

  const ppSpend  = ppAdsResult.status  === 'fulfilled'
    ? ppAdsResult.value.reduce( (s, r) => s + r.actualSpend, 0) : 0;
  const etzSpend = etzAdsResult.status === 'fulfilled'
    ? etzAdsResult.value.reduce((s, r) => s + r.actualSpend, 0) : 0;

  const ppRev  = ppRevResult.status  === 'fulfilled' ? ppRevResult.value  : null;
  const etzRev = etzRevResult.status === 'fulfilled' ? etzRevResult.value : null;
  const email  = emailResult.status  === 'fulfilled' ? emailResult.value  : null;

  const ppRevenue  = ppRev?.totalRevenue  ?? 0;
  const etzRevenue = etzRev?.totalRevenue ?? 0;

  const ppBudget  = MONTHLY_GOOGLE_BUDGETS['Pascal Press']    ?? 0;
  const etzBudget = MONTHLY_GOOGLE_BUDGETS['Excel Test Zone'] ?? 0;

  const ppRoas  = ppSpend  > 0 ? Math.round((ppRevenue  / ppSpend)  * 10) / 10 : 0;
  const etzRoas = etzSpend > 0 ? Math.round((etzRevenue / etzSpend) * 10) / 10 : 0;
  const combinedRoas = (ppSpend + etzSpend) > 0
    ? Math.round(((ppRevenue + etzRevenue) / (ppSpend + etzSpend)) * 10) / 10
    : 0;

  // Fraction of month elapsed
  const dayPct = currentDay / daysInMonth;

  const alerts: OverviewAlert[] = [];

  // ── Pascal Press budget alerts ─────────────────────────────────────────────
  const ppSpendPct = ppBudget > 0 ? ppSpend / ppBudget : 0;
  if (ppSpendPct > 1.0) {
    alerts.push({ id: 'pp-over', severity: 'danger', brand: 'Pascal Press',
      message: `Pascal Press is over budget — ${Math.round(ppSpendPct * 100)}% of the $${ppBudget.toLocaleString()} monthly budget used.` });
  } else if (ppSpendPct > 0.85) {
    alerts.push({ id: 'pp-near', severity: 'warning', brand: 'Pascal Press',
      message: `Pascal Press is at ${Math.round(ppSpendPct * 100)}% of budget with ${daysInMonth - currentDay} days remaining.` });
  } else if (currentDay > 7 && ppSpendPct < dayPct - 0.20) {
    alerts.push({ id: 'pp-under', severity: 'info', brand: 'Pascal Press',
      message: `Pascal Press is underpacing — ${Math.round(ppSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
  } else if (ppSpendPct > dayPct + 0.20) {
    alerts.push({ id: 'pp-fast', severity: 'warning', brand: 'Pascal Press',
      message: `Pascal Press is overpacing — ${Math.round(ppSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
  }

  // ── Excel Test Zone budget alerts ──────────────────────────────────────────
  const etzSpendPct = etzBudget > 0 ? etzSpend / etzBudget : 0;
  if (etzSpendPct > 1.0) {
    alerts.push({ id: 'etz-over', severity: 'danger', brand: 'Excel Test Zone',
      message: `Excel Test Zone is over budget — ${Math.round(etzSpendPct * 100)}% of the $${etzBudget.toLocaleString()} monthly budget used.` });
  } else if (etzSpendPct > 0.85) {
    alerts.push({ id: 'etz-near', severity: 'warning', brand: 'Excel Test Zone',
      message: `Excel Test Zone is at ${Math.round(etzSpendPct * 100)}% of budget with ${daysInMonth - currentDay} days remaining.` });
  } else if (currentDay > 7 && etzSpendPct < dayPct - 0.20) {
    alerts.push({ id: 'etz-under', severity: 'info', brand: 'Excel Test Zone',
      message: `Excel Test Zone is underpacing — ${Math.round(etzSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
  } else if (etzSpendPct > dayPct + 0.20) {
    alerts.push({ id: 'etz-fast', severity: 'warning', brand: 'Excel Test Zone',
      message: `Excel Test Zone is overpacing — ${Math.round(etzSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
  }

  // ── ROAS alerts ────────────────────────────────────────────────────────────
  if (ppSpend > 100 && ppRoas < 3) {
    alerts.push({ id: 'pp-roas', severity: 'warning', brand: 'Pascal Press',
      message: `Pascal Press ROAS is ${ppRoas}x — below the 3x minimum threshold.` });
  }
  if (etzSpend > 100 && etzRoas < 3) {
    alerts.push({ id: 'etz-roas', severity: 'warning', brand: 'Excel Test Zone',
      message: `Excel Test Zone ROAS is ${etzRoas}x — below the 3x minimum threshold.` });
  }

  // ── Email alerts ───────────────────────────────────────────────────────────
  if (email?.connected && email.totalSends > 0) {
    if (email.avgOpenRate < 0.15) {
      alerts.push({ id: 'email-open', severity: 'warning', brand: 'Email',
        message: `Email open rate is ${Math.round(email.avgOpenRate * 100)}% this month — below the 15% benchmark.` });
    }
  }

  // Debug: surface rejection reasons so we can diagnose Google Ads failures
  const ppAdsError  = ppAdsResult.status  === 'rejected' ? String(ppAdsResult.reason)  : null;
  const etzAdsError = etzAdsResult.status === 'rejected' ? String(etzAdsResult.reason) : null;
  if (ppAdsError)  console.error('[overview] PP Google Ads error:',  ppAdsError);
  if (etzAdsError) console.error('[overview] ETZ Google Ads error:', etzAdsError);

  return NextResponse.json({
    month,
    daysInMonth,
    currentDay,
    rangeLabel,
    isMonthly,
    pp: {
      spend:        Math.round(ppSpend  * 100) / 100,
      budget:       ppBudget,
      revenue:      Math.round(ppRevenue  * 100) / 100,
      roas:         ppRoas,
      orders:       ppRev?.totalOrders ?? 0,
      revConnected: ppRev?.connected   ?? false,
      adsConnected: ppAdsResult.status === 'fulfilled',
      adsError:     ppAdsError,
    },
    etz: {
      spend:        Math.round(etzSpend * 100) / 100,
      budget:       etzBudget,
      revenue:      Math.round(etzRevenue * 100) / 100,
      roas:         etzRoas,
      orders:       etzRev?.totalOrders ?? 0,
      revConnected: etzRev?.connected   ?? false,
      adsConnected: etzAdsResult.status === 'fulfilled',
      adsError:     etzAdsError,
    },
    combined: {
      spend:   Math.round((ppSpend   + etzSpend)   * 100) / 100,
      revenue: Math.round((ppRevenue + etzRevenue) * 100) / 100,
      roas:    combinedRoas,
    },
    email: email ? {
      connected:     email.connected,
      avgOpenRate:   email.avgOpenRate,
      avgClickRate:  email.avgClickRate,
      totalSends:    email.totalSends,
      campaignCount: email.campaigns.length,
    } : null,
    alerts,
  });
}
