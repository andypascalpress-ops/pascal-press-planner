/**
 * GET /api/pp-marketing-contacts
 *
 * Returns Pascal Press marketing contact metrics for the current week vs last week.
 * - totalActive: all PP contacts where hs_marketable_status = true
 * - joinersThisWeek / joinersLastWeek: new marketable contacts created this/last week
 * - unsubsThisWeek: PP contacts where hs_email_optout = true, modified this week
 *   (approximation — HubSpot has no dedicated unsubscribe-date property)
 * - net: joinersThisWeek - unsubsThisWeek
 *
 * Segment breakdown (K-2, 3-6, etc.) will be added once the HubSpot
 * audience segment property name is confirmed.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';
const PP_BRAND = 'Pascal Press';

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

function weekBoundaries(): { thisWeekStart: number; prevWeekStart: number; prevWeekEnd: number; now: number } {
  // Work in AEST (UTC+10) — week starts Monday
  const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
  const nowAest = new Date(Date.now() + AEST_OFFSET_MS);
  const dayOfWeek = nowAest.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // Monday midnight AEST → convert back to UTC ms
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
    // All active PP marketing contacts
    hsCount([{ filters: [
      { propertyName: 'brand',                operator: 'EQ', value: PP_BRAND },
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true'   },
    ]}]),

    // New marketable PP contacts created this week
    hsCount([{ filters: [
      { propertyName: 'brand',                operator: 'EQ',  value: PP_BRAND              },
      { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'                },
      { propertyName: 'createdate',           operator: 'GTE', value: String(thisWeekStart) },
      { propertyName: 'createdate',           operator: 'LTE', value: String(now)           },
    ]}]),

    // New marketable PP contacts created last week
    hsCount([{ filters: [
      { propertyName: 'brand',                operator: 'EQ',  value: PP_BRAND              },
      { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'                },
      { propertyName: 'createdate',           operator: 'GTE', value: String(prevWeekStart) },
      { propertyName: 'createdate',           operator: 'LT',  value: String(prevWeekEnd)   },
    ]}]),

    // Approximate unsubs: PP contacts with hs_email_optout=true, modified this week
    hsCount([{ filters: [
      { propertyName: 'brand',            operator: 'EQ',  value: PP_BRAND              },
      { propertyName: 'hs_email_optout',  operator: 'EQ',  value: 'true'                },
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: String(thisWeekStart) },
    ]}]),
  ]);

  const net = joinersThisWeek - unsubsThisWeek;
  const netLastWeek = joinersLastWeek; // unsubs last week not tracked, just show joiners for now

  // Week-ending label in AEST
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
    netLastWeek,
    weekEndingLabel,
  });
}
