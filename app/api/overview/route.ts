/**
 * GET /api/overview
 * Aggregates current-month data for the executive overview tab.
 * Calls underlying lib functions in parallel — no double-hop through other routes.
 *
 * Returns: spend, revenue, ROAS, email snapshot, pacing info, computed alerts.
 */
import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchPPRevenue, fetchBlakeRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue, fetchHSCStripeRevenue } from '@/lib/stripe-revenue';
import { fetchEmailCampaigns } from '@/lib/hubspot-email';
import { fetchPPWebsiteConversion, fetchETZWebsiteConversion } from '@/lib/google-analytics';
import { MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';
import { OverviewAlert } from '@/lib/types';

export const dynamic = 'force-dynamic'; // range param must be read at request time

const ETZ_START_MONTH = '2026-07';

type RangeParam = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';

function toYMD(d: Date): string {
  // Vercel runs in UTC — use Australia/Sydney so "today" follows AEST/AEDT (not fixed +10)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function deriveRange(range: RangeParam): {
  startDate: string; endDate: string;
  month: string; daysInMonth: number; currentDay: number;
  rangeLabel: string; isMonthly: boolean;
} {
  const now  = new Date();
  const dIM  = (y: number, m: number) => new Date(y, m, 0).getDate(); // days in month (1-based m)

  // Parse AEST components from toYMD — avoids UTC/local divergence on Vercel
  const todayAEST = toYMD(now);
  const aY = parseInt(todayAEST.slice(0, 4));
  const aM = parseInt(todayAEST.slice(5, 7));
  const aD = parseInt(todayAEST.slice(8, 10));
  const ym = (dateStr: string) => dateStr.slice(0, 7);

  // Helper: subtract N days from an AEST date string
  const subDays = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  switch (range) {
    case 'today': {
      return { startDate: todayAEST, endDate: todayAEST, month: ym(todayAEST),
        daysInMonth: dIM(aY, aM), currentDay: aD,
        rangeLabel: 'Today', isMonthly: false };
    }
    case 'yesterday': {
      const s = subDays(todayAEST, 1);
      const yY = parseInt(s.slice(0, 4)), yM = parseInt(s.slice(5, 7)), yD = parseInt(s.slice(8, 10));
      return { startDate: s, endDate: s, month: ym(s),
        daysInMonth: dIM(yY, yM), currentDay: yD,
        rangeLabel: 'Yesterday', isMonthly: false };
    }
    case 'last7': {
      const s = subDays(todayAEST, 6);
      return { startDate: s, endDate: todayAEST, month: ym(todayAEST),
        daysInMonth: dIM(aY, aM), currentDay: aD,
        rangeLabel: 'Last 7 days', isMonthly: false };
    }
    case 'last30': {
      const s = subDays(todayAEST, 29);
      return { startDate: s, endDate: todayAEST, month: ym(todayAEST),
        daysInMonth: dIM(aY, aM), currentDay: aD,
        rangeLabel: 'Last 30 days', isMonthly: false };
    }
    case 'lastmonth': {
      const lmY = aM === 1 ? aY - 1 : aY;
      const lmM = aM === 1 ? 12 : aM - 1;
      const month = `${lmY}-${String(lmM).padStart(2, '0')}`;
      const days  = dIM(lmY, lmM);
      const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return { startDate: `${month}-01`, endDate: `${month}-${String(days).padStart(2, '0')}`,
        month, daysInMonth: days, currentDay: days,
        rangeLabel: label, isMonthly: true };
    }
    case 'mtd':
    default: {
      const month = ym(todayAEST);
      const days  = dIM(aY, aM);
      const label = new Date(`${todayAEST}T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return { startDate: `${month}-01`, endDate: todayAEST,
        month, daysInMonth: days, currentDay: aD,
        rangeLabel: `${label} (MTD)`, isMonthly: true };
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = (searchParams.get('range') ?? 'mtd') as RangeParam;
  const { startDate, endDate, month, daysInMonth, currentDay, rangeLabel, isMonthly } = deriveRange(rangeParam);

  let ppCfg, etzCfg, hscCfg;
  try { ppCfg  = buildConfig('pp');  } catch (e) { console.error('[overview] buildConfig(pp) failed:', e);  }
  try { etzCfg = buildConfig('etz'); } catch (e) { console.error('[overview] buildConfig(etz) failed:', e); }
  try { hscCfg = buildConfig('hsc'); } catch (e) { console.error('[overview] buildConfig(hsc) failed:', e); }

  const useOwnEtzAccount = month >= ETZ_START_MONTH;

  const noAds = () => Promise.reject(new Error('Google Ads config missing'));

  // Blake: revenue only for now (no Google Ads account connected)
  const blakeSpend = 0;

  const [ppAdsResult, etzAdsResult, hscAdsResult, ppRevResult, etzRevResult, hscRevResult, blakeRevResult, emailResult, ppConvResult, etzConvResult] =
    await Promise.allSettled([
      ppCfg
        ? fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' })
        : noAds(),
      ppCfg
        ? (useOwnEtzAccount && etzCfg
            ? fetchMonthlySpend(etzCfg, startDate, endDate)
            : fetchMonthlySpend(ppCfg,  startDate, endDate, { contains: 'ETZ' }))
        : noAds(),
      hscCfg
        ? fetchMonthlySpend(hscCfg, startDate, endDate)
        : noAds(),
      fetchPPRevenue(month, { start: startDate, end: endDate }),
      fetchETZStripeRevenue(month, { dateRange: { start: startDate, end: endDate } }),
      fetchHSCStripeRevenue(month, { dateRange: { start: startDate, end: endDate } }),
      fetchBlakeRevenue(month, { start: startDate, end: endDate }),
      fetchEmailCampaigns(month, { dateRange: { start: startDate, end: endDate } }),
      fetchPPWebsiteConversion(month),
      fetchETZWebsiteConversion(month),
    ]);

  const ppSpend  = ppAdsResult.status  === 'fulfilled'
    ? ppAdsResult.value.reduce( (s, r) => s + r.actualSpend, 0) : 0;
  const etzSpend = etzAdsResult.status === 'fulfilled'
    ? etzAdsResult.value.reduce((s, r) => s + r.actualSpend, 0) : 0;
  const hscSpend = hscAdsResult.status === 'fulfilled'
    ? hscAdsResult.value.reduce((s, r) => s + r.actualSpend, 0) : 0;

  const ppRev    = ppRevResult.status    === 'fulfilled' ? ppRevResult.value    : null;
  const etzRev   = etzRevResult.status   === 'fulfilled' ? etzRevResult.value   : null;
  const hscRev   = hscRevResult.status   === 'fulfilled' ? hscRevResult.value   : null;
  const blakeRev = blakeRevResult.status === 'fulfilled' ? blakeRevResult.value : null;
  const email    = emailResult.status    === 'fulfilled' ? emailResult.value    : null;
  const ppConv   = ppConvResult.status   === 'fulfilled' ? ppConvResult.value   : null;
  const etzConv  = etzConvResult.status  === 'fulfilled' ? etzConvResult.value  : null;

  const ppRevenue    = ppRev?.totalRevenue    ?? 0;
  const etzRevenue   = etzRev?.totalRevenue   ?? 0;
  const hscRevenue   = hscRev?.totalRevenue   ?? 0;
  const blakeRevenue = blakeRev?.totalRevenue ?? 0;

  const ppBudget    = MONTHLY_GOOGLE_BUDGETS['Pascal Press']      ?? 0;
  const etzBudget   = MONTHLY_GOOGLE_BUDGETS['Excel Test Zone']   ?? 0;
  const hscBudget   = MONTHLY_GOOGLE_BUDGETS['Excel HSC Copilot'] ?? 0;
  const blakeBudget = MONTHLY_GOOGLE_BUDGETS['Blake Education']   ?? 0;

  const ppRoas    = ppSpend    > 0 ? Math.round((ppRevenue    / ppSpend)    * 10) / 10 : 0;
  const etzRoas   = etzSpend   > 0 ? Math.round((etzRevenue   / etzSpend)   * 10) / 10 : 0;
  const hscRoas   = hscSpend   > 0 ? Math.round((hscRevenue   / hscSpend)   * 10) / 10 : 0;
  const blakeRoas = blakeSpend > 0 ? Math.round((blakeRevenue / blakeSpend) * 10) / 10 : 0;
  const totalSpend   = ppSpend + etzSpend + hscSpend + blakeSpend;
  const totalRevenue = ppRevenue + etzRevenue + hscRevenue + blakeRevenue;
  const combinedRoas = totalSpend > 0
    ? Math.round((totalRevenue / totalSpend) * 10) / 10
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

  // ── Excel HSC Copilot budget alerts ───────────────────────────────────────
  const hscSpendPct = hscBudget > 0 ? hscSpend / hscBudget : 0;
  if (hscSpendPct > 1.0) {
    alerts.push({ id: 'hsc-over', severity: 'danger', brand: 'Excel HSC Copilot',
      message: `Excel HSC Copilot is over budget — ${Math.round(hscSpendPct * 100)}% of the $${hscBudget.toLocaleString()} monthly budget used.` });
  } else if (hscSpendPct > 0.85) {
    alerts.push({ id: 'hsc-near', severity: 'warning', brand: 'Excel HSC Copilot',
      message: `Excel HSC Copilot is at ${Math.round(hscSpendPct * 100)}% of budget with ${daysInMonth - currentDay} days remaining.` });
  } else if (currentDay > 7 && hscSpendPct < dayPct - 0.20) {
    alerts.push({ id: 'hsc-under', severity: 'info', brand: 'Excel HSC Copilot',
      message: `Excel HSC Copilot is underpacing — ${Math.round(hscSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
  } else if (hscSpendPct > dayPct + 0.20) {
    alerts.push({ id: 'hsc-fast', severity: 'warning', brand: 'Excel HSC Copilot',
      message: `Excel HSC Copilot is overpacing — ${Math.round(hscSpendPct * 100)}% budget used vs ${Math.round(dayPct * 100)}% through the month.` });
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

  // ── Website conversion alerts ───────────────────────────────────────────────
  if (ppConv?.connected && ppConv.direction === 'down' && (ppConv.deltaPp ?? 0) <= -0.3) {
    alerts.push({
      id: 'pp-cr-down', severity: 'warning', brand: 'Pascal Press',
      message: `Pascal Press site conversion is ${ppConv.current?.conversionRate.toFixed(2)}% (${ppConv.deltaPp}pp) — ${ppConv.reason ?? 'down vs same period last month'}.`,
    });
  }
  if (etzConv?.connected && etzConv.direction === 'down' && (etzConv.deltaPp ?? 0) <= -0.3) {
    alerts.push({
      id: 'etz-cr-down', severity: 'warning', brand: 'Excel Test Zone',
      message: `Excel Test Zone site conversion is ${etzConv.current?.conversionRate.toFixed(2)}% (${etzConv.deltaPp}pp) — ${etzConv.reason ?? 'down vs same period last month'}.`,
    });
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
  const hscAdsError = hscAdsResult.status === 'rejected' ? String(hscAdsResult.reason) : null;
  if (ppAdsError)  console.error('[overview] PP Google Ads error:',  ppAdsError);
  if (etzAdsError) console.error('[overview] ETZ Google Ads error:', etzAdsError);
  if (hscAdsError) console.error('[overview] HSC Google Ads error:', hscAdsError);
  if (blakeRevResult.status === 'rejected') {
    console.error('[overview] Blake BigCommerce error:', String(blakeRevResult.reason));
  }

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
      conversion:   ppConv?.connected ? {
        rate:      ppConv.current?.conversionRate ?? null,
        deltaPp:   ppConv.deltaPp,
        direction: ppConv.direction,
        sessions:  ppConv.current?.sessions ?? null,
        purchases: ppConv.current?.purchases ?? null,
        reason:    ppConv.reason,
      } : null,
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
      conversion:   etzConv?.connected ? {
        rate:      etzConv.current?.conversionRate ?? null,
        deltaPp:   etzConv.deltaPp,
        direction: etzConv.direction,
        sessions:  etzConv.current?.sessions ?? null,
        purchases: etzConv.current?.purchases ?? null,
        reason:    etzConv.reason,
      } : null,
    },
    hsc: {
      spend:        Math.round(hscSpend * 100) / 100,
      budget:       hscBudget,
      revenue:      Math.round(hscRevenue * 100) / 100,
      roas:         hscRoas,
      orders:       hscRev?.totalOrders ?? 0,
      revConnected: hscRev?.connected   ?? false,
      adsConnected: hscAdsResult.status === 'fulfilled',
      adsError:     hscAdsError,
      conversion:   null,
    },
    blake: {
      spend:        Math.round(blakeSpend * 100) / 100,
      budget:       blakeBudget,
      revenue:      Math.round(blakeRevenue * 100) / 100,
      roas:         blakeRoas,
      orders:       blakeRev?.totalOrders ?? 0,
      revConnected: blakeRev?.connected   ?? false,
      adsConnected: false,
      adsError:     null,
      conversion:   null,
    },
    combined: {
      spend:   Math.round(totalSpend   * 100) / 100,
      revenue: Math.round(totalRevenue * 100) / 100,
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
