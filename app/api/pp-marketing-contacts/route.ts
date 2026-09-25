/**
 * GET /api/pp-marketing-contacts
 *
 * Returns Pascal Press marketing contact metrics for the current week vs last week.
 *
 * Total active = all contacts where hs_marketable_status=true (no brand filter —
 * many PP contacts don't have the brand property set, causing undercounting).
 *
 * Joiners = new contact records created this week (HubSpot doesn't expose a
 * queryable "became marketable" date, so createdate is the closest available
 * proxy — most PP contacts are pre-existing, so this trends much lower than
 * raw sign-ups would).
 *
 * Unsubscribes = real per-send unsubscribe counters from the Marketing Email
 * API for Pascal Press campaigns sent this week (lib/hubspot-email.ts), not
 * a CRM property heuristic — hs_email_optout + lastmodifieddate was catching
 * contacts modified for unrelated reasons who happened to have optout=true.
 */
import { NextResponse } from 'next/server';
import { fetchEmailCampaigns, detectEmailBrand } from '@/lib/hubspot-email';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

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

function toAestDateStr(ms: number): string {
  const d = new Date(ms + AEST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function weekBoundaries() {
  const nowAest = new Date(Date.now() + AEST_OFFSET_MS);
  const dayOfWeek = nowAest.getUTCDay();
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStartAest = new Date(
    Date.UTC(nowAest.getUTCFullYear(), nowAest.getUTCMonth(), nowAest.getUTCDate() - daysFromMon)
  );
  const thisWeekStart = thisWeekStartAest.getTime() - AEST_OFFSET_MS;
  const prevWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    thisWeekStart,
    prevWeekStart,
    prevWeekEnd: thisWeekStart,
    now,
    thisWeekStartDate: toAestDateStr(thisWeekStart),
    todayDate: toAestDateStr(now),
    prevWeekStartDate: toAestDateStr(prevWeekStart),
    prevWeekEndDate: toAestDateStr(thisWeekStart - 1),
  };
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const {
    thisWeekStart, prevWeekStart, prevWeekEnd, now,
    thisWeekStartDate, todayDate, prevWeekStartDate, prevWeekEndDate,
  } = weekBoundaries();

  const [totalActive, joinersThisWeek, joinersLastWeek, emailSummary, emailSummaryLastWeek] = await Promise.all([
    // All active marketing contacts (no brand filter — many PP contacts lack brand property)
    hsCount([{ filters: [
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    ]}]),

    // New contact records created this week
    hsCount([{ filters: [
      { propertyName: 'createdate', operator: 'GTE', value: String(thisWeekStart) },
      { propertyName: 'createdate', operator: 'LTE', value: String(now)           },
    ]}]),

    // New contact records created last week
    hsCount([{ filters: [
      { propertyName: 'createdate', operator: 'GTE', value: String(prevWeekStart) },
      { propertyName: 'createdate', operator: 'LT',  value: String(prevWeekEnd)   },
    ]}]),

    // Real unsubscribe counters for PP emails sent this week
    fetchEmailCampaigns(undefined, { dateRange: { start: thisWeekStartDate, end: todayDate } }),

    // Real unsubscribe counters for PP emails sent last week
    fetchEmailCampaigns(undefined, { dateRange: { start: prevWeekStartDate, end: prevWeekEndDate } }),
  ]);

  const sumPPUnsubs = (summary: typeof emailSummary) => summary.connected
    ? summary.campaigns
        .filter(c => detectEmailBrand(c.name, c.fromName) === 'Pascal Press')
        .reduce((sum, c) => sum + c.unsubscribes, 0)
    : 0;

  const unsubsThisWeek = sumPPUnsubs(emailSummary);
  const unsubsLastWeek = sumPPUnsubs(emailSummaryLastWeek);

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
    unsubsLastWeek,
    net,
    weekEndingLabel,
  });
}
