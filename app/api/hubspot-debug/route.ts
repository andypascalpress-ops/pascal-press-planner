/**
 * Temporary debug route — discovers correct HubSpot email states + statistics.
 * DELETE this file once statistics are confirmed working.
 */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const HS = 'https://api.hubapi.com';
const KNOWN_ID = '71565015730';

export async function GET() {
    const key = process.env.HUBSPOT_API_KEY;
    if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });
    const auth = { Authorization: `Bearer ${key}` };

  // 1. No state filter — see what states actually exist in the list
  const unfilteredRes = await fetch(
        `${HS}/marketing/v3/emails?limit=5&properties=name,state,publishDate,statistics`,
    { headers: auth, cache: 'no-store' },
      );
    const unfilteredJson = await unfilteredRes.json();
    const statesSample = (unfilteredJson.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.id, name: r.name, state: r.state, publishDate: r.publishDate,
          statistics: r.statistics ?? null,
    }));

  // 2. Filter state=PUBLISHED
  const pubRes = await fetch(
        `${HS}/marketing/v3/emails?limit=3&state=PUBLISHED&properties=name,state,publishDate,statistics`,
    { headers: auth, cache: 'no-store' },
      );
    const pubJson = await pubRes.json();
    const pubSample = (pubJson.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.id, name: r.name, state: r.state,
          statisticsKeys: r.statistics ? Object.keys(r.statistics as object) : null,
          statistics: r.statistics ?? null,
    }));

  // 3. Fetch known sent email directly (v3)
  const knownV3Res = await fetch(`${HS}/marketing/v3/emails/${KNOWN_ID}`, { headers: auth, cache: 'no-store' });
    const knownV3Json = await knownV3Res.json();

  // 4. v1 campaigns endpoint with known ID
  const v1Res = await fetch(`${HS}/email/public/v1/campaigns/${KNOWN_ID}/data`, { headers: auth, cache: 'no-store' });
    const v1Body = await v1Res.text();

  // 5. v1 campaigns list
  const v1ListRes = await fetch(`${HS}/email/public/v1/campaigns?limit=3`, { headers: auth, cache: 'no-store' });
    const v1ListBody = await v1ListRes.text();

  return NextResponse.json({
        statesSample,
        publishedFilter: { status: pubRes.status, total: pubJson.total, sample: pubSample },
        knownEmail: {
                id: KNOWN_ID, v3Status: knownV3Res.status, v3State: knownV3Json.state ?? null,
                v3TopKeys: Object.keys(knownV3Json), v3Statistics: knownV3Json.statistics ?? null,
        },
        v1CampaignData: { status: v1Res.status, body: tryJson(v1Body) },
        v1CampaignsList: { status: v1ListRes.status, body: tryJson(v1ListBody) },
  });
}

function tryJson(s: string) {
    try { return JSON.parse(s); } catch { return s.slice(0, 600); }
}
