import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  // Fetch 1 email WITHOUT statistics - check raw shape
  const r = await fetch(
    'https://api.hubapi.com/marketing/v3/emails?limit=1&properties=name,subject,publishDate',
    { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' }
  );
  const body = await r.json();
  const first = body.results?.[0];

  return NextResponse.json({
    httpStatus: r.status,
    firstId: first?.id,
    topKeys: first ? Object.keys(first) : null,
    propertiesKeys: first?.properties ? Object.keys(first.properties) : null,
    first,
  });
}
