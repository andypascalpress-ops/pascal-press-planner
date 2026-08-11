/**
 * GET /api/etz-reports-debug
 * Lists HubSpot reports matching "ETZ" or "trial" and their IDs.
 * DELETE this file once report IDs are confirmed.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';

function headers() {
  return { Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}` };
}

export async function GET() {
  const results: unknown[] = [];
  const errors: string[] = [];

  // Try v2 reports endpoint
  try {
    const res = await fetch(`${HS_BASE}/reporting/v2/reports?limit=300`, {
      headers: headers(), cache: 'no-store',
    });
    const json = await res.json();
    const reports = (json.results ?? json.objects ?? []) as Array<{ id: string; name: string; reportType?: string }>;
    const etzReports = reports.filter((r) =>
      r.name?.toLowerCase().includes('etz') || r.name?.toLowerCase().includes('trial')
    );
    results.push({ endpoint: 'v2', total: json.total ?? reports.length, etzMatches: etzReports });
  } catch (e) {
    errors.push(`v2: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Try v3 analytics reports
  try {
    const res = await fetch(`${HS_BASE}/analytics/v2/reports?limit=50`, {
      headers: headers(), cache: 'no-store',
    });
    const json = await res.json();
    results.push({ endpoint: 'analytics/v2', status: res.status, body: JSON.stringify(json).slice(0, 300) });
  } catch (e) {
    errors.push(`analytics/v2: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({ results, errors });
}
