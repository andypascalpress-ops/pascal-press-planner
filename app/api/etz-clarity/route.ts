/**
 * GET /api/etz-clarity
 *
 * Fetches behavioral metrics from Microsoft Clarity for the ETZ project.
 *
 * Returns:
 *   overall   – aggregated metrics for the past 30 days
 *   bySource  – same metrics broken down by traffic source
 *
 * Required env var: CLARITY_API_TOKEN
 *   Generate at: clarity.microsoft.com → Settings → API
 *
 * Project ID: qmef32brd0 (from ETZ Clarity dashboard URL)
 * Optionally override with CLARITY_ETZ_PROJECT_ID env var.
 *
 * Cached for 1 hour — Clarity data updates daily.
 */
import { NextResponse } from 'next/server';

export const revalidate = 3600;

// Try the documented Clarity Data API endpoint.
// If this URL is wrong, check Vercel function logs for "Clarity fetch error:".
const CLARITY_BASE = 'https://api.clarity.ms/v1';
const PROJECT_ID   = process.env.CLARITY_ETZ_PROJECT_ID ?? 'qmef32brd0';

function clarityHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLARITY_API_TOKEN ?? ''}`,
    'Content-Type': 'application/json',
  };
}

/** Returns YYYY-MM-DD for N days ago */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface ClarityMetricRow {
  dimensionValue:        string;
  sessions:              number;
  bounceRate:            number;  // 0-100
  activeTime:            number;  // seconds
  deadClickRate:         number;  // 0-100
  rageClickRate:         number;  // 0-100
  excessiveScrollRate:   number;  // 0-100
  scrollDepth:           number;  // 0-100
}

export interface EtzClarityResponse {
  connected:  boolean;
  dateRange:  { start: string; end: string };
  overall:    ClarityMetricRow | null;
  bySource:   ClarityMetricRow[];
  error?:     string;
}

function normRow(raw: Record<string, unknown>, label?: string): ClarityMetricRow {
  const num = (k: string) => {
    const v = raw[k];
    return typeof v === 'number' ? v : parseFloat(String(v ?? '0')) || 0;
  };
  return {
    dimensionValue:      label ?? String(raw['dimensionValue'] ?? raw['name'] ?? ''),
    sessions:            num('sessions'),
    bounceRate:          num('bounceRate')          * (num('bounceRate') > 1 ? 1 : 100),
    activeTime:          num('activeTime'),
    deadClickRate:       num('deadClickRate')       * (num('deadClickRate') > 1 ? 1 : 100),
    rageClickRate:       num('rageClickRate')       * (num('rageClickRate') > 1 ? 1 : 100),
    excessiveScrollRate: num('excessiveScrollingRate') * (num('excessiveScrollingRate') > 1 ? 1 : 100),
    scrollDepth:         num('scrollDepth')         * (num('scrollDepth') > 1 ? 1 : 100),
  };
}

async function fetchClarity(params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${CLARITY_BASE}/projects/${PROJECT_ID}/metrics?${qs}`;
  console.log('[etz-clarity] fetching:', url);
  let res: Response;
  try {
    res = await fetch(url, { headers: clarityHeaders(), cache: 'no-store' });
  } catch (netErr) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    throw new Error(`Network error reaching ${url} — ${msg}. Check that CLARITY_API_TOKEN is correct and api.clarity.ms is reachable.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Clarity API ${res.status} from ${url}: ${body.slice(0, 300)}`);
  }
  const json = await res.json() as Record<string, unknown>;
  // Clarity wraps results in { data: [...] } or returns an array directly
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (Array.isArray(json['data'])) return json['data'] as Record<string, unknown>[];
  if (Array.isArray(json['results'])) return json['results'] as Record<string, unknown>[];
  return [json];
}

export async function GET() {
  if (!process.env.CLARITY_API_TOKEN) {
    return NextResponse.json({
      connected: false,
      dateRange: { start: '', end: '' },
      overall:   null,
      bySource:  [],
      error:     'CLARITY_API_TOKEN not configured. Generate one at clarity.microsoft.com → Settings → API.',
    } satisfies EtzClarityResponse);
  }

  const endDate   = daysAgo(1);   // yesterday (Clarity lags ~1 day)
  const startDate = daysAgo(30);  // last 30 days

  try {
    // 1. Overall metrics (no dimension = aggregate)
    const overallRows = await fetchClarity({ startDate, endDate });
    const overall = overallRows.length > 0 ? normRow(overallRows[0]!, 'All') : null;

    // 2. By source dimension
    const sourceRows = await fetchClarity({ startDate, endDate, dimensionType: 'Source' });
    const bySource = sourceRows
      .map(r => normRow(r))
      .filter(r => r.dimensionValue && r.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);

    return NextResponse.json({
      connected: true,
      dateRange: { start: startDate, end: endDate },
      overall,
      bySource,
    } satisfies EtzClarityResponse);

  } catch (e) {
    console.error('[etz-clarity]', e);
    return NextResponse.json({
      connected: false,
      dateRange: { start: startDate, end: endDate },
      overall:   null,
      bySource:  [],
      error:     e instanceof Error ? e.message : 'Unknown error',
    } satisfies EtzClarityResponse);
  }
}
