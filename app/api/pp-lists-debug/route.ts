/**
 * GET /api/pp-lists-debug
 *
 * TEMPORARY diagnostic route — checks whether the HubSpot List Memberships
 * API exposes per-contact join/removal timestamps, which we'd need to
 * compute real "joiners this week" / "unsubs this week" per segment.
 * Uses the small 11-12 list (702 members) to keep the response tiny.
 *
 * Delete once the per-segment weekly breakdown is built and confirmed.
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

async function tryGet(label: string, path: string) {
  try {
    const res = await fetch(`${HS_BASE}${path}`, { headers: hsHeaders(), cache: 'no-store' });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text; }
    return { label, path, status: res.status, ok: res.ok, response: json };
  } catch (err) {
    return { label, path, status: 0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const LIST_ID = '4897'; // 11-12 segment, 702 members

  const attempts = await Promise.all([
    tryGet('join-order',        `/crm/v3/lists/${LIST_ID}/memberships/join-order?limit=5`),
    tryGet('memberships plain', `/crm/v3/lists/${LIST_ID}/memberships?limit=5`),
  ]);

  return NextResponse.json({ connected: true, attempts });
}
