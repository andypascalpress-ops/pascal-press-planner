import { NextResponse } from 'next/server';
export const runtime = 'edge';
const HS = 'https://api.hubapi.com';
const V3_ID = '71565015730';
const CID = '301328491';
export async function GET() {
    const key = process.env.HUBSPOT_API_KEY;
    if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });
    const auth = { Authorization: `Bearer ${key}` };
    const c1 = await fetch(`${HS}/email/public/v1/campaigns/${CID}`, { headers: auth, cache: 'no-store' });
    const c1b = await c1.text();
    const c2 = await fetch(`${HS}/marketing/v3/emails/${V3_ID}/statistics`, { headers: auth, cache: 'no-store' });
    const c2b = await c2.text();
    const e = await (await fetch(`${HS}/marketing/v3/emails/${V3_ID}?properties=campaign,campaignName`, { headers: auth, cache: 'no-store' })).json();
    return NextResponse.json({ v1Campaign: { status: c1.status, body: c1b.slice(0, 600) }, v3StatisticsPath: { status: c2.status, body: c2b.slice(0, 600) }, campaign: e.campaign ?? null, campaignName: e.campaignName ?? null });
  }
