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
 * Channel attribution uses GA4's sessionDefaultChannelGroup:
 *   "Paid Search"    → Google Ads clicks
 *   "Organic Search" → organic Google / other search engines
 */

import crypto from 'crypto';

const GA4_PROPERTY_ID = '354651290'; // Pascal Press (pascalpress.com.au)
const GA4_BASE        = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}`;
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

// ---------------------------------------------------------------------------
// GA4 report runner
// ---------------------------------------------------------------------------

async function runReport(accessToken: string, body: object): Promise<any> {
  const res = await fetch(`${GA4_BASE}:runReport`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
  /** Revenue attributed to Paid Search (Google Ads) sessions */
  paidSearchRevenue:    number;
  /** Revenue attributed to Organic Search sessions */
  organicSearchRevenue: number;
  connected: boolean;
}

export interface GA4MonthlyRevenue {
  month: string; // 'YYYY-MM'
  pp: {
    paid:    number; // Paid Search revenue
    organic: number; // Organic Search revenue
  };
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch PP revenue by channel (Paid Search vs Organic Search) for a single month.
 */
export async function fetchGA4Revenue(month: string): Promise<GA4ChannelRevenue> {
  const hasServiceAccount = !!process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON;
  const hasOAuth =
    !!(process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN ?? process.env.GOOGLE_ADS_REFRESH_TOKEN);

  if (!hasServiceAccount && !hasOAuth) {
    return { paidSearchRevenue: 0, organicSearchRevenue: 0, connected: false };
  }

  try {
    const accessToken = await getAccessToken();
    const [year, mon] = month.split('-');
    const lastDay     = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
    const startDate   = `${year}-${mon}-01`;
    const endDate     = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

    const data = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics:    [{ name: 'totalRevenue' }],
    });

    let paidSearchRevenue    = 0;
    let organicSearchRevenue = 0;

    for (const row of data.rows ?? []) {
      const channel = (row.dimensionValues?.[0]?.value ?? '') as string;
      const rev     = parseFloat(row.metricValues?.[0]?.value ?? '0');
      if (channel === 'Paid Search')    paidSearchRevenue    += rev;
      if (channel === 'Organic Search') organicSearchRevenue += rev;
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

/**
 * Fetch PP revenue by channel for a date range, aggregated by calendar month.
 */
export async function fetchGA4RevenueHistory(
  startDate: string, // 'YYYY-MM-DD'
  endDate:   string, // 'YYYY-MM-DD'
): Promise<GA4MonthlyRevenue[]> {
  const hasServiceAccount = !!process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON;
  const hasOAuth =
    !!(process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN ?? process.env.GOOGLE_ADS_REFRESH_TOKEN);

  if (!hasServiceAccount && !hasOAuth) return [];

  try {
    const accessToken = await getAccessToken();

    const data = await runReport(accessToken, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'yearMonth' },
        { name: 'sessionDefaultChannelGroup' },
      ],
      metrics: [{ name: 'totalRevenue' }],
    });

    const byMonth: Record<string, { paid: number; organic: number }> = {};

    for (const row of data.rows ?? []) {
      const yearMonth = (row.dimensionValues?.[0]?.value ?? '') as string; // "202601"
      const channel   = (row.dimensionValues?.[1]?.value ?? '') as string;
      const rev       = parseFloat(row.metricValues?.[0]?.value ?? '0');

      if (yearMonth.length !== 6) continue;
      const ym = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`; // "2026-01"

      if (!byMonth[ym]) byMonth[ym] = { paid: 0, organic: 0 };
      if (channel === 'Paid Search')    byMonth[ym]!.paid    += rev;
      if (channel === 'Organic Search') byMonth[ym]!.organic += rev;
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
