/**
 * GET /api/pp-lists-debug
 *
 * TEMPORARY diagnostic route — not linked from any UI.
 * Calls the HubSpot Lists Search API a couple of plausible ways and returns
 * the raw response so we can see actual list names, IDs, and which field
 * holds the member count, instead of guessing again after the last attempt
 * (searchQuery param, wrong response key) silently returned zero lists.
 *
 * Delete this route once /api/pp-contacts-segments is fixed and confirmed.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function tryFetch(label: string, body: object) {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/lists/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text; }
    return { label, requestBody: body, status: res.status, ok: res.ok, response: json };
  } catch (err) {
    return { label, requestBody: body, status: 0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const attempts = await Promise.all([
    tryFetch('query=PP',        { query: 'PP', count: 100, offset: 0 }),
    tryFetch('query=Years',     { query: 'Years', count: 100, offset: 0 }),
    tryFetch('no query (all)',  { count: 100, offset: 0 }),
  ]);

  return NextResponse.json({ connected: true, attempts });
}
