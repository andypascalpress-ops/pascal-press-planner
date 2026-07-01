/**
 * Google Analytics 4 Data API client
 * Property: 153293282 (Pascal Press BigCommerce store)
 *
 * Required env vars:
 *   GOOGLE_ADS_CLIENT_ID            — OAuth2 client ID (shared with Google Ads)
 *   GOOGLE_ADS_CLIENT_SECRET        — OAuth2 client secret (shared with Google Ads)
 *   GOOGLE_ANALYTICS_REFRESH_TOKEN  — refresh token with analytics.readonly scope
 *                                     (run scripts/get-ga4-refresh-token.mjs to generate)
 *
 * Channel attribution uses GA4's sessionDefaultChannelGroup:
 *   "Paid Search"    → Google Ads clicks
 *   "Organic Search" → organic Google / other search engines
 */

const GA4_PROPERTY_ID = '153293282'; // Pascal Press
const GA4_BASE        = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}`;
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function getAccessToken(): Promise<string> {
  // Use dedicated GA4 OAuth client if available; fall back to Google Ads client
  const clientId     = process.env.GOOGLE_ANALYTICS_CLIENT_ID
                    ?? process.env.GOOGLE_ADS_CLIENT_ID
                    ?? '';
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET
                    ?? process.env.GOOGLE_ADS_CLIENT_SECRET
                    ?? '';
  // Prefer a dedicated analytics token; fall back to the Google Ads token which
  // may already carry analytics.readonly scope if broad access was granted.
  const refreshToken = process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN
                    ?? process.env.GOOGLE_ADS_REFRESH_TOKEN
                    ?? '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing env vars for GA4: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and either GOOGLE_ANALYTICS_REFRESH_TOKEN or GOOGLE_ADS_REFRESH_TOKEN'
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
    throw new Error(`GA4 OAuth failed: ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

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
    throw new Error(`GA4 API error (${res.status}): ${err.slice(0, 400)}`);
  }
  return res.json();
}

/**
 * Fetch PP revenue by channel (Paid Search vs Organic Search) for a single month.
 * Returns { paidSearchRevenue, organicSearchRevenue, connected }.
 */
export async function fetchGA4Revenue(month: string): Promise<GA4ChannelRevenue> {
  if (!process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN && !process.env.GOOGLE_ADS_REFRESH_TOKEN) {
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
 * Designed for the FY26 Jan–Jun history chart.
 */
export async function fetchGA4RevenueHistory(
  startDate: string, // 'YYYY-MM-DD'
  endDate:   string, // 'YYYY-MM-DD'
): Promise<GA4MonthlyRevenue[]> {
  if (!process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN && !process.env.GOOGLE_ADS_REFRESH_TOKEN) {
    return [];
  }

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
      if (channel === 'Paid Search')    byMonth[ym].paid    += rev;
      if (channel === 'Organic Search') byMonth[ym].organic += rev;
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
