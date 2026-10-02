/**
 * GET /api/optout-vs-unmarked-debug
 *
 * TEMPORARY diagnostic — of the 246,446 Pascal Press-tagged contacts that
 * are not currently marketable, how many actively unsubscribed
 * (hs_email_optout = true) vs how many simply never got marked as a
 * marketing contact at all (no active opt-out, just never classified)?
 * These have very different implications: an active opt-out should not be
 * re-marketed to; a never-classified contact may be a legitimate
 * re-permission opportunity.
 *
 * Aggregate counts only — no individual contact records or PII.
 * Delete once this is answered.
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function countContacts(filters: object[]): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) { await sleep(500 * Math.pow(2, attempt)); continue; }
      if (!res.ok) return null;
      const json = await res.json() as { total?: number };
      return typeof json.total === 'number' ? json.total : null;
    } catch { await sleep(500 * Math.pow(2, attempt)); }
  }
  return null;
}

async function throttled(filters: object[]): Promise<number> {
  const n = await countContacts(filters);
  await sleep(150);
  return n ?? -1;
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const PP_TAGGED = { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Pascal Press' };
  const NOT_MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'NEQ', value: 'true' };

  const ppTaggedNotMarketable = await throttled([PP_TAGGED, NOT_MARKETABLE]);

  const activelyOptedOut = await throttled([
    PP_TAGGED, NOT_MARKETABLE,
    { propertyName: 'hs_email_optout', operator: 'EQ', value: 'true' },
  ]);

  const neverOptedOutButUnmarked = await throttled([
    PP_TAGGED, NOT_MARKETABLE,
    { propertyName: 'hs_email_optout', operator: 'NEQ', value: 'true' },
  ]);

  return NextResponse.json({
    connected: true,
    ppTaggedNotMarketable,
    activelyOptedOut,
    neverOptedOutButUnmarked,
    reconciliationCheck: activelyOptedOut + neverOptedOutButUnmarked,
  });
}
