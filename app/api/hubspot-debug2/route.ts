import { NextResponse } from 'next/server';
export const runtime = 'edge';
const HS = 'https://api.hubapi.com';
const ID = '71565015730';
export async function GET() {
    const key = process.env.HUBSPOT_API_KEY;
    if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });
    const auth = { Authorization: `Bearer ${key}` };
    const e = await (await fetch(`${HS}/marketing/v3/emails/${ID}`, { headers: auth, cache: 'no-store' })).json();
    const cid = e.primaryEmailCampaignId ?? null;
    const allIds = e.allEmailCampaignIds ?? null;
    const v1r = cid ? await fetch(`${HS}/email/public/v1/campaigns/${cid}/data`, { headers: auth, cache: 'no-store' }) : null;
    const v1b = v1r ? await v1r.text() : null;
    return NextResponse.json({ primaryEmailCampaignId: cid, allEmailCampaignIds: allIds, v1Status: v1r?.status ?? null, v1Body: v1b ? v1b.slice(0, 800) : null });
  }
