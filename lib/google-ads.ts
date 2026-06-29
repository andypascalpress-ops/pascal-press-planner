/**
 * Google Ads REST API client
 *
 * Required env vars:
 *   GOOGLE_ADS_DEVELOPER_TOKEN   — from your Google Ads account (Tools → API Centre)
 *   GOOGLE_ADS_CLIENT_ID         — OAuth2 client ID from Google Cloud Console
 *   GOOGLE_ADS_CLIENT_SECRET     — OAuth2 client secret
 *   GOOGLE_ADS_REFRESH_TOKEN     — long-lived refresh token (run scripts/get-google-refresh-token.mjs once)
 *   GOOGLE_ADS_PP_CUSTOMER_ID    — Pascal Press account ID, e.g. "123-456-7890"
 *   GOOGLE_ADS_ETZ_CUSTOMER_ID   — (optional) Excel Test Zone sub-account ID once separated into MCC
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — (optional) MCC / manager account ID if PP/ETZ are sub-accounts
 *
 * Until ETZ has its own sub-account, ETZ spend is pulled from the PP account
 * by filtering campaign names containing "ETZ". PP spend excludes those campaigns.
 */

const GOOGLE_ADS_API_VERSION = 'v24';
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const MONTH_NAMES: Record<string, string> = {
  '01': 'January', '02': 'February', '03': 'March',
  '04': 'April',   '05': 'May',      '06': 'June',
  '07': 'July',    '08': 'August',   '09': 'September',
  '10': 'October', '11': 'November', '12': 'December',
};

export interface MonthlySpend {
  month: string;          // "January", "February", …
  actualSpend: number;    // AUD, 2 dp
  attributedRevenue: number;
}

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;       // digits only, no dashes
  loginCustomerId?: string; // MCC account if applicable
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function parseJsonOrThrow(res: Response, context: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

async function getAccessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await parseJsonOrThrow(res, 'Google OAuth');
  if (!data.access_token) {
    throw new Error(`Google OAuth failed (HTTP ${res.status}): ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

// ─── GAQL search ──────────────────────────────────────────────────────────────

interface GaqlRow {
  segments?: { month?: string };
  metrics?:  { costMicros?: string; conversionsValue?: number };
}

async function gaqlSearch(
  cfg: GoogleAdsConfig,
  accessToken: string,
  query: string
): Promise<GaqlRow[]> {
  const headers: Record<string, string> = {
    Authorization:    `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
    'Content-Type':   'application/json',
  };
  if (cfg.loginCustomerId) {
    headers['login-customer-id'] = cfg.loginCustomerId;
  }

  const url = `${GOOGLE_ADS_BASE}/customers/${cfg.customerId}/googleAds:search`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  const data = await parseJsonOrThrow(res, `Google Ads API (${url})`);

  if (!res.ok) {
    const msg = data?.error?.message
      ?? data?.error?.details?.[0]?.errors?.[0]?.message
      ?? JSON.stringify(data);
    throw new Error(`Google Ads API error (HTTP ${res.status}): ${msg}`);
  }
  return (data.results ?? []) as GaqlRow[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch monthly spend + conversion value for a Google Ads account over a date range.
 * Results are aggregated across all campaigns for each calendar month.
 *
 * @param campaignNameFilter  Optional: { contains: 'ETZ' } to include only matching campaigns,
 *                            or { excludes: 'ETZ' } to exclude them.
 */
export async function fetchMonthlySpend(
  cfg: GoogleAdsConfig,
  startDate: string, // 'YYYY-MM-DD'
  endDate:   string, // 'YYYY-MM-DD'
  campaignNameFilter?: { contains: string } | { excludes: string }
): Promise<MonthlySpend[]> {
  const accessToken = await getAccessToken(cfg);

  let nameClause = '';
  if (campaignNameFilter) {
    if ('contains' in campaignNameFilter) {
      nameClause = `AND campaign.name LIKE '%${campaignNameFilter.contains}%'`;
    } else {
      nameClause = `AND campaign.name NOT LIKE '%${campaignNameFilter.excludes}%'`;
    }
  }

  const query = `
    SELECT
      segments.month,
      metrics.cost_micros,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ${nameClause}
    ORDER BY segments.month
  `;

  const rows = await gaqlSearch(cfg, accessToken, query);

  // Aggregate by month
  const byMonth: Record<string, { spend: number; revenue: number }> = {};

  for (const row of rows) {
    // segments.month is returned as 'YYYY-MM-DD' (first day of month)
    const raw = row.segments?.month ?? '';
    const monthKey = raw.slice(5, 7); // '2026-01-01' → '01'
    const monthName = MONTH_NAMES[monthKey];
    if (!monthName) continue;

    if (!byMonth[monthName]) byMonth[monthName] = { spend: 0, revenue: 0 };
    // cost_micros is a string in the REST API
    byMonth[monthName].spend   += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    byMonth[monthName].revenue += row.metrics?.conversionsValue ?? 0;
  }

  return Object.entries(byMonth).map(([month, { spend, revenue }]) => ({
    month,
    actualSpend:       Math.round(spend   * 100) / 100,
    attributedRevenue: Math.round(revenue * 100) / 100,
  }));
}

// ─── Config builder ───────────────────────────────────────────────────────────

export function buildConfig(brand: 'pp' | 'etz'): GoogleAdsConfig {
  // ETZ falls back to PP account when GOOGLE_ADS_ETZ_CUSTOMER_ID is not yet set
  // (while ETZ campaigns still live under the PP account, filtered by name)
  const customerId = brand === 'pp'
    ? process.env.GOOGLE_ADS_PP_CUSTOMER_ID
    : (process.env.GOOGLE_ADS_ETZ_CUSTOMER_ID || process.env.GOOGLE_ADS_PP_CUSTOMER_ID);

  const required = {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId:       process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret:   process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken:   process.env.GOOGLE_ADS_REFRESH_TOKEN,
    customerId,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k === 'customerId'
      ? 'GOOGLE_ADS_PP_CUSTOMER_ID'
      : `GOOGLE_ADS_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`
    );

  if (missing.length) {
    throw new Error(`Missing Google Ads env vars: ${missing.join(', ')}`);
  }

  return {
    developerToken:  required.developerToken!,
    clientId:        required.clientId!,
    clientSecret:    required.clientSecret!,
    refreshToken:    required.refreshToken!,
    customerId:      required.customerId!.replace(/-/g, ''),
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, ''),
  };
}

/** Returns true when ETZ has its own dedicated Google Ads sub-account */
export function etzHasOwnAccount(): boolean {
  return !!process.env.GOOGLE_ADS_ETZ_CUSTOMER_ID;
}
