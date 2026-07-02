import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  // Fetch one email with NO properties filter to see all returned fields
  const r1 = await fetch('https://api.hubapi.com/marketing/v3/emails?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const raw = await r1.json();
  const first = raw.results?.[0];

  // Also try fetching that email with statistics param
  let withStats = null;
  if (first?.id) {
    const r2 = await fetch(
      `https://api.hubapi.com/marketing/v3/emails?limit=1&properties=name,subject,publishDate,statistics`,
      { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' }
    );
    const d2 = await r2.json();
    withStats = d2.results?.[0];
  }

  // Also try the statistics/query endpoint for this email
  let statsQuery = null;
  if (first?.id) {
    const r3 = await fetch(
      `https://api.hubapi.com/marketing/v3/emails/statistics/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: [first.id] }),
        cache: 'no-store',
      }
    );
    statsQuery = await r3.json();
  }

  return NextResponse.json({
    firstEmailKeys: first ? Object.keys(first) : null,
    firstEmail: first,
    withStatsKeys: withStats ? Object.keys(withStats) : null,
    withStats,
    statsQuery,
  });
}
