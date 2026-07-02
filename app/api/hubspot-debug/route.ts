import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' }, { status: 500 });

  // 1. Fetch first email — no properties filter — see raw structure
  const r1 = await fetch('https://api.hubapi.com/marketing/v3/emails?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const raw = await r1.json();
  const first = raw.results?.[0];
  const firstId = first?.id;

  // 2. Fetch that email's individual statistics endpoint
  let emailStats = null;
  let emailStatsStatus = null;
  if (firstId) {
    const r2 = await fetch(
      `https://api.hubapi.com/marketing/v3/emails/${firstId}/statistics`,
      { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' }
    );
    emailStatsStatus = r2.status;
    emailStats = await r2.json();
  }

  return NextResponse.json({
    firstId,
    firstKeys: first ? Object.keys(first) : null,
    first,
    emailStatsStatus,
    emailStats,
  });
}
