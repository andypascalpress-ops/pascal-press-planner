/**
 * GET /api/daily-pulse
 *
 * Returns a "today vs same day last week" snapshot for the Systems Check tab:
 *   - GA4 sessions by channel: Pascal Press + ETZ (today vs 7 days ago)
 *   - Stripe revenue: today so far vs same elapsed time 7 days ago
 *   - Meta Ads spend: today vs 7 days ago
 *
 * All "today" figures are partial (up to now); labelled accordingly in the UI.
 * GA4 uses relative date strings ('today', '7daysAgo') which respect the property timezone.
 * Stripe timestamps are computed in Australia/Sydney time.
 */

import { NextResponse } from 'next/server';
import { fetchMetaSpend, META_PP_ACCOUNT_ID, META_ETZ_ACCOUNT_ID } from '@/lib/meta-ads';

export const dynamic  = 'force-dynamic';
export const maxDuration = 30;

// ── Date helpers ──────────────────────────────────────────────────────────────

const SYDNEY_TZ = 'Australia/Sydney';

/** Return today's and 7-days-ago date strings (YYYY-MM-DD) in Sydney time. */
function sydneyDates(): { today: string; sevenDaysAgo: string } {
  const nowSydney = new Intl.DateTimeFormat('en-CA', {
    timeZone:  SYDNEY_TZ,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
  }).format(new Date());
  const [y, m, d] = nowSydney.split('-').map(Number);
  const sevenBack = new Date(Date.UTC(y!, m! - 1, d! - 7));
  const sevenDaysAgo = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY_TZ,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(sevenBack);
  return { today: nowSydney, sevenDaysAgo };
}

/** Unix timestamp for midnight on a YYYY-MM-DD date in Sydney time. */
function sydneyMidnightUnix(ymd: string): number {
  const [Y, M, D] = ymd.split('-').map(Number);
  // Start at UTC midnight on that date and walk backwards/forwards
  // to find the actual UTC moment that is midnight in Sydney.
  const guess = Date.UTC(Y!, M! - 1, D!);
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone:    SYDNEY_TZ,
    hour:        '2-digit',
    minute:      '2-digit',
    second:      '2-digit',
    hour12:      false,
  });
  // Binary search isn't needed — AEST = UTC+10, AEDT = UTC+11. Max offset is 11h.
  // Try guess − 12h … guess, pick the one that gives 00:00:00 in Sydney.
  for (let offset = -12; offset <= 0; offset++) {
    const candidate = guess + offset * 3_600_000;
    const parts = dtf.formatToParts(new Date(candidate));
    const h = parts.find(p => p.type === 'hour')?.value;
    const min = parts.find(p => p.type === 'minute')?.value;
    if (h === '00' && min === '00') return Math.floor(candidate / 1000);
  }
  return Math.floor(guess / 1000) - 36000; // fallback: UTC midnight − 10 h
}

// ── GA4 helpers ───────────────────────────────────────────────────────────────

const GA4_PP_BASE  = `https://analyticsdata.googleapis.com/v1beta/properties/354651290`;
const GA4_ETZ_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GOOGLE_ANALYTICS_ETZ_PROPERTY_ID ?? ''}`;

const CHANNEL_MAP: Record<string, string> = {
  'Unassigned': 'Other', '(not set)': 'Other', '(Other)': 'Other',
  'Cross-network': 'Paid Search', 'Paid Shopping': 'Paid Search',
};

interface ChannelRow { channel: string; sessions: number }

async function ga4ChannelSessions(
  base: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ChannelRow[]> {
  const res = await fetch(`${base}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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
  return Object.entries(acc)
    .map(([channel, sessions]) => ({ channel, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

async function getGA4AccessToken(): Promise<string> {
  const clientId     = process.env.GOOGLE_CLIENT_ID     ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';
  if (!clientId || !clientSecret || !refreshToken) return '';
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    cache: 'no-store',
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.access_token ?? '';
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeRevenueWindow(
  secretKey: string,
  fromUnix: number,
  toUnix: number,
): Promise<number> {
  if (!secretKey) return 0;
  let total = 0;
  let url: string | null =
    `${STRIPE_BASE}/charges?` +
    new URLSearchParams({
      'created[gte]': String(fromUnix),
      'created[lte]': String(toUnix),
      limit: '100',
    });
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
    });
    if (!res.ok) break;
    const data = await res.json() as {
      data: Array<{ paid: boolean; status: string; amount: number; amount_refunded: number }>;
      has_more: boolean;
      url?: string;
    };
    for (const c of data.data) {
      if (!c.paid || c.status !== 'succeeded') continue;
      const net = (c.amount ?? 0) - (c.amount_refunded ?? 0);
      if (net > 100) total += net; // cents
    }
    url = data.has_more
      ? `${STRIPE_BASE}/charges?` + new URLSearchParams({
          'created[gte]': String(fromUnix),
          'created[lte]': String(toUnix),
          limit: '100',
          starting_after: data.data[data.data.length - 1]!.amount.toString(),
        })
      : null;
    // Simple single-page for daily snapshot (unlikely to exceed 100 charges/day)
    break;
  }
  return Math.round(total) / 100;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const { today, sevenDaysAgo } = sydneyDates();
  const nowUnix     = Math.floor(Date.now() / 1000);
  const todayMid    = sydneyMidnightUnix(today);
  const lastWkMid   = sydneyMidnightUnix(sevenDaysAgo);
  const elapsedSecs = nowUnix - todayMid;
  const lastWkEnd   = lastWkMid + elapsedSecs; // same elapsed time 7 days ago

  const stripeEtzKey = process.env.STRIPE_SECRET_KEY ?? '';
  const stripeHscKey = process.env.STRIPE_HSC_SECRET_KEY ?? '';

  const [
    accessToken,
    stripeToday,
    stripeLastWk,
    stripeHscToday,
    stripeHscLastWk,
    metaPPToday,
    metaPPLastWk,
    metaETZToday,
    metaETZLastWk,
  ] = await Promise.all([
    getGA4AccessToken(),
    stripeRevenueWindow(stripeEtzKey, todayMid, nowUnix),
    stripeRevenueWindow(stripeEtzKey, lastWkMid, lastWkEnd),
    stripeRevenueWindow(stripeHscKey, todayMid, nowUnix),
    stripeRevenueWindow(stripeHscKey, lastWkMid, lastWkEnd),
    fetchMetaSpend(META_PP_ACCOUNT_ID,  today, today).catch(() => 0),
    fetchMetaSpend(META_PP_ACCOUNT_ID,  sevenDaysAgo, sevenDaysAgo).catch(() => 0),
    fetchMetaSpend(META_ETZ_ACCOUNT_ID, today, today).catch(() => 0),
    fetchMetaSpend(META_ETZ_ACCOUNT_ID, sevenDaysAgo, sevenDaysAgo).catch(() => 0),
  ]);

  // GA4 (needs token — run after auth)
  const [ppToday, ppLastWk, etzToday, etzLastWk] = accessToken
    ? await Promise.all([
        ga4ChannelSessions(GA4_PP_BASE,  accessToken, 'today',      'today'),
        ga4ChannelSessions(GA4_PP_BASE,  accessToken, '7daysAgo',   '7daysAgo'),
        GA4_ETZ_BASE.includes('undefined') ? [] : ga4ChannelSessions(GA4_ETZ_BASE, accessToken, 'today',    'today'),
        GA4_ETZ_BASE.includes('undefined') ? [] : ga4ChannelSessions(GA4_ETZ_BASE, accessToken, '7daysAgo', '7daysAgo'),
      ])
    : [[], [], [], []];

  // Merge PP + ETZ sessions into one channel table for the combined view
  function mergeChannels(a: ChannelRow[], b: ChannelRow[]): ChannelRow[] {
    const acc: Record<string, number> = {};
    for (const r of [...a, ...b]) acc[r.channel] = (acc[r.channel] ?? 0) + r.sessions;
    return Object.entries(acc).map(([channel, sessions]) => ({ channel, sessions }))
      .sort((x, y) => y.sessions - x.sessions);
  }

  const todayCombined  = mergeChannels(ppToday,  etzToday);
  const lastWkCombined = mergeChannels(ppLastWk, etzLastWk);

  // Build channel deltas — show channels that moved significantly
  const allChannels = Array.from(new Set([...todayCombined, ...lastWkCombined].map(r => r.channel)));
  const channelDeltas = allChannels.map(ch => {
    const now  = todayCombined.find(r => r.channel === ch)?.sessions  ?? 0;
    const prev = lastWkCombined.find(r => r.channel === ch)?.sessions ?? 0;
    const delta = prev > 0 ? Math.round(((now - prev) / prev) * 100) : 0;
    return { channel: ch, today: now, lastWeek: prev, deltaPct: delta };
  }).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const totalToday  = todayCombined.reduce((s, r) => s + r.sessions, 0);
  const totalLastWk = lastWkCombined.reduce((s, r) => s + r.sessions, 0);

  return NextResponse.json({
    asOf:       new Date().toISOString(),
    todayDate:  today,
    lastWkDate: sevenDaysAgo,
    elapsedMins: Math.round(elapsedSecs / 60),
    traffic: {
      totalToday,
      totalLastWeek: totalLastWk,
      deltaPct: totalLastWk > 0 ? Math.round(((totalToday - totalLastWk) / totalLastWk) * 100) : 0,
      channelDeltas,
    },
    revenue: {
      etz: {
        today:    stripeToday,
        lastWeek: stripeLastWk,
        deltaPct: stripeLastWk > 0 ? Math.round(((stripeToday - stripeLastWk) / stripeLastWk) * 100) : 0,
      },
      hsc: {
        today:    stripeHscToday,
        lastWeek: stripeHscLastWk,
        deltaPct: stripeHscLastWk > 0 ? Math.round(((stripeHscToday - stripeHscLastWk) / stripeHscLastWk) * 100) : 0,
      },
    },
    ads: {
      pp: {
        metaToday:    metaPPToday,
        metaLastWeek: metaPPLastWk,
        metaDeltaPct: metaPPLastWk > 0 ? Math.round(((metaPPToday - metaPPLastWk) / metaPPLastWk) * 100) : 0,
      },
      etz: {
        metaToday:    metaETZToday,
        metaLastWeek: metaETZLastWk,
        metaDeltaPct: metaETZLastWk > 0 ? Math.round(((metaETZToday - metaETZLastWk) / metaETZLastWk) * 100) : 0,
      },
    },
  });
}
