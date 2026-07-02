/**
 * Temporary debug route — tests HubSpot statistics on SENT emails.
 * DELETE this file once statistics are confirmed working.
 */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const HS = 'https://api.hubapi.com';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  const auth = { Authorization: `Bearer ${key}` };

  // ── 1. Fetch list filtered to SENT emails with statistics property ──────────
  const listRes = await fetch(
    `${HS}/marketing/v3/emails?limit=3&state=SENT&properties=name,subject,publishDate,statistics`,
    { headers: auth, cache: 'no-store' },
  );
  const listJson = await listRes.json();
  const firstThree = (listJson.results ?? []).slice(0, 3);
  const ids: string[] = firstThree.map((r: { id: string }) => r.id);

  if (!ids.length) {
    return NextResponse.json({
      error: 'no SENT emails found',
      listStatus: listRes.status,
      listError: listJson,
    });
  }

  // ── 2. Check what statistics looks like in the list response ─────────────────
  const listStatsPreview = firstThree.map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    statisticsKeys: r.statistics ? Object.keys(r.statistics as object) : null,
    statistics: r.statistics,
  }));

  // ── 3. Fetch single SENT email, note ALL top-level keys ────────────────────
  const singleRes = await fetch(
    `${HS}/marketing/v3/emails/${ids[0]}`,
    { headers: auth, cache: 'no-store' },
  );
  const singleJson = await singleRes.json();

  // ── 4. Try v1 email stats endpoint ─────────────────────────────────────────
  const v1Res = await fetch(
    `${HS}/email/public/v1/campaigns/${ids[0]}/data`,
    { headers: auth, cache: 'no-store' },
  );
  const v1Body = await v1Res.text();

  return NextResponse.json({
    sentEmailIds: ids,
    listStatsPreview,
    singleEmail: {
      status: singleRes.status,
      topKeys: Object.keys(singleJson),
      statisticsField: singleJson.statistics ?? null,
    },
    v1Stats: {
      status: v1Res.status,
      body: tryJson(v1Body),
    },
  });
}

function tryJson(s: string) {
  try { return JSON.parse(s); } catch { return s.slice(0, 600); }
}
