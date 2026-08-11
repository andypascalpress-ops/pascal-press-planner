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
  // Fetch all contact properties and filter to ETZ/trial-related custom ones
  const res = await fetch(`${HS_BASE}/crm/v3/properties/contacts?limit=1000`, {
    headers: headers(), cache: 'no-store',
  });
  if (!res.ok) {
    return NextResponse.json({ error: `${res.status}` }, { status: res.status });
  }
  const json = await res.json();
  const all = (json.results ?? []) as Array<{ name: string; label: string; type: string; groupName: string; description?: string }>;

  // Filter to ETZ/trial-related properties
  const relevant = all.filter((p) => {
    const s = `${p.name} ${p.label} ${p.groupName} ${p.description ?? ''}`.toLowerCase();
    return s.includes('etz') || s.includes('trial') || s.includes('pack') || s.includes('convert') || s.includes('subscri') || s.includes('active');
  });

  return NextResponse.json({
    total: all.length,
    relevantCount: relevant.length,
    properties: relevant.map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      group: p.groupName,
    })),
  });
}
