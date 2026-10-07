/**
 * GET /api/etz-weekly-report[?start=YYYY-MM-DD&end=YYYY-MM-DD[&compStart=..&compEnd=..]]
 *
 * Everything the weekly Excel Test Zone performance deck needs. With no
 * params it reports month to date versus the same days last month — the same
 * windows as the dashboard's MTD card. With start/end it reports that range
 * versus the immediately preceding equal-length period (or compStart/compEnd).
 * Read-only.
 */
import { NextResponse } from 'next/server';
import { fetchETZStripeRevenue, fetchStripeProductMap, zonedDateTimeToUnix } from '@/lib/stripe-revenue';
import { fetchChannelRevenue, fetchEtzFunnelTraffic, fetchEtzAppTraffic } from '@/lib/google-analytics';
import { fetchTrialConversion } from '@/lib/hubspot-trials';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchMetaSpend, META_ETZ_ACCOUNT_ID } from '@/lib/meta-ads';
import { ETZ_MONTHLY_REVENUE_TARGETS, MONTHLY_GOOGLE_BUDGETS, ETZ_CHATGPT_SPEND } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ETZ_START_MONTH = '2026-07';
const STRIPE_ETZ = process.env.STRIPE_SECRET_KEY ?? '';

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

function msRange(start: string, end: string) {
  return {
    startMs: zonedDateTimeToUnix(start, '00:00:00') * 1000,
    endMs:   zonedDateTimeToUnix(end, '23:59:59') * 1000,
  };
}

function subMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  let nm = m! - n, ny = y!;
  while (nm < 1) { nm += 12; ny--; }
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

async function etzSpend(start: string, end: string) {
  const month = end.slice(0, 7);
  let google = 0;
  let meta = 0;
  let googleOk = true;
  let metaOk = true;
  try {
    const cfg = month >= ETZ_START_MONTH ? buildConfig('etz') : buildConfig('pp');
    const filter = month >= ETZ_START_MONTH ? undefined : { contains: 'ETZ' };
    google = (await fetchMonthlySpend(cfg, start, end, filter)).reduce((s, r) => s + r.actualSpend, 0);
  } catch { googleOk = false; }
  try {
    meta = await fetchMetaSpend(META_ETZ_ACCOUNT_ID, start, end, { contains: 'ETZ' });
  } catch { metaOk = false; }
  const chatgpt = ETZ_CHATGPT_SPEND[month] ?? 0;
  return { google, meta, chatgpt, total: google + meta + chatgpt, googleOk, metaOk };
}

const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const today = toYMD(new Date());
  const isMtd = !sp.get('start') && !sp.get('end');
  const start = sp.get('start') ?? `${today.slice(0, 7)}-01`;
  const end = sp.get('end') ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return NextResponse.json({ error: 'start/end must be YYYY-MM-DD with start <= end' }, { status: 400 });
  }

  const len = dayDiff(start, end) + 1;
  const pStart = sp.get('compStart') ?? (isMtd ? subMonths(start, 1) : addDays(start, -len));
  const pEnd = sp.get('compEnd') ?? (isMtd ? subMonths(end, 1) : addDays(start, -1));
  const comparisonLabel = isMtd ? 'same days last month' : 'previous period';
  const month = end.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthNum = Number(month.slice(5, 7));

  const c = msRange(start, end);
  const p = msRange(pStart, pEnd);

  const [
    revC, revP, trialC, trialP,
    siteAllC, siteAllP, siteMainC, siteMainP, appC, appP,
    chanRev, spendC, spendP, prodC, prodP, mtdRev, mtdSpend,
  ] = await Promise.allSettled([
    fetchETZStripeRevenue(end.slice(0, 7), { accurate: false, dateRange: { start, end } }),
    fetchETZStripeRevenue(pEnd.slice(0, 7), { accurate: false, dateRange: { start: pStart, end: pEnd } }),
    fetchTrialConversion('etz', c.startMs, c.endMs),
    fetchTrialConversion('etz', p.startMs, p.endMs),
    fetchEtzFunnelTraffic(start, end, false),
    fetchEtzFunnelTraffic(pStart, pEnd, false),
    fetchEtzFunnelTraffic(start, end, true),
    fetchEtzFunnelTraffic(pStart, pEnd, true),
    fetchEtzAppTraffic(start, end),
    fetchEtzAppTraffic(pStart, pEnd),
    fetchChannelRevenue(start, end, 'etz'),
    etzSpend(start, end),
    etzSpend(pStart, pEnd),
    fetchStripeProductMap(STRIPE_ETZ, start, end),
    fetchStripeProductMap(STRIPE_ETZ, pStart, pEnd),
    fetchETZStripeRevenue(month, { accurate: false, dateRange: { start: monthStart, end } }),
    etzSpend(monthStart, end),
  ]);

  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
  const failed: string[] = [];
  const names = ['revC', 'revP', 'trialC', 'trialP', 'siteAllC', 'siteAllP', 'siteMainC', 'siteMainP', 'appC', 'appP',
    'chanRev', 'spendC', 'spendP', 'prodC', 'prodP', 'mtdRev', 'mtdSpend'];
  [revC, revP, trialC, trialP, siteAllC, siteAllP, siteMainC, siteMainP, appC, appP,
    chanRev, spendC, spendP, prodC, prodP, mtdRev, mtdSpend].forEach((r, i) => {
    if (r.status === 'rejected') failed.push(names[i]!);
  });

  const rc = ok(revC), rp = ok(revP), tc = ok(trialC), tp = ok(trialP);
  const sc = ok(spendC), sPrev = ok(spendP);
  const ac = ok(appC), ap = ok(appP);
  const sac = ok(siteAllC), sap = ok(siteAllP), smc = ok(siteMainC), smp = ok(siteMainP);
  const ch = ok(chanRev);

  const revenue = rc?.totalRevenue ?? 0, revenueP = rp?.totalRevenue ?? 0;
  const orders = rc?.totalOrders ?? 0, ordersP = rp?.totalOrders ?? 0;
  const aov = orders > 0 ? revenue / orders : 0, aovP = ordersP > 0 ? revenueP / ordersP : 0;
  const trials = tc?.totalEverStarted ?? 0, trialsP = tp?.totalEverStarted ?? 0;
  const appSess = ac?.totalSessions ?? 0, appSessP = ap?.totalSessions ?? 0;
  const appConv = appSess > 0 ? (trials / appSess) * 100 : null;
  const appConvP = appSessP > 0 ? (trialsP / appSessP) * 100 : null;

  // Channel table: sessions from GA4 (whole ETZ property), revenue/orders from GA4 attribution.
  const sessionsBy = (name: string[]) =>
    (sac?.byChannel ?? []).filter(r => name.includes(r.channel)).reduce((s, r) => s + r.sessions, 0);
  const revBy = (name: string[]) => {
    const items = (ch?.items ?? []).filter(r => name.includes(r.channel));
    return { revenue: items.reduce((s, r) => s + r.revenue, 0), orders: items.reduce((s, r) => s + r.transactions, 0) };
  };
  const mainNames = ['Organic Search', 'Paid Search', 'Paid Social', 'Email'];
  const row = (label: string, names: string[], spend: number | null) => {
    const r = revBy(names);
    return {
      channel: label,
      sessions: sessionsBy(names),
      orders: r.orders,
      revenue: r.revenue,
      spend,
      roas: spend && spend > 0 ? r.revenue / spend : null,
    };
  };
  const otherSessions = (sac?.byChannel ?? []).filter(r => !mainNames.includes(r.channel)).reduce((s, r) => s + r.sessions, 0);
  const other = (ch?.items ?? []).filter(r => !mainNames.includes(r.channel));
  const channels = [
    row('Google organic search', ['Organic Search'], null),
    row('Google Ads', ['Paid Search'], sc?.google ?? null),
    row('Meta Ads', ['Paid Social'], sc?.meta ?? null),
    row('Email', ['Email'], null),
    {
      channel: 'Direct and other',
      sessions: otherSessions,
      orders: other.reduce((s, r) => s + r.transactions, 0),
      revenue: other.reduce((s, r) => s + r.revenue, 0),
      spend: null, roas: null,
    },
  ];

  const prodTotal = (m: Map<string, { revenue: number; qty: number }> | null) =>
    m ? Array.from(m.values()).reduce((s, v) => s + v.revenue, 0) : 0;
  const pc = ok(prodC), pp = ok(prodP);
  const products = pc
    ? Array.from(pc.entries())
        .map(([name, v]) => ({
          name, revenue: v.revenue, orders: v.qty,
          sharePct: prodTotal(pc) > 0 ? Math.round((v.revenue / prodTotal(pc)) * 100) : 0,
          prevRevenue: pp?.get(name)?.revenue ?? 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
    : [];

  const mtd = ok(mtdRev), mtdS = ok(mtdSpend);
  const monthlyTarget = ETZ_MONTHLY_REVENUE_TARGETS[monthNum] ?? 0;
  const monthlyBudget = MONTHLY_GOOGLE_BUDGETS['Excel Test Zone'] ?? 0;

  return NextResponse.json({
    connected: true,
    failed,
    period: { start, end, days: len },
    comparison: { start: pStart, end: pEnd, label: comparisonLabel },
    revenue: { current: revenue, prior: revenueP, pctChange: pct(revenue, revenueP) },
    orders: { current: orders, prior: ordersP, pctChange: pct(orders, ordersP) },
    aov: { current: aov, prior: aovP, pctChange: pct(aov, aovP) },
    trials: { current: trials, prior: trialsP, pctChange: pct(trials, trialsP),
      stillTrialing: tc?.trialsStarted ?? 0, stillTrialingPrior: tp?.trialsStarted ?? 0 },
    appVisitorToTrial: { current: appConv, prior: appConvP, appSessions: appSess, appSessionsPrior: appSessP,
      appNewUsers: ac?.totalNewUsers ?? 0, appNewUsersPrior: ap?.totalNewUsers ?? 0 },
    trialToPaid: {
      current: tc ? { converted: tc.converted, measured: tc.totalEverStarted, pct: tc.pct } : null,
      prior: tp ? { converted: tp.converted, measured: tp.totalEverStarted, pct: tp.pct } : null,
    },
    spend: {
      current: sc, prior: sPrev,
      roasCurrent: sc && sc.total > 0 ? revenue / sc.total : null,
    },
    monthToDate: {
      month, throughDate: end,
      revenue: mtd?.totalRevenue ?? null, monthlyTarget,
      spend: mtdS?.total ?? null, googleSpend: mtdS?.google ?? null, metaSpend: mtdS?.meta ?? null,
      monthlyGoogleBudget: monthlyBudget,
    },
    channels,
    ga4Totals: { revenue: ch?.totalRevenue ?? null, orders: (ch?.items ?? []).reduce((s, r) => s + r.transactions, 0) },
    traffic: {
      allHostnames: { sessions: sac?.totalSessions ?? null, newUsers: sac?.totalNewUsers ?? null,
        priorSessions: sap?.totalSessions ?? null, priorNewUsers: sap?.totalNewUsers ?? null,
        pctChange: pct(sac?.totalSessions ?? 0, sap?.totalSessions ?? 0) },
      mainSite: { sessions: smc?.totalSessions ?? null, newUsers: smc?.totalNewUsers ?? null,
        priorSessions: smp?.totalSessions ?? null, priorNewUsers: smp?.totalNewUsers ?? null,
        pctChange: pct(smc?.totalSessions ?? 0, smp?.totalSessions ?? 0) },
      app: { sessions: appSess, priorSessions: appSessP, pctChange: pct(appSess, appSessP),
        fromMainSite: ac?.fromMainSite ?? null },
      byChannel: sac?.byChannel ?? [],
      byChannelPrior: sap?.byChannel ?? [],
    },
    products,
  });
}
