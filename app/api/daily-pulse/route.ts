/**
 * GET /api/daily-pulse
 *
 * "Today vs same day last week" snapshot for the Systems Check tab.
 * All "today" figures are partial (up to now).
 *
 * Returns:
 *   pp  – Pascal Press BigCommerce revenue + combined ad spend (Google + Meta)
 *   etz – ETZ Stripe revenue + combined ad spend (Google + Meta)
 *   traffic – GA4 sessions by channel (PP + ETZ combined) vs 7 days ago
 */

import { NextResponse } from 'next/server';
import { fetchPPRevenue }       from '@/lib/bigcommerce-revenue';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchMetaSpend, META_PP_ACCOUNT_ID, META_ETZ_ACCOUNT_ID } from '@/lib/meta-ads';

export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

// ── Date helpers ──────────────────────────────────────────────────────────────

const SYDNEY_TZ = 'Australia/Sydney';

function sydneyDates(): { today: string; sevenDaysAgo: string } {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const now      = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { today: fmt(now), sevenDaysAgo: fmt(sevenAgo) };
}

function sydneyMidnightUnix(ymd: string): number {
  const [Y, M, D] = ymd.split('-').map(Number);
  const guess = Date.UTC(Y!, M! - 1, D!);
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYDNEY_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  for (let offset = -12; offset <= 0; offset++) {
    const candidate = guess + offset * 3_600_000;
    const parts = dtf.formatToParts(new Date(candidate));
    const h = parts.find(p => p.type === 'hour')?.value;
    const min = parts.find(p => p.type === 'minute')?.value;
    if (h === '00' && min === '00') return Math.floor(candidate / 1000);
  }
  return Math.floor(guess / 1000) - 36000;
}

// ── Stripe daily revenue ──────────────────────────────────────────────────────

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeRevenueWindow(secretKey: string, fromUnix: number, toUnix: number): Promise<number> {
  if (!secretKey) return 0;
  let total = 0;
  const params = new URLSearchParams({
    'created[gte]': String(fromUnix),
    'created[lte]': String(toUnix),
    limit: '100',
  });
  const res = await fetch(`${STRIPE_BASE}/charges?${params}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: 'no-store',
  });
  if (!res.ok) return 0;
  const data = await res.json() as { data: Array<{ paid: boolean; status: string; amount: number; amount_refunded: number }> };
  for (const c of data.data) {
    if (!c.paid || c.status !== 'succeeded') continue;
    const net = (c.amount ?? 0) - (c.amount_refunded ?? 0);
    if (net > 100) total += net;
  }
  return Math.round(total) / 100;
}

// ── Google Ads daily spend ────────────────────────────────────────────────────

async function googleAdsSpendForDay(brand: 'pp' | 'etz', date: string): Promise<number> {
  try {
    const cfg  = buildConfig(brand);
    const rows = await fetchMonthlySpend(cfg, date, date);
    return rows.reduce((s, r) => s + r.actualSpend, 0);
  } catch {
    return 0;
  }
}

// ── GA4 helpers ───────────────────────────────────────────────────────────────

const GA4_PP_BASE  = `https://analyticsdata.googleapis.com/v1beta/properties/354651290`;
const GA4_ETZ_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GOOGLE_ANALYTICS_ETZ_PROPERTY_ID ?? 'unset'}`;

const CHANNEL_MAP: Record<string, string> = {
  'Unassigned': 'Other', '(not set)': 'Other', '(Other)': 'Other',
  'Cross-network': 'Paid Search', 'Paid Shopping': 'Paid Search',
};

interface ChannelRow { channel: string; sessions: number }

async function ga4ChannelSessions(base: string, token: string, startDate: string, endDate: string): Promise<ChannelRow[]> {
  if (base.includes('unset') || !token) return [];
  const res = await fetch(`${base}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    }),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  const acc: Record<string, number> = {};
  for (const row of (data.rows ?? [])) {
    const raw = row.dimensionValues?.[0]?.value ?? 'Other';
    const ch  = CHANNEL_MAP[raw] ?? raw;
    acc[ch]   = (acc[ch] ?? 0) + parseInt(row.metricValues?.[0]?.value ?? '0', 10);
  }
  return Object.entries(acc).map(([channel, sessions]) => ({ channel, sessions })).sort((a, b) => b.sessions - a.sessions);
}

async function getGA4Token(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID     ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? '',
      grant_type:    'refresh_token',
    }),
    cache: 'no-store',
  });
  if (!res.ok) return '';
  const d = await res.json();
  return d.access_token ?? '';
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const { today, sevenDaysAgo } = sydneyDates();
  const nowUnix   = Math.floor(Date.now() / 1000);
  const todayMid  = sydneyMidnightUnix(today);
  const lastWkMid = sydneyMidnightUnix(sevenDaysAgo);
  const elapsed   = nowUnix - todayMid;
  const lastWkEnd = lastWkMid + elapsed;

  const etzKey = process.env.STRIPE_SECRET_KEY ?? '';

  const [
    ga4Token,
    // PP BigCommerce revenue
    ppBcToday,
    ppBcLastWk,
    // ETZ Stripe revenue
    etzStripeToday,
    etzStripeLastWk,
    // Google Ads spend
    ppGoogleToday,
    ppGoogleLastWk,
    etzGoogleToday,
    etzGoogleLastWk,
    // Meta spend
    ppMetaToday,
    ppMetaLastWk,
    etzMetaToday,
    etzMetaLastWk,
  ] = await Promise.all([
    getGA4Token(),
    fetchPPRevenue(today.slice(0, 7), { start: today, end: today }).then(r => r.totalRevenue).catch(() => 0),
    fetchPPRevenue(sevenDaysAgo.slice(0, 7), { start: sevenDaysAgo, end: sevenDaysAgo }).then(r => r.totalRevenue).catch(() => 0),
    stripeRevenueWindow(etzKey, todayMid, nowUnix),
    stripeRevenueWindow(etzKey, lastWkMid, lastWkEnd),
    googleAdsSpendForDay('pp',  today),
    googleAdsSpendForDay('pp',  sevenDaysAgo),
    googleAdsSpendForDay('etz', today),
    googleAdsSpendForDay('etz', sevenDaysAgo),
    fetchMetaSpend(META_PP_ACCOUNT_ID,  today,        today).catch(() => 0),
    fetchMetaSpend(META_PP_ACCOUNT_ID,  sevenDaysAgo, sevenDaysAgo).catch(() => 0),
    fetchMetaSpend(META_ETZ_ACCOUNT_ID, today,        today).catch(() => 0),
    fetchMetaSpend(META_ETZ_ACCOUNT_ID, sevenDaysAgo, sevenDaysAgo).catch(() => 0),
  ]);

  // GA4 traffic (needs token first)
  const [ppTodayCh, ppLastWkCh, etzTodayCh, etzLastWkCh] = await Promise.all([
    ga4ChannelSessions(GA4_PP_BASE,  ga4Token, 'today',    'today'),
    ga4ChannelSessions(GA4_PP_BASE,  ga4Token, '7daysAgo', '7daysAgo'),
    ga4ChannelSessions(GA4_ETZ_BASE, ga4Token, 'today',    'today'),
    ga4ChannelSessions(GA4_ETZ_BASE, ga4Token, '7daysAgo', '7daysAgo'),
  ]);

  function merge(a: ChannelRow[], b: ChannelRow[]): ChannelRow[] {
    const acc: Record<string, number> = {};
    for (const r of [...a, ...b]) acc[r.channel] = (acc[r.channel] ?? 0) + r.sessions;
    return Object.entries(acc).map(([channel, sessions]) => ({ channel, sessions })).sort((x, y) => y.sessions - x.sessions);
  }

  const todayCombined  = merge(ppTodayCh,  etzTodayCh);
  const lastWkCombined = merge(ppLastWkCh, etzLastWkCh);
  const allChannels    = Array.from(new Set([...todayCombined, ...lastWkCombined].map(r => r.channel)));

  const channelDeltas = allChannels.map(ch => {
    const now  = todayCombined.find(r => r.channel === ch)?.sessions  ?? 0;
    const prev = lastWkCombined.find(r => r.channel === ch)?.sessions ?? 0;
    return { channel: ch, today: now, lastWeek: prev, deltaPct: prev > 0 ? Math.round(((now - prev) / prev) * 100) : 0 };
  }).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  function pct(now: number, prev: number) { return prev > 0 ? Math.round(((now - prev) / prev) * 100) : 0; }

  const ppAdToday  = ppGoogleToday  + ppMetaToday;
  const ppAdLastWk = ppGoogleLastWk + ppMetaLastWk;
  const etzAdToday  = etzGoogleToday  + etzMetaToday;
  const etzAdLastWk = etzGoogleLastWk + etzMetaLastWk;

  return NextResponse.json({
    asOf:        new Date().toISOString(),
    todayDate:   today,
    lastWkDate:  sevenDaysAgo,
    elapsedMins: Math.round(elapsed / 60),
    pp: {
      revenueToday:   ppBcToday,
      revenueLastWk:  ppBcLastWk,
      revenueDelta:   pct(ppBcToday, ppBcLastWk),
      adSpendToday:   ppAdToday,
      adSpendLastWk:  ppAdLastWk,
      adSpendDelta:   pct(ppAdToday, ppAdLastWk),
      adBreakdown: { googleToday: ppGoogleToday, metaToday: ppMetaToday, googleLastWk: ppGoogleLastWk, metaLastWk: ppMetaLastWk },
    },
    etz: {
      revenueToday:   etzStripeToday,
      revenueLastWk:  etzStripeLastWk,
      revenueDelta:   pct(etzStripeToday, etzStripeLastWk),
      adSpendToday:   etzAdToday,
      adSpendLastWk:  etzAdLastWk,
      adSpendDelta:   pct(etzAdToday, etzAdLastWk),
      adBreakdown: { googleToday: etzGoogleToday, metaToday: etzMetaToday, googleLastWk: etzGoogleLastWk, metaLastWk: etzMetaLastWk },
    },
    traffic: {
      totalToday:    todayCombined.reduce((s, r) => s + r.sessions, 0),
      totalLastWeek: lastWkCombined.reduce((s, r) => s + r.sessions, 0),
      deltaPct:      pct(todayCombined.reduce((s, r) => s + r.sessions, 0), lastWkCombined.reduce((s, r) => s + r.sessions, 0)),
      channelDeltas,
    },
  });
}
