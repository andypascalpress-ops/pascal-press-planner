/**
 * GET /api/hubspot-subscribers?month=YYYY-MM
 *
 * Returns new contacts and email opt-outs from HubSpot for the given month.
 *
 * new contacts  – contacts created this month who have not opted out of email
 *                 (proxy for new email subscribers/sign-ups)
 * optOuts       – contacts who unsubscribed from email this month,
 *                 detected via the communication preferences unsubscribe timeline
 *
 * Required env var: HUBSPOT_CRM_TOKEN or HUBSPOT_API_KEY
 */
import { NextResponse } from 'next/server';

export const revalidate = 1800; // 30-minute cache per URL

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function monthToEpochRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    startMs: new Date(Date.UTC(y!, m! - 1, 1)).getTime(),
    endMs:   new Date(Date.UTC(y!, m!,     1)).getTime(),
  };
}

/** Count contacts matching the given filter groups (1 search call, reads only total). */
async function hsContactCount(filterGroups: { filters: object[] }[]): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['email'] }),
      cache: 'no-store',
    });
    if (res.status === 429) {
      if (attempt === 0) { await delay(1100); continue; }
      throw new Error('HubSpot contacts search → 429 rate limit');
    }
    if (!res.ok) throw new Error(`HubSpot contacts search → ${res.status}`);
    const json = await res.json();
    return (json.total as number) ?? 0;
  }
  return 0;
}

/**
 * Count actual email unsubscribe events in the date range using the
 * communication preferences v3 timeline API.
 */
async function hsUnsubscribeCount(startMs: number, endMs: number): Promise<number> {
  let count = 0;
  let after: string | undefined;

  do {
    const params = new URLSearchParams({
      startTimestamp: String(startMs),
      endTimestamp:   String(endMs),
      limit:          '100',
    });
    if (after) params.set('after', after);

    const res = await fetch(
      `${HS_BASE}/communication-preferences/v3/unsubscribes/timeline?${params}`,
      { headers: hsHeaders(), cache: 'no-store' },
    );

    // This endpoint may not be available on all HubSpot tiers — fall back to 0
    if (res.status === 403 || res.status === 404 || res.status === 501) return 0;
    if (res.status === 429) { await delay(1100); continue; }
    if (!res.ok) return 0;

    const json = await res.json();
    count += (json.results ?? []).length;
    after  = json.paging?.next?.after as string | undefined;
    if (after) await delay(250);
  } while (after);

  return count;
}

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json(
      { error: 'No HubSpot token configured', connected: false },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM', connected: false }, { status: 400 });
  }

  const { startMs, endMs } = monthToEpochRange(month);

  try {
    // Run new-contacts and unsubscribe queries in parallel
    const [newContacts, optOuts] = await Promise.all([
      // New contacts created this month (regardless of opt-in status — new signups)
      hsContactCount([{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
        ],
      }]),

      // Actual email unsubscribe events via communication preferences timeline
      hsUnsubscribeCount(startMs, endMs),
    ]);

    return NextResponse.json({
      month,
      newContacts,
      optOuts,
      connected: true,
    });
  } catch (e) {
    console.error('[hubspot-subscribers]', e);
    return NextResponse.json({
      month,
      newContacts: 0,
      optOuts:     0,
      connected:   false,
      error:       e instanceof Error ? e.message : 'Unknown error',
    });
  }
}
