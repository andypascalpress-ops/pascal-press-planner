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
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow(res, 'Google OAuth');
  if (!data.access_token) {
    throw new Error(`Google OAuth failed (HTTP ${res.status}): ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

// ─── GAQL search ──────────────────────────────────────────────────────────────

interface GaqlRow {
  segments?: { month?: string; date?: string };
  campaign?: { name?: string; status?: string };
  adGroup?:  { name?: string; status?: string };
  metrics?: {
    costMicros?:       string;
    conversionsValue?: number;
    clicks?:           number;
    impressions?:      number;
    ctr?:              number;
    averageCpc?:       string;
    conversions?:      number;
  };
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
    cache: 'no-store',
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

  // Use segments.date (not segments.month) — some account types reject segments.month
  // on short date ranges. Aggregate by month manually in code instead.
  const query = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ${nameClause}
    ORDER BY segments.date
  `;

  const rows = await gaqlSearch(cfg, accessToken, query);

  // Aggregate by month
  const byMonth: Record<string, { spend: number; revenue: number }> = {};

  for (const row of rows) {
    // segments.date is returned as 'YYYY-MM-DD'
    const raw = row.segments?.date ?? '';
    const monthKey = raw.slice(5, 7); // '2026-07-07' → '07'
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

// ─── Campaign & ad-group performance ─────────────────────────────────────────

export interface CampaignPerf {
  name:         string;
  status:       string;
  clicks:       number;
  impressions:  number;
  ctr:          number; // 0–1
  avgCpc:       number; // AUD
  conversions:  number;
  convValue:    number; // AUD
  cost:         number; // AUD
  roas:         number; // convValue / cost
}

export interface AdGroupPerf {
  campaign:    string;
  adGroup:     string;
  clicks:      number;
  impressions: number;
  ctr:         number;
  conversions: number;
  convValue:   number;
  cost:        number;
}

/**
 * Fetch campaign-level performance for THIS_MONTH.
 * Optionally filter by campaign name (contains/excludes).
 */
export async function fetchCampaignPerformance(
  cfg: GoogleAdsConfig,
  campaignNameFilter?: { contains: string } | { excludes: string },
): Promise<CampaignPerf[]> {
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
      campaign.name,
      campaign.status,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date DURING THIS_MONTH
    AND campaign.status != 'REMOVED'
    ${nameClause}
    ORDER BY metrics.cost_micros DESC
    LIMIT 25
  `;

  const rows = await gaqlSearch(cfg, accessToken, query);
  return rows.map(r => {
    const cost = Number(r.metrics?.costMicros ?? 0) / 1_000_000;
    const conv = r.metrics?.conversionsValue ?? 0;
    return {
      name:        r.campaign?.name        ?? '',
      status:      r.campaign?.status      ?? '',
      clicks:      r.metrics?.clicks       ?? 0,
      impressions: r.metrics?.impressions  ?? 0,
      ctr:         r.metrics?.ctr          ?? 0,
      avgCpc:      Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
      conversions: r.metrics?.conversions  ?? 0,
      convValue:   Math.round(conv * 100) / 100,
      cost:        Math.round(cost * 100) / 100,
      roas:        cost > 0 ? Math.round((conv / cost) * 100) / 100 : 0,
    };
  });
}

/**
 * Fetch ad-group-level performance for THIS_MONTH.
 */
export async function fetchAdGroupPerformance(
  cfg: GoogleAdsConfig,
  campaignNameFilter?: { contains: string } | { excludes: string },
): Promise<AdGroupPerf[]> {
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
      campaign.name,
      ad_group.name,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_micros
    FROM ad_group
    WHERE segments.date DURING THIS_MONTH
    AND campaign.status != 'REMOVED'
    AND ad_group.status != 'REMOVED'
    ${nameClause}
    ORDER BY metrics.cost_micros DESC
    LIMIT 30
  `;

  const rows = await gaqlSearch(cfg, accessToken, query);
  return rows.map(r => ({
    campaign:    r.campaign?.name   ?? '',
    adGroup:     r.adGroup?.name    ?? '',
    clicks:      r.metrics?.clicks  ?? 0,
    impressions: r.metrics?.impressions ?? 0,
    ctr:         r.metrics?.ctr ?? 0,
    conversions: r.metrics?.conversions ?? 0,
    convValue:   Math.round((r.metrics?.conversionsValue ?? 0) * 100) / 100,
    cost:        Math.round((Number(r.metrics?.costMicros ?? 0) / 1_000_000) * 100) / 100,
  }));
}

// ─── Config builder ───────────────────────────────────────────────────────────

export function buildConfig(brand: 'pp' | 'etz' | 'hsc'): GoogleAdsConfig {
  // ETZ falls back to PP account when GOOGLE_ADS_ETZ_CUSTOMER_ID is not yet set
  // (while ETZ campaigns still live under the PP account, filtered by name)
  const customerId = brand === 'pp'
    ? process.env.GOOGLE_ADS_PP_CUSTOMER_ID
    : brand === 'hsc'
      ? process.env.GOOGLE_ADS_HSC_CUSTOMER_ID
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
      ? (brand === 'hsc' ? 'GOOGLE_ADS_HSC_CUSTOMER_ID' : 'GOOGLE_ADS_PP_CUSTOMER_ID')
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

/** Returns true when ET
Z has its own dedicated Google Ads sub-account */
export function etzHasOwnAccount(): boolean {
  return !!process.env.GOOGLE_ADS_ETZ_CUSTOMER_ID;
}
