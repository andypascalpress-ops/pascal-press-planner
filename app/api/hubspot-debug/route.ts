import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  const url = 'https://api.hubapi.com/marketing/v3/emails?limit=1&properties=name,subject,publishDate,statistics';
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });

  const status = r.status;
  const body = await r.json();
  const first = body.results?.[0];

  return NextResponse.json({
    status,
    firstId: first?.id,
    firstKeys: first ? Object.keys(first) : null,
    propertiesKeys: first?.properties ? Object.keys(first.properties) : null,
    first,
  });
}
