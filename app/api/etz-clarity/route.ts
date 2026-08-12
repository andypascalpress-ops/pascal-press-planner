/**
 * GET /api/etz-clarity
 *
 * Fetches behavioral metrics from Microsoft Clarity for the ETZ project.
 *
 * Tries two known Clarity API base URLs in order:
 *   1. https://api.clarity.ms/v1   (documented, but has TLS cert mismatch → needs undici)
 *   2. https://clarity.microsoft.com/api/v1  (dashboard domain, proper cert)
 *
 * Required env var: CLARITY_API_TOKEN
 *   Generate at: clarity.microsoft.com → Settings → API
 *
 * Project ID: qmef32brd0 (from ETZ Clarity dashboard URL)
 * Optionally override with CLARITY_ETZ_PROJECT_ID env var.
 */
import { NextResponse } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';

export const revalidate = 3600;

const PROJECT_ID = process.env.CLARITY_ETZ_PROJECT_ID ?? 'qmef32brd0';

/**
 * api.clarity.ms has an Azure CDN TLS cert mismatch (cert is *.azureedge.net).
 * Use undici Agent with rejectUnauthorized:false ONLY for this host.
 */
const clarityAgent = new Agent({ connect: { rejectUnauthorized: false } });

function clarityHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLARITY_API_TOKEN ?? ''}`,
    Accept: 'application/json',
  };
}

export interface ClarityMetricRow {
  dimensionValue:      string;
  sessions:            number;
  bounceRate:          number;  // 0-100
  activeTime:          number;  // seconds
  deadClickRate:       number;  // 0-100
  rageClickRate:       number;  // 0-100
  excessiveScrollRate: number;  // 0-100
  scrollDepth:         number;  // 0-100
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
  // Clarity returns rates as 0-1 fractions OR 0-100 percentages depending on version
  const pct = (k: string) => {
    const v = num(k);
    return v <= 1 ? v * 100 : v;
  };
  return {
    dimensionValue:      label ?? String(raw['dimensionValue'] ?? raw['name'] ?? ''),
    sessions:            num('sessions'),
    bounceRate:          pct('bounceRate'),
    activeTime:          num('activeTime'),
    deadClickRate:       pct('deadClickRate'),
    rageClickRate:       pct('rageClickRate'),
    excessiveScrollRate: pct('excessiveScrollingRate'),
    scrollDepth:         pct('scrollDepth'),
  };
}

/**
 * Try calling the Clarity API at each base URL in turn.
 * Returns on the first successful (2xx) response.
 */
async function fetchClarity(
  params: Record<string, string>,
): Promise<{ rows: Record<string, unknown>[]; baseUsed: string }> {
  const candidates = [
    { base: 'https://api.clarity.ms/v1',                 useClarityAgent: true  },
    { base: 'https://clarity.microsoft.com/api/v1',      useClarityAgent: false },
  ];

  const qs = new URLSearchParams(params).toString();
  const errors: string[] = [];

  for (const { base, useClarityAgent } of candidates) {
    const url = `${base}/projects/${PROJECT_ID}/metrics?${qs}`;
    console.log('[etz-clarity] trying:', url);

    let res: Response | Awaited<ReturnType<typeof undiciFetch>>;
    try {
      if (useClarityAgent) {
        res = await undiciFetch(url, {
          headers:    clarityHeaders(),
          dispatcher: clarityAgent,
        } as Parameters<typeof undiciFetch>[1]);
      } else {
        res = await fetch(url, { headers: clarityHeaders(), cache: 'no-store' });
      }
    } catch (netErr) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr);
      console.log('[etz-clarity] network error on', url, '—', msg);
      errors.push(`${base}: ${msg}`);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log('[etz-clarity] HTTP', res.status, 'from', url, body.slice(0, 100));
      errors.push(`${base}: HTTP ${res.status}`);
      continue;
    }

    const json = await res.json() as Record<string, unknown>;
    let rows: Record<string, unknown>[];
    if (Array.isArray(json))               rows = json as Record<string, unknown>[];
    else if (Array.isArray(json['data']))   rows = json['data'] as Record<string, unknown>[];
    else if (Array.isArray(json['results']))rows = json['results'] as Record<string, unknown>[];
    else                                    rows = [json];

    console.log('[etz-clarity] success from', base, '—', rows.length, 'rows');
    return { rows, baseUsed: base };
  }

  throw new Error(`All Clarity endpoints failed: ${errors.join(' | ')}`);
}

export async function GET() {
  if (!process.env.CLARITY_API_TOKEN) {
    return NextResponse.json({
      connected: false,
      dateRange: { start: '', end: '' },
      overall:   null,
      bySource:  [],
      error:     'CLARITY_API_TOKEN not configured. Generate at clarity.microsoft.com → Settings → API.',
    } satisfies EtzClarityResponse);
  }

  const endDate   = new Date(); endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
  const fmtDate   = (d: Date) => d.toISOString().slice(0, 10);

  try {
    // 1. Overall metrics
    const { rows: overallRows } = await fetchClarity({ numOfDays: '30' });
    const overall = overallRows.length > 0 ? normRow(overallRows[0]!, 'All') : null;

    // 2. By source
    const { rows: sourceRows, baseUsed } = await fetchClarity({ numOfDays: '30', dimensionType: 'Source' });
    const bySource = sourceRows
      .map(r => normRow(r))
      .filter(r => r.dimensionValue && r.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);

    console.log('[etz-clarity] done, baseUsed:', baseUsed);

    return NextResponse.json({
      connected: true,
      dateRange: { start: fmtDate(startDate), end: fmtDate(endDate) },
      overall,
      bySource,
    } satisfies EtzClarityResponse);

  } catch (e) {
    console.error('[etz-clarity]', e);
    return NextResponse.json({
      connected: false,
      dateRange: { start: '', end: '' },
      overall:   null,
      bySource:  [],
      error:     e instanceof Error ? e.message : 'Unknown error',
    } satisfies EtzClarityResponse);
  }
}
