/**
 * Temporary debug route — tests HubSpot statistics endpoints.
 * DELETE this file once statistics are confirmed working.
 */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const HS = 'https://api.hubapi.com';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  const auth = { Authorization: `Bearer ${key}` };

  // ── 1. Grab 3 email IDs from the list ───────────────────────────────────────
  const listRes = await fetch(`${HS}/marketing/v3/emails?limit=3&properties=name,publishDate`, {
    headers: auth,
    cache: 'no-store',
  });
  const listJson = await listRes.json();
  const ids: string[] = (listJson.results ?? []).map((r: { id: string }) => r.id);

  if (!ids.length) {
    return NextResponse.json({ error: 'no emails found', listStatus: listRes.status });
  }

  // ── 2. Test POST /marketing/v3/emails/statistics/query ──────────────────────
  const sqRes = await fetch(`${HS}/marketing/v3/emails/statistics/query`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    cache: 'no-store',
  });
  const sqBody = await sqRes.text();

  // ── 3. Test GET /marketing/v3/emails/{id} (single email, all properties) ────
  const singleRes = await fetch(
    `${HS}/marketing/v3/emails/${ids[0]}`,
    { headers: auth, cache: 'no-store' },
  );
  const singleBody = await singleRes.json();

  // ── 4. Test POST /marketing/v3/emails/batch/read with statistics ─────────────
  const batchRes = await fetch(`${HS}/marketing/v3/emails/batch/read`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: ids.map(id => ({ id })),
      properties: ['name', 'statistics'],
    }),
    cache: 'no-store',
  });
  const batchBody = await batchRes.text();

  return NextResponse.json({
    ids,
    statsQuery:  { status: sqRes.status,     body: tryJson(sqBody)    },
    singleEmail: { status: singleRes.status, topKeys: Object.keys(singleBody), body: singleBody },
    batchRead:   { status: batchRes.status,  body: tryJson(batchBody) },
  });
}

function tryJson(s: string) {
  try { return JSON.parse(s); } catch { return s.slice(0, 500); }
}
