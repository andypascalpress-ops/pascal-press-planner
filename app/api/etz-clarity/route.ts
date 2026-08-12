/**
 * GET /api/etz-clarity
 *
 * Fetches behavioral metrics from Microsoft Clarity for the ETZ project.
 *
 * Uses the official Clarity Data Export API:
 *   GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 *
 * Docs: learn.microsoft.com/en-us/clarity/clarity-data-export-api
 *
 * Limitations (as of 2024):
 *   - Data window: last 1, 2, or 3 days only (not longer)
 *   - Rate limit:  10 requests per project per day
 *   - Row limit:   1,000 rows per response
 *
 * Required env var: CLARITY_API_TOKEN
 *   Generate at: Clarity → Settings → Data Export → Generate new API token
 *   (project admin only)
 *
 * NOTE: The project is determined by the API token — no project ID in the URL.
 */
import { NextResponse } from 'next/server';

// Cache for 6 hours — Clarity allows only 10 API calls/project/day.
// 24h / 6h = 4 calls/day max, safely under the limit.
export const revalidate = 21600;

const CLARITY_BASE = 'https://www.clarity.ms/export-data/api/v1';

function clarityHeaders() {
  return {
    Authorization:    `Bearer ${process.env.CLARITY_API_TOKEN ?? ''}`,
    'Content-Type':   'application/json',
    Accept:           'application/json',
    'User-Agent':     'Mozilla/5.0 (compatible; PascalPressPlanner/1.0)',
  };
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** One row of the by-source breakdown shown in the dashboard card */
export interface ClarityMetricRow {
  dimensionValue:      string;
  sessions:            number;
  bounceRate:          number;  // 0–100
  activeTime:          number;  // seconds (engagement time)
  deadClickRate:       number;  // 0–100
  rageClickRate:       number;  // 0–100
  excessiveScrollRate: number;  // 0–100
  scrollDepth:         number;  // 0–100
}

export interface EtzClarityResponse {
  connected:  boolean;
  dateRange:  { numOfDays: number };
  overall:    ClarityMetricRow | null;
  bySource:   ClarityMetricRow[];
  error?:     string;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/** One metric group returned by the export API */
interface MetricGroup {
  metricName:  string;
  information: Record<string, unknown>[];
}

const num = (obj: Record<string, unknown>, k: string): number => {
  const v = obj[k];
  return typeof v === 'number' ? v : parseFloat(String(v ?? '0')) || 0;
};
const pct = (obj: Record<string, unknown>, k: string): number => {
  const v = num(obj, k);
  // Clarity returns rates as 0–1 fractions OR 0–100 depending on field/version
  return v <= 1 ? v * 100 : v;
};

/**
 * Merge information rows across metric groups, keyed by the dimension value.
 * Each metric group has one dimension-value key per row (e.g. "Source": "Organic Search").
 *
 * This accumulates all fields from every metric group into one merged object per source.
 */
function buildPerSourceMap(
  groups:    MetricGroup[],
  dimension: string,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();

  for (const group of groups) {
    for (const info of group.information) {
      const dimVal = String(info[dimension] ?? info['dimensionValue'] ?? 'Unknown');
      const existing = map.get(dimVal) ?? {};
      map.set(dimVal, { ...existing, ...info });
    }
  }
  return map;
}

function rowFromMerged(merged: Record<string, unknown>, label: string): ClarityMetricRow {
  return {
    dimensionValue:      label,
    sessions:            num(merged, 'totalSessionCount'),
    bounceRate:          pct(merged, 'bounceRate'),
    // "Engagement Time" metric uses engagementTime (seconds)
    activeTime:          num(merged, 'engagementTime') || num(merged, 'activeTime'),
    deadClickRate:       pct(merged, 'deadClickRate'),
    rageClickRate:       pct(merged, 'rageClickRate'),
    excessiveScrollRate: pct(merged, 'excessiveScrollingRate') || pct(merged, 'excessiveScrollRate'),
    scrollDepth:         pct(merged, 'scrollDepth'),
  };
}

/** Aggregate all per-source rows into a single "All" overall row */
function aggregateOverall(rows: ClarityMetricRow[]): ClarityMetricRow | null {
  if (rows.length === 0) return null;
  const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
  if (totalSessions === 0) return null;
  const w = (field: keyof ClarityMetricRow) =>
    rows.reduce((s, r) => s + (r[field] as number) * r.sessions, 0) / totalSessions;
  return {
    dimensionValue:      'All',
    sessions:            totalSessions,
    bounceRate:          w('bounceRate'),
    activeTime:          w('activeTime'),
    deadClickRate:       w('deadClickRate'),
    rageClickRate:       w('rageClickRate'),
    excessiveScrollRate: w('excessiveScrollRate'),
    scrollDepth:         w('scrollDepth'),
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  if (!process.env.CLARITY_API_TOKEN) {
    return NextResponse.json({
      connected: false,
      dateRange: { numOfDays: 3 },
      overall:   null,
      bySource:  [],
      error:     'CLARITY_API_TOKEN not configured. Generate at Clarity → Settings → Data Export.',
    } satisfies EtzClarityResponse);
  }

  try {
    // numOfDays accepts only 1, 2, or 3 (last 24/48/72 hours).
    // Use 3 for the widest available window.
    const params = new URLSearchParams({
      numOfDays:  '3',
      dimension1: 'Source',
    });
    const url = `${CLARITY_BASE}/project-live-insights?${params}`;
    console.log('[etz-clarity] fetching:', url);

    const res = await fetch(url, {
      headers: clarityHeaders(),
      cache:   'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const msg  = `Clarity API ${res.status}: ${body.slice(0, 200)}`;
      console.error('[etz-clarity]', msg);
      return NextResponse.json({
        connected: false,
        dateRange: { numOfDays: 3 },
        overall:   null,
        bySource:  [],
        error:     msg,
      } satisfies EtzClarityResponse);
    }

    const data = await res.json() as unknown;
    console.log('[etz-clarity] raw response:', JSON.stringify(data).slice(0, 500));

    // Response: array of { metricName: string, information: [...] }
    const groups: MetricGroup[] = Array.isArray(data)
      ? (data as MetricGroup[])
      : [];

    const sourceMap = buildPerSourceMap(groups, 'Source');
    const bySource: ClarityMetricRow[] = Array.from(sourceMap.entries())
      .map(([label, merged]) => rowFromMerged(merged, label))
      .filter(r => r.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);

    const overall = aggregateOverall(bySource);

    console.log('[etz-clarity] parsed:', bySource.length, 'sources');

    return NextResponse.json({
      connected: true,
      dateRange: { numOfDays: 3 },
      overall,
      bySource,
    } satisfies EtzClarityResponse);

  } catch (e) {
    console.error('[etz-clarity]', e);
    return NextResponse.json({
      connected: false,
      dateRange: { numOfDays: 3 },
      overall:   null,
      bySource:  [],
      error:     e instanceof Error ? e.message : 'Unknown error',
    } satisfies EtzClarityResponse);
  }
}
