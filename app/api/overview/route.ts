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

export const revalidate = 300; // 5-minute cache

const ETZ_START_MONTH = '2026-07';

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET() {
  const month = currentYearMonth();
  const [yearS, monS] = month.split('-');
  const year = parseInt(yearS!, 10);
  const mon  = parseInt(monS!,  10);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const currentDay  = new Date().getDate();
  const startDate   = `${month}-01`;
  const endDate     = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const ppCfg  = buildConfig('pp');
  const etzCfg = buildConfig('etz');
  const useOwnEtzAccount = month >= ETZ_START_MONTH;

  const [ppAdsResult, etzAdsResult, ppRevResult, etzRevResult, emailResult] =
    await Promise.allSettled([
      fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' }),
      useOwnEtzAccount
        ? fetchMonthlySpend(etzCfg, startDate, endDate)
        : fetchMonthlySpend(ppCfg,  startDate, endDate, { contains: 'ETZ' }),
      fetchPPRevenue(month),
      fetchETZStripeRevenue(month),
      fetchEmailCampaigns(month),
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

  return NextResponse.json({
    month,
    daysInMonth,
    currentDay,
    pp: {
      spend:        Math.round(ppSpend  * 100) / 100,
      budget:       ppBudget,
      revenue:      Math.round(ppRevenue  * 100) / 100,
      roas:         ppRoas,
      orders:       ppRev?.totalOrders ?? 0,
      revConnected: ppRev?.connected   ?? false,
      adsConnected: ppAdsResult.status === 'fulfilled',
    },
    etz: {
      spend:        Math.round(etzSpend * 100) / 100,
      budget:       etzBudget,
      revenue:      Math.round(etzRevenue * 100) / 100,
      roas:         etzRoas,
      orders:       etzRev?.totalOrders ?? 0,
      revConnected: etzRev?.connected   ?? false,
      adsConnected: etzAdsResult.status === 'fulfilled',
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
