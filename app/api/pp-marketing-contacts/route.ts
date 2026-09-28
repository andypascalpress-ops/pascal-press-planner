/**
 * GET /api/pp-marketing-contacts?range=today|yesterday|last7|last30|mtd|lastmonth
 *
 * Returns Pascal Press marketing contact metrics for the selected period vs
 * the immediately preceding period of equal length. `range` matches the same
 * top-of-tab filter used by /api/overview and /api/business-unit.
 *
 * Total active = all contacts where hs_marketable_status=true (no brand filter —
 * many PP contacts don't have the brand property set, causing undercounting).
 *
 * Joiners = new contact records created in the period (HubSpot doesn't expose a
 * queryable "became marketable" date, so createdate is the closest available
 * proxy — most PP contacts are pre-existing, so this trends much lower than
 * raw sign-ups would).
 *
 * Unsubscribes = real per-send unsubscribe counters from the Marketing Email
 * API for Pascal Press campaigns sent in the period (lib/hubspot-email.ts),
 * not a CRM property heuristic — hs_email_optout + lastmodifieddate was
 * catching contacts modified for unrelated reasons who happened to have
 * optout=true.
 */
import { NextResponse } from 'next/server';
import { fetchEmailCampaigns, detectEmailBrand } from '@/lib/hubspot-email';
import { rangeBoundaries, type RangeParam } from '@/lib/pp-range';

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

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') ?? 'last7') as RangeParam;
  const { startMs, endMs, prevStartMs, prevEndMs, startDate, endDate, prevStartDate, prevEndDate, label } =
    rangeBoundaries(range);

  const [totalActive, joinersThisPeriod, joinersPrevPeriod, emailSummary, emailSummaryPrevPeriod] = await Promise.all([
    // All active marketing contacts (no brand filter — many PP contacts lack brand property)
    hsCount([{ filters: [
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    ]}]),

    // New contact records created in the selected period
    hsCount([{ filters: [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ]}]),

    // New contact records created in the prior period
    hsCount([{ filters: [
      { propertyName: 'createdate', operator: 'GTE', value: String(prevStartMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(prevEndMs)   },
    ]}]),

    // Real unsubscribe counters for PP emails sent in the selected period
    fetchEmailCampaigns(undefined, { dateRange: { start: startDate, end: endDate } }),

    // Real unsubscribe counters for PP emails sent in the prior period
    fetchEmailCampaigns(undefined, { dateRange: { start: prevStartDate, end: prevEndDate } }),
  ]);

  const sumPPUnsubs = (summary: typeof emailSummary) => summary.connected
    ? summary.campaigns
        .filter(c => detectEmailBrand(c.name, c.fromName) === 'Pascal Press')
        .reduce((sum, c) => sum + c.unsubscribes, 0)
    : 0;

  const unsubsThisPeriod = sumPPUnsubs(emailSummary);
  const unsubsPrevPeriod = sumPPUnsubs(emailSummaryPrevPeriod);

  const net = joinersThisPeriod - unsubsThisPeriod;

  return NextResponse.json({
    connected: true,
    totalActive,
    joinersThisWeek: joinersThisPeriod,
    joinersLastWeek: joinersPrevPeriod,
    unsubsThisWeek: unsubsThisPeriod,
    unsubsLastWeek: unsubsPrevPeriod,
    net,
    weekEndingLabel: label,
  });
}
