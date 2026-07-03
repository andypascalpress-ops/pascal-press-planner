/**
 * Google Analytics 4 Data API client
 * Requires env vars:
 *   GOOGLE_ANALYTICS_PROPERTY_ID  — numeric property ID (e.g. "123456789"), NOT "G-XXXXXXXX"
 *   GA4_REFRESH_TOKEN             — OAuth refresh token with analytics.readonly scope
 *   GOOGLE_ADS_CLIENT_ID          — reused from Google Ads setup
 *   GOOGLE_ADS_CLIENT_SECRET      — reused from Google Ads setup
 */

const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID     ?? '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
      refresh_token: process.env.GA4_REFRESH_TOKEN        ?? '',
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 token error (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Run a GA4 report for email-attributed revenue.
 * startDate / endDate: GA4 date strings, e.g. "2023-01-01" or "today"
 */
export async function fetchEmailRevenue(
  startDate = '2022-01-01',
  endDate   = 'today',
): Promise<EmailRevenueData> {
  const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
  if (!propertyId || !process.env.GA4_REFRESH_TOKEN) {
    return { byCampaign: [], totalRevenue: 0, totalTx: 0, connected: false };
  }

  try {
    const token = await getAccessToken();

    // ── Per-campaign revenue (medium = email) ───────────────────────────────
    const campaignReport = await runReport(token, propertyId, {
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics:    [{ name: 'purchaseRevenue' }, { name: 'transactions' }],
      dateRanges: [{ startDate, endDate }],
      dimensionFilter: {
        filter: {
          fieldName:    'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'email' },
        },
      },
      limit: 500,
    });

    const byCampaign: CampaignRevenue[] = (campaignReport.rows ?? []).map(
      (row: GA4Row) => ({
        campaignName: row.dimensionValues[0]?.value ?? '',
        revenue:      parseFloat(row.metricValues[0]?.value ?? '0'),
        transactions: parseInt(row.metricValues[1]?.value  ?? '0', 10),
      }),
    );

    // ── Total email channel revenue ─────────────────────────────────────────
    const totalReport = await runReport(token, propertyId, {
      dimensions: [{ name: 'sessionMedium' }],
      metrics:    [{ name: 'purchaseRevenue' }, { name: 'transactions' }],
      dateRanges: [{ startDate, endDate }],
      dimensionFilter: {
        filter: {
          fieldName:    'sessionMedium',
          stringFilter: { matchType: 'EXACT', value: 'email' },
        },
      },
      limit: 1,
    });

    const totRow       = totalReport.rows?.[0];
    const totalRevenue = totRow ? parseFloat(totRow.metricValues[0]?.value ?? '0') : 0;
    const totalTx      = totRow ? parseInt(totRow.metricValues[1]?.value   ?? '0', 10) : 0;

    return { byCampaign, totalRevenue, totalTx, connected: true };
  } catch (err) {
    console.error('[google-analytics]', err);
    return { byCampaign: [], totalRevenue: 0, totalTx: 0, connected: false };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface GA4Row {
  dimensionValues: { value: string }[];
  metricValues:    { value: string }[];
}

interface ReportRequest {
  dimensions:       { name: string }[];
  metrics:          { name: string }[];
  dateRanges:       { startDate: string; endDate: string }[];
  dimensionFilter?: unknown;
  limit?:           number;
}

async function runReport(
  token:      string,
  propertyId: string,
  body:       ReportRequest,
): Promise<{ rows?: GA4Row[] }> {
  const res = await fetch(
    `${GA4_BASE}/properties/${propertyId}:runReport`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      next: { revalidate: 3600 }, // cache GA4 data for 1 hour
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 report error (${res.status}): ${err.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Match a HubSpot email name to a GA4 campaign name.
 * Normalises both to lowercase with spaces→underscores for comparison.
 */
export function matchRevenue(
  emailName:  string,
  byCampaign: CampaignRevenue[],
): CampaignRevenue | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '_');
  const target = norm(emailName);

  // 1. Exact match after normalisation
  const exact = byCampaign.find(c => norm(c.campaignName) === target);
  if (exact) return exact;

  // 2. Partial: GA4 name contains email name or vice versa
  const partial = byCampaign.find(c => {
    const n = norm(c.campaignName);
    return n.includes(target) || target.includes(n);
  });
  return partial ?? null;
}
