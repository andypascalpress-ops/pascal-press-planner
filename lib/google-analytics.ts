/**
 * Google Analytics 4 Data API client
 * Property: 354651290 (Pascal Press — pascalpress.com.au)
 *
 * Auth priority:
 *   1. GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON  — base64-encoded service account JSON key
 *      (add the service account email as Viewer on the GA4 property)
 *   2. GOOGLE_ANALYTICS_CLIENT_ID/SECRET + GOOGLE_ANALYTICS_REFRESH_TOKEN  — OAuth user token
 *   3. Falls back to GOOGLE_ADS_CLIENT_ID/SECRET + GOOGLE_ADS_REFRESH_TOKEN
 *
 * Channel attribution uses GA4's sessionMedium dimension:
 *   medium = "cpc"     → all Google Ads (Search, Shopping, Display, PMax, etc.)
 *   medium = "organic" → organic search traffic
 *   medium = "email"   → email campaigns (HubSpot)
 */

import crypto from 'crypto';
import { fetchPPRevenue } from './bigcommerce-revenue';

const GA4_PROPERTY_ID     = '354651290'; // Pascal Press (pascalpress.com.au)
const GA4_BASE            = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}`;
const GA4_ETZ_PROPERTY_ID = process.env.GOOGLE_ANALYTICS_ETZ_PROPERTY_ID ?? '';
const GA4_ETZ_BASE        = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_ETZ_PROPERTY_ID}`;
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ---------------------------------------------------------------------------
// Service account JWT auth (preferred — no user OAuth needed)
// ---------------------------------------------------------------------------

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getServiceAccountAccessToken(): Promise<string> {
  const raw = Buffer.from(
    process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON!,
    'base64',
  ).toString('utf8');
  const { client_email, private_key } = JSON.parse(raw) as {
    client_email: string;
    private_key:  string;
  };

  const now     = Math.floor(Date.now() / 1000);
  const header  = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss:   client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud:   OAUTH_TOKEN_URL,
      iat:   now,
      exp:   now + 3600,
    }),
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = base64urlEncode(signer.sign(private_key));

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(OAUTH_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      `GA4 service account auth failed: ${data.error_description ?? data.error ?? JSON.stringify(data)}`,
    );
  }
  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// OAuth refresh token auth (fallback)
// ---------------------------------------------------------------------------

async function getOAuthAccessToken(): Promise<string> {
  const clientId     = process.env.GOOGLE_ANALYTICS_CLIENT_ID
                    ?? process.env.GOOGLE_ADS_CLIENT_ID
                    ?? '';
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET
                    ?? process.env.GOOGLE_ADS_CLIENT_SECRET
                    ?? '';
  const refreshToken = process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN
                    ?? process.env.GOOGLE_ADS_REFRESH_TOKEN
                    ?? '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing env vars for GA4 OAuth: need CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN',
    );
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      `GA4 OAuth failed: ${data.error_description ?? data.error ?? JSON.stringify(data)}`,
    );
  }
  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// Unified access token getter
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  if (process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON) {
    return getServiceAccountAccessToken();
  }
  return getOAuthAccessToken();
}

function isConnected(): boolean {
  return !!(
    process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN ||
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

function isETZConnected(): boolean {
  return !!(GA4_ETZ_PROPERTY_ID && isConnected());
}

// ---------------------------------------------------------------------------
// GA4 report runner
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReport(accessToken: string, body: object): Promise<any> {
  const res = await fetch(`${GA4_BASE}:runReport`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body:  JSON.stringify(body),
    cache: 'no-store', // always fetch fresh — never serve stale zeros from edge cache
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error (${res.status}): ${err.slice(0, 500)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface GA4ChannelRevenue {
  paidSearchRevenue:    number;
  organicSearchRevenue: number;
  connected:            boolean;
}

export interface GA4MonthlyRevenue {
  month: string; // 'YYYY-MM'
  pp: {
    paid:    number;
    organic: number;
  };
  etz?: {
    paid:    number;
    organic: number;
  };
}

export interface CampaignRevenue {
  campaignName: string;
  revenue:      number;
  transactions: number;
}

export interface EmailRevenueData {
  byCampaign:   CampaignRevenue[];
  totalRevenue: number;
  totalTx:      number;
  connected:    boolean;
}

// ---------------------------------------------------------------------------
// Existing exported functions (channel attribution)
// ---------------------------------------------------------------------------

export async function fetchGA4Revenue(month: string): Promise<GA4ChannelRevenue> {
  if (!isConnected()) {
    return { paidSearchRevenue: 0, organicSearchRevenue: 0, connected: false };
  }

  try {
    const accessToken = await getAccessToken();
    const [year, mon] = month.split('-');
    const lastDay     = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
    const startDate   = `${year}-${mon}-01`;
    // Cap end date to today — GA4 cannot convert AUD→USD for future dates
    const now         = new Date();
    const isCurrentMonth =
      parseInt(year!) === now.getFullYear() && parseInt(mon!) === now.getMonth() + 1;
    const endDayNum   = isCurrentMonth ? Math.min(lastDay, now.getDate()) : lastDay;
    const endDate     = `${year}-${mon}-${String(endDayNum).padStart(2, '0')}`;

    const data = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionMedium' }],
      metrics:    [{ name: 'totalRevenue' }],
    });

    let paidSearchRevenue    = 0;
    let organicSearchRevenue = 0;

    for (const row of data.rows ?? []) {
      const medium = (row.dimensionValues?.[0]?.value ?? '').toLowerCase() as string;
      const rev    = parseFloat(row.metricValues?.[0]?.value ?? '0');
      if (medium === 'cpc')     paidSearchRevenue    += rev;
      if (medium === 'organic') organicSearchRevenue += rev;
    }

    return {
      paidSearchRevenue:    Math.round(paidSearchRevenue    * 100) / 100,
      organicSearchRevenue: Math.round(organicSearchRevenue * 100) / 100,
      connected: true,
    };
  } catch (err) {
    console.error('[google-analytics fetchGA4Revenue]', err);
    return { paidSearchRevenue: 0, organicSearchRevenue: 0, connected: false };
  }
}

export async function fetchGA4RevenueHistory(
  startDate: string,
  endDate:   string,
): Promise<GA4MonthlyRevenue[]> {
  if (!isConnected()) return [];

  try {
    const accessToken = await getAccessToken();

    const data = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'yearMonth' },
        { name: 'sessionMedium' },
      ],
      metrics: [{ name: 'totalRevenue' }],
    });

    const byMonth: Record<string, { paid: number; organic: number }> = {};

    for (const row of data.rows ?? []) {
      const yearMonth = (row.dimensionValues?.[0]?.value ?? '') as string;
      const medium    = (row.dimensionValues?.[1]?.value ?? '').toLowerCase() as string;
      const rev       = parseFloat(row.metricValues?.[0]?.value ?? '0');

      if (yearMonth.length !== 6) continue;
      const ym = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`;

      if (!byMonth[ym]) byMonth[ym] = { paid: 0, organic: 0 };
      if (medium === 'cpc')     byMonth[ym]!.paid    += rev;
      if (medium === 'organic') byMonth[ym]!.organic += rev;
    }

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { paid, organic }]) => ({
        month,
        pp: {
          paid:    Math.round(paid    * 100) / 100,
          organic: Math.round(organic * 100) / 100,
        },
      }));
  } catch (err) {
    console.error('[google-analytics fetchGA4RevenueHistory]', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Email revenue (new) — per-campaign + channel total
// ---------------------------------------------------------------------------

/**
 * Fetch email-attributed revenue from GA4.
 * Returns per-campaign breakdown (via sessionCampaignName + medium=email)
 * and the total email channel revenue.
 */
export async function fetchEmailRevenue(
  startDate = '2022-01-01',
  endDate   = 'today',
): Promise<EmailRevenueData> {
  if (!isConnected()) {
    return { byCampaign: [], totalRevenue: 0, totalTx: 0, connected: false };
  }

  try {
    const accessToken = await getAccessToken();

    // Per-campaign breakdown
    const campaignData = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics:    [{ name: 'totalRevenue' }, { name: 'transactions' }],
      dimensionFilter: {
        filter: {
          fieldName:    'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'email' },
        },
      },
      limit: 500,
    });

    const byCampaign: CampaignRevenue[] = (campaignData.rows ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (row: any) => ({
        campaignName: row.dimensionValues[0]?.value ?? '',
        revenue:      parseFloat(row.metricValues[0]?.value ?? '0'),
        transactions: parseInt(row.metricValues[1]?.value  ?? '0', 10),
      }),
    );

    // Channel total
    const totalData = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionMedium' }],
      metrics:    [{ name: 'totalRevenue' }, { name: 'transactions' }],
      dimensionFilter: {
        filter: {
          fieldName:    'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'email' },
        },
      },
      limit: 1,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totRow       = totalData.rows?.[0] as any;
    const totalRevenue = totRow ? parseFloat(totRow.metricValues[0]?.value ?? '0') : 0;
    const totalTx      = totRow ? parseInt(totRow.metricValues[1]?.value   ?? '0', 10) : 0;

    return { byCampaign, totalRevenue, totalTx, connected: true };
  } catch (err) {
    console.error('[google-analytics fetchEmailRevenue]', err);
    return { byCampaign: [], totalRevenue: 0, totalTx: 0, connected: false };
  }
}

// ---------------------------------------------------------------------------
// ETZ (Excel Test Zone) GA4 functions — uses GOOGLE_ANALYTICS_ETZ_PROPERTY_ID
// Same auth credentials as PP; separate GA4 property in a different GA account.
// ---------------------------------------------------------------------------

export async function fetchETZGA4Revenue(month: string): Promise<GA4ChannelRevenue> {
  if (!isETZConnected()) {
    return { paidSearchRevenue: 0, organicSearchRevenue: 0, connected: false };
  }

  try {
    const accessToken = await getAccessToken();
    const [year, mon] = month.split('-');
    const lastDay     = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
    const startDate   = `${year}-${mon}-01`;
    // Cap end date to today — GA4 cannot convert AUD→USD for future dates
    const now         = new Date();
    const isCurrentMonth =
      parseInt(year!) === now.getFullYear() && parseInt(mon!) === now.getMonth() + 1;
    const endDayNum   = isCurrentMonth ? Math.min(lastDay, now.getDate()) : lastDay;
    const endDate     = `${year}-${mon}-${String(endDayNum).padStart(2, '0')}`;

    const res = await fetch(`${GA4_ETZ_BASE}:runReport`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionMedium' }],
        metrics:    [{ name: 'totalRevenue' }],
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ETZ GA4 API error (${res.status}): ${err.slice(0, 500)}`);
    }
    const data = await res.json();

    let paidSearchRevenue    = 0;
    let organicSearchRevenue = 0;

    for (const row of data.rows ?? []) {
      const medium = (row.dimensionValues?.[0]?.value ?? '').toLowerCase() as string;
      const rev    = parseFloat(row.metricValues?.[0]?.value ?? '0');
      if (medium === 'cpc')     paidSearchRevenue    += rev;
      if (medium === 'organic') organicSearchRevenue += rev;
    }

    return {
      paidSearchRevenue:    Math.round(paidSearchRevenue    * 100) / 100,
      organicSearchRevenue: Math.round(organicSearchRevenue * 100) / 100,
      connected: true,
    };
  } catch (err) {
    console.error('[google-analytics fetchETZGA4Revenue]', err);
    return { paidSearchRevenue: 0, organicSearchRevenue: 0, connected: false };
  }
}

export async function fetchETZGA4RevenueHistory(
  startDate: string,
  endDate:   string,
): Promise<GA4MonthlyRevenue[]> {
  if (!isETZConnected()) return [];

  try {
    const accessToken = await getAccessToken();

    const res = await fetch(`${GA4_ETZ_BASE}:runReport`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'yearMonth' },
          { name: 'sessionMedium' },
        ],
        metrics: [{ name: 'totalRevenue' }],
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ETZ GA4 history API error (${res.status}): ${err.slice(0, 500)}`);
    }
    const data = await res.json();

    const byMonth: Record<string, { paid: number; organic: number }> = {};

    for (const row of data.rows ?? []) {
      const yearMonth = (row.dimensionValues?.[0]?.value ?? '') as string;
      const medium    = (row.dimensionValues?.[1]?.value ?? '').toLowerCase() as string;
      const rev       = parseFloat(row.metricValues?.[0]?.value ?? '0');

      if (yearMonth.length !== 6) continue;
      const ym = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`;

      if (!byMonth[ym]) byMonth[ym] = { paid: 0, organic: 0 };
      if (medium === 'cpc')     byMonth[ym]!.paid    += rev;
      if (medium === 'organic') byMonth[ym]!.organic += rev;
    }

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { paid, organic }]) => ({
        month,
        pp:  { paid: 0, organic: 0 }, // ETZ history — pp field unused
        etz: {
          paid:    Math.round(paid    * 100) / 100,
          organic: Math.round(organic * 100) / 100,
        },
      }));
  } catch (err) {
    console.error('[google-analytics fetchETZGA4RevenueHistory]', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Paid Google Ads campaign revenue (sessionMedium = cpc)
// ---------------------------------------------------------------------------

export interface PaidCampaignRevenueData {
  byCampaign: CampaignRevenue[];
  totalRevenue: number;
  totalTx: number;
  connected: boolean;
  property: 'pp' | 'etz';
}

async function runReportOnProperty(
  accessToken: string,
  propertyBase: string,
  body: object,
): Promise<any> {
  const res = await fetch(`${propertyBase}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error (${res.status}): ${err.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * GA4 revenue attributed to paid Google Ads sessions, broken down by
 * sessionCampaignName (auto-tagged campaign names from Google Ads).
 *
 * Revenue is purchase revenue (totalRevenue), NOT Google Ads conversion value.
 */
export async function fetchPaidCampaignRevenue(
  startDate: string,
  endDate: string,
  property: 'pp' | 'etz' = 'pp',
): Promise<PaidCampaignRevenueData> {
  const empty: PaidCampaignRevenueData = {
    byCampaign: [],
    totalRevenue: 0,
    totalTx: 0,
    connected: false,
    property,
  };

  if (property === 'pp' && !isConnected()) return empty;
  if (property === 'etz' && !isETZConnected()) return empty;

  try {
    const accessToken = await getAccessToken();
    const base = property === 'etz' ? GA4_ETZ_BASE : GA4_BASE;

    const campaignData = await runReportOnProperty(accessToken, base, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: [{ name: 'totalRevenue' }, { name: 'transactions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'cpc' },
        },
      },
      orderBys: [{ metric: { metricName: 'totalRevenue' }, desc: true }],
      limit: 200,
    });

    const byCampaign: CampaignRevenue[] = (campaignData.rows ?? []).map((row: any) => ({
      campaignName: row.dimensionValues?.[0]?.value ?? '',
      revenue: parseFloat(row.metricValues?.[0]?.value ?? '0'),
      transactions: parseInt(row.metricValues?.[1]?.value ?? '0', 10),
    })).filter((c: CampaignRevenue) => c.campaignName && c.campaignName !== '(not set)' && c.campaignName !== '(direct)');

    const totalRevenue = byCampaign.reduce((s, c) => s + c.revenue, 0);
    const totalTx = byCampaign.reduce((s, c) => s + c.transactions, 0);

    return {
      byCampaign: byCampaign.map(c => ({
        ...c,
        revenue: Math.round(c.revenue * 100) / 100,
      })),
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalTx,
      connected: true,
      property,
    };
  } catch (err) {
    console.error(`[google-analytics fetchPaidCampaignRevenue ${property}]`, err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Website conversion rate — site-wide, not Ads
//   PP: BigCommerce orders ÷ GA storefront visits (closest BC-style proxy)
//   ETZ: GA4 purchases ÷ sessions
// ---------------------------------------------------------------------------

export interface WebsiteConversionSlice {
  /** Visits / sessions (denominator) */
  sessions: number;
  /** Orders / purchases (numerator) */
  purchases: number;
  /** purchases / sessions * 100 */
  conversionRate: number;
  startDate: string;
  endDate: string;
  /** How the denominator was chosen (PP hybrid only) */
  visitsMetric?: string;
}

export interface WebsiteConversionData {
  connected: boolean;
  /** ga4 = pure GA; bigcommerce_hybrid = BC orders + GA visits proxy */
  source: 'ga4' | 'bigcommerce_hybrid';
  current: WebsiteConversionSlice | null;
  /** Comparison window of equal length (prior period) */
  previous: WebsiteConversionSlice | null;
  /** Absolute pp change: current.rate - previous.rate */
  deltaPp: number | null;
  /** up | down | flat */
  direction: 'up' | 'down' | 'flat' | null;
  /** Short plain-English driver for the change */
  reason: string | null;
  /** Optional traffic metric candidates (PP hybrid, for calibration) */
  visitsDebug?: Record<string, number>;
}

function emptyConversion(source: 'ga4' | 'bigcommerce_hybrid' = 'ga4'): WebsiteConversionData {
  return {
    connected: false,
    source,
    current: null,
    previous: null,
    deltaPp: null,
    direction: null,
    reason: null,
  };
}

function sydneyTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Parse YYYY-MM-DD as UTC midnight (date-only math). */
function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function utcToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = ymdToUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToYmd(d);
}

function daysInclusive(startDate: string, endDate: string): number {
  const a = ymdToUtc(startDate).getTime();
  const b = ymdToUtc(endDate).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * Prior comparison window for a selected range.
 * - Default: equal-length period immediately before (Today→Yesterday, Last 7→prev 7).
 * - alignMonth: same calendar days in previous month (MTD / full month / Finance).
 */
export function conversionCompareWindows(
  startDate: string,
  endDate: string,
  mode: 'priorEqual' | 'alignMonth' = 'priorEqual',
): { curStart: string; curEnd: string; prevStart: string; prevEnd: string } {
  if (mode === 'alignMonth') {
    const [year, mon] = startDate.slice(0, 7).split('-').map(Number);
    const endDay = parseInt(endDate.slice(8, 10), 10);
    const prevY = mon === 1 ? year! - 1 : year!;
    const prevM = mon === 1 ? 12 : mon! - 1;
    const prevLast = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
    const prevEndDay = Math.min(endDay, prevLast);
    return {
      curStart: startDate,
      curEnd: endDate,
      prevStart: `${prevY}-${String(prevM).padStart(2, '0')}-01`,
      prevEnd: `${prevY}-${String(prevM).padStart(2, '0')}-${String(prevEndDay).padStart(2, '0')}`,
    };
  }

  const n = daysInclusive(startDate, endDate);
  const prevEnd = addDaysYmd(startDate, -1);
  const prevStart = addDaysYmd(prevEnd, -(n - 1));
  return { curStart: startDate, curEnd: endDate, prevStart, prevEnd };
}

/** Month window capped to today (Sydney); previous = same calendar days last month. */
function conversionDateWindowsFromMonth(month: string): {
  curStart: string; curEnd: string;
  prevStart: string; prevEnd: string;
} {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const curStart = `${year}-${String(mon).padStart(2, '0')}-01`;

  const today = sydneyTodayYmd();
  const isCurrentMonth = today.startsWith(month);
  const todayDay = parseInt(today.slice(8, 10), 10);
  const endDay = isCurrentMonth ? Math.min(lastDay, todayDay) : lastDay;
  const curEnd = `${year}-${String(mon).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  return conversionCompareWindows(curStart, curEnd, 'alignMonth');
}

function rateFrom(orders: number, visits: number): number {
  return visits > 0 ? Math.round((orders / visits) * 10000) / 100 : 0;
}

function makeSlice(
  visits: number,
  orders: number,
  startDate: string,
  endDate: string,
  visitsMetric?: string,
): WebsiteConversionSlice {
  return {
    sessions: visits,
    purchases: orders,
    conversionRate: rateFrom(orders, visits),
    startDate,
    endDate,
    visitsMetric,
  };
}

/** Pure GA: sessions + ecommercePurchases (ETZ path). */
async function fetchSessionsPurchases(
  accessToken: string,
  propertyBase: string,
  startDate: string,
  endDate: string,
): Promise<WebsiteConversionSlice> {
  const data = await runReportOnProperty(accessToken, propertyBase, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'sessions' },
      { name: 'ecommercePurchases' },
      { name: 'transactions' },
    ],
  });

  const row = data.rows?.[0];
  const sessions = Math.round(parseFloat(row?.metricValues?.[0]?.value ?? '0'));
  const purchasesRaw = parseFloat(row?.metricValues?.[1]?.value ?? '0');
  const transactions = parseFloat(row?.metricValues?.[2]?.value ?? '0');
  const purchases = Math.round(purchasesRaw > 0 ? purchasesRaw : transactions);
  return makeSlice(sessions, purchases, startDate, endDate, 'ga_sessions');
}

/**
 * GA storefront traffic proxy for BigCommerce-style visits.
 * Prefers host-filtered sessions on pascalpress.com.au (closest to BC storefront visits),
 * then engagedSessions, then totalUsers, then raw sessions.
 */
async function fetchPPVisitsProxy(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<{ visits: number; metric: string; debug: Record<string, number> }> {
  const hostFilter = {
    filter: {
      fieldName: 'hostName',
      stringFilter: {
        matchType: 'CONTAINS' as const,
        value: 'pascalpress',
        caseSensitive: false,
      },
    },
  };

  const [all, host] = await Promise.all([
    runReportOnProperty(accessToken, GA4_BASE, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
      ],
    }),
    runReportOnProperty(accessToken, GA4_BASE, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
      ],
      dimensionFilter: hostFilter,
    }),
  ]);

  const allRow = all.rows?.[0];
  const hostRow = host.rows?.[0];
  const sessions = Math.round(parseFloat(allRow?.metricValues?.[0]?.value ?? '0'));
  const totalUsers = Math.round(parseFloat(allRow?.metricValues?.[1]?.value ?? '0'));
  const engagedSessions = Math.round(parseFloat(allRow?.metricValues?.[2]?.value ?? '0'));
  const hostSessions = Math.round(parseFloat(hostRow?.metricValues?.[0]?.value ?? '0'));
  const hostUsers = Math.round(parseFloat(hostRow?.metricValues?.[1]?.value ?? '0'));
  const hostEngaged = Math.round(parseFloat(hostRow?.metricValues?.[2]?.value ?? '0'));

  const debug = { sessions, totalUsers, engagedSessions, hostSessions, hostUsers, hostEngaged };

  // Prefer metrics that land closest to BC Store Performance "visits"
  // (BC filters bots / uses its own visit definition — usually lower than raw GA sessions).
  if (hostEngaged > 0) {
    return { visits: hostEngaged, metric: 'ga_host_engaged(pascalpress)', debug };
  }
  if (hostUsers > 0) {
    return { visits: hostUsers, metric: 'ga_host_users(pascalpress)', debug };
  }
  if (engagedSessions > 0) {
    return { visits: engagedSessions, metric: 'ga_engaged_sessions', debug };
  }
  if (hostSessions > 0) {
    return { visits: hostSessions, metric: 'ga_host_sessions(pascalpress)', debug };
  }
  if (totalUsers > 0) {
    return { visits: totalUsers, metric: 'ga_total_users', debug };
  }
  return { visits: sessions, metric: 'ga_sessions', debug };
}

function buildConversionReason(
  current: WebsiteConversionSlice,
  previous: WebsiteConversionSlice,
  deltaPp: number,
  labels: { traffic: string; sales: string } = { traffic: 'sessions', sales: 'purchases' },
): { direction: 'up' | 'down' | 'flat'; reason: string } {
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(deltaPp) < 0.05 ? 'flat' : deltaPp > 0 ? 'up' : 'down';

  const sessPct = previous.sessions > 0
    ? ((current.sessions - previous.sessions) / previous.sessions) * 100
    : 0;
  const purchPct = previous.purchases > 0
    ? ((current.purchases - previous.purchases) / previous.purchases) * 100
    : (current.purchases > 0 ? 100 : 0);

  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;
  const t = labels.traffic;
  const s = labels.sales;

  if (direction === 'flat') {
    return {
      direction,
      reason: `Stable vs prior period (${t} ${fmt(sessPct)}, ${s} ${fmt(purchPct)}).`,
    };
  }

  if (direction === 'down') {
    if (sessPct > 10 && purchPct < sessPct - 5) {
      return {
        direction,
        reason: `Traffic up ${fmt(sessPct)} but ${s} only ${fmt(purchPct)} — more visits not converting (traffic quality or checkout friction).`,
      };
    }
    if (purchPct < -10 && Math.abs(sessPct) < 10) {
      return {
        direction,
        reason: `${s[0]!.toUpperCase()}${s.slice(1)} down ${fmt(purchPct)} on similar traffic (${fmt(sessPct)}) — likely offer, stock, or checkout issue.`,
      };
    }
    if (sessPct < -10 && purchPct <= sessPct) {
      return {
        direction,
        reason: `Both traffic (${fmt(sessPct)}) and ${s} (${fmt(purchPct)}) fell — lower demand, not just conversion.`,
      };
    }
    return {
      direction,
      reason: `CR down ${Math.abs(deltaPp).toFixed(2)}pp — ${t} ${fmt(sessPct)}, ${s} ${fmt(purchPct)}.`,
    };
  }

  // up
  if (purchPct > sessPct + 5) {
    return {
      direction,
      reason: `${s[0]!.toUpperCase()}${s.slice(1)} growing faster (${fmt(purchPct)}) than ${t} (${fmt(sessPct)}) — stronger conversion quality.`,
    };
  }
  if (sessPct < -5 && purchPct > sessPct) {
    return {
      direction,
      reason: `Traffic down ${fmt(sessPct)} but ${s} held better (${fmt(purchPct)}) — higher intent visitors.`,
    };
  }
  return {
    direction,
    reason: `CR up ${deltaPp.toFixed(2)}pp — ${t} ${fmt(sessPct)}, ${s} ${fmt(purchPct)}.`,
  };
}

export type ConversionCompareMode = 'priorEqual' | 'alignMonth';

async function fetchWebsiteConversionForProperty(
  propertyBase: string,
  connected: boolean,
  startDate: string,
  endDate: string,
  compareMode: ConversionCompareMode = 'priorEqual',
): Promise<WebsiteConversionData> {
  if (!connected) return emptyConversion('ga4');

  try {
    const accessToken = await getAccessToken();
    const { curStart, curEnd, prevStart, prevEnd } = conversionCompareWindows(
      startDate,
      endDate,
      compareMode,
    );

    const [current, previous] = await Promise.all([
      fetchSessionsPurchases(accessToken, propertyBase, curStart, curEnd),
      fetchSessionsPurchases(accessToken, propertyBase, prevStart, prevEnd),
    ]);

    const deltaPp = Math.round((current.conversionRate - previous.conversionRate) * 100) / 100;
    const { direction, reason } = buildConversionReason(current, previous, deltaPp);

    return {
      connected: true,
      source: 'ga4',
      current,
      previous,
      deltaPp,
      direction,
      reason,
    };
  } catch (err) {
    console.error('[google-analytics fetchWebsiteConversion]', err);
    return emptyConversion('ga4');
  }
}

/**
 * Pascal Press — BigCommerce-style conversion:
 *   orders from BigCommerce API ÷ storefront visits (GA host-filtered sessions).
 * BC control panel visits are not exposed via public API; host-filtered GA is the closest proxy.
 */
async function fetchPPHybridConversion(
  startDate: string,
  endDate: string,
  compareMode: ConversionCompareMode,
): Promise<WebsiteConversionData> {
  const bcConnected = !!(process.env.BIGCOMMERCE_STORE_HASH && process.env.BIGCOMMERCE_ACCESS_TOKEN);
  const gaConnected = isConnected();
  if (!bcConnected && !gaConnected) return emptyConversion('bigcommerce_hybrid');

  try {
    const { curStart, curEnd, prevStart, prevEnd } = conversionCompareWindows(
      startDate, endDate, compareMode,
    );
    const curMonth = curStart.slice(0, 7);
    const prevMonth = prevStart.slice(0, 7);

    const accessToken = gaConnected ? await getAccessToken() : null;

    const [bcCur, bcPrev, visitsCur, visitsPrev] = await Promise.all([
      fetchPPRevenue(curMonth, { start: curStart, end: curEnd }),
      fetchPPRevenue(prevMonth, { start: prevStart, end: prevEnd }),
      accessToken
        ? fetchPPVisitsProxy(accessToken, curStart, curEnd)
        : Promise.resolve({ visits: 0, metric: 'none', debug: {} as Record<string, number> }),
      accessToken
        ? fetchPPVisitsProxy(accessToken, prevStart, prevEnd)
        : Promise.resolve({ visits: 0, metric: 'none', debug: {} as Record<string, number> }),
    ]);

    if (!bcCur.connected && visitsCur.visits === 0) {
      return emptyConversion('bigcommerce_hybrid');
    }

    const current = makeSlice(
      visitsCur.visits,
      bcCur.totalOrders,
      curStart,
      curEnd,
      visitsCur.metric,
    );
    const previous = makeSlice(
      visitsPrev.visits,
      bcPrev.totalOrders,
      prevStart,
      prevEnd,
      visitsPrev.metric,
    );

    const deltaPp = Math.round((current.conversionRate - previous.conversionRate) * 100) / 100;
    const { direction, reason } = buildConversionReason(
      current,
      previous,
      deltaPp,
      { traffic: 'visits', sales: 'orders' },
    );

    // Attach debug on reason only in logs
    console.log('[pp hybrid conversion]', {
      current: { ...current, debug: visitsCur.debug },
      previous: { ...previous, debug: visitsPrev.debug },
    });

    return {
      connected: true,
      source: 'bigcommerce_hybrid',
      current,
      previous,
      deltaPp,
      direction,
      reason,
      visitsDebug: visitsCur.debug,
    };
  } catch (err) {
    console.error('[google-analytics fetchPPHybridConversion]', err);
    return emptyConversion('bigcommerce_hybrid');
  }
}

/**
 * Pascal Press storefront conversion (BC-style hybrid).
 * Pass startDate/endDate for a range, or month (YYYY-MM) for Finance/MTD-style windows.
 */
export async function fetchPPWebsiteConversion(
  startOrMonth: string,
  endDate?: string,
  compareMode?: ConversionCompareMode,
): Promise<WebsiteConversionData> {
  if (endDate) {
    return fetchPPHybridConversion(startOrMonth, endDate, compareMode ?? 'priorEqual');
  }
  const w = conversionDateWindowsFromMonth(startOrMonth);
  return fetchPPHybridConversion(w.curStart, w.curEnd, compareMode ?? 'alignMonth');
}

/** Excel Test Zone storefront conversion (pure GA4). */
export async function fetchETZWebsiteConversion(
  startOrMonth: string,
  endDate?: string,
  compareMode?: ConversionCompareMode,
): Promise<WebsiteConversionData> {
  if (endDate) {
    return fetchWebsiteConversionForProperty(
      GA4_ETZ_BASE, isETZConnected(), startOrMonth, endDate, compareMode ?? 'priorEqual',
    );
  }
  const w = conversionDateWindowsFromMonth(startOrMonth);
  return fetchWebsiteConversionForProperty(
    GA4_ETZ_BASE, isETZConnected(), w.curStart, w.curEnd, compareMode ?? 'alignMonth',
  );
}

// ---------------------------------------------------------------------------
// Match helper (used client-side in EmailTab)
// ---------------------------------------------------------------------------

/** Normalise a name for fuzzy matching: lowercase, punctuation → underscore */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/** Look up a HubSpot email name in a GA4 campaign revenue map */
export function matchRevenue(
  emailName:  string,
  byCampaign: CampaignRevenue[],
): CampaignRevenue | null {
  const target = normName(emailName);
  const exact  = byCampaign.find(c => normName(c.campaignName) === target);
  if (exact) return exact;
  const partial = byCampaign.find(c => {
    const n = normName(c.campaignName);
    return n.includes(target) || target.includes(n);
  });
  return partial ?? null;
}
