/**
 * GET /api/pp-marketing-contacts
 *
 * Returns Pascal Press marketing contact metrics for the current week vs last week.
 *
 * Total active = all contacts where hs_marketable_status=true (no brand filter —
 * many PP contacts don't have the brand property set, causing undercounting).
 * Joiners / unsubs / net use the same broad filter.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function hsCount(filterGroups: object[]): Promise<number> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['createdate'] }),
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const json = await res.json();
    return (json.total as number) ?? 0;
  } catch {
    return 0;
  }
}

function weekBoundaries() {
  const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
  const nowAest = new Date(Date.now() + AEST_OFFSET_MS);
  const dayOfWeek = nowAest.getUTCDay();
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStartAest = new Date(
    Date.UTC(nowAest.getUTCFullYear(), nowAest.getUTCMonth(), nowAest.getUTCDate() - daysFromMon)
  );
  const thisWeekStart = thisWeekStartAest.getTime() - AEST_OFFSET_MS;
  const prevWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
  return { thisWeekStart, prevWeekStart, prevWeekEnd: thisWeekStart, now: Date.now() };
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { thisWeekStart, prevWeekStart, prevWeekEnd, now } = weekBoundaries();

  const [totalActive, joinersThisWeek, joinersLastWeek, unsubsThisWeek] = await Promise.all([
    // All active marketing contacts (no brand filter — many PP contacts lack brand property)
    hsCount([{ filters: [
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    ]}]),

    // New marketable contacts created this week
    hsCount([{ filters: [
      { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'                },
      { propertyName: 'createdate',           operator: 'GTE', value: String(thisWeekStart) },
      { propertyName: 'createdate',           operator: 'LTE', value: String(now)           },
    ]}]),

    // New marketable contacts created last week
    hsCount([{ filters: [
      { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'                },
      { propertyName: 'createdate',           operator: 'GTE', value: String(prevWeekStart) },
      { propertyName: 'createdate',           operator: 'LT',  value: String(prevWeekEnd)   },
    ]}]),

    // Approx unsubs: contacts with hs_email_optout=true, modified this week
    hsCount([{ filters: [
      { propertyName: 'hs_email_optout',  operator: 'EQ',  value: 'true'                },
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: String(thisWeekStart) },
    ]}]),
  ]);

  const net = joinersThisWeek - unsubsThisWeek;

  const weekEndingLabel = new Date().toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

  return NextResponse.json({
    connected: true,
    totalActive,
    joinersThisWeek,
    joinersLastWeek,
    unsubsThisWeek,
    net,
    weekEndingLabel,
  });
}
