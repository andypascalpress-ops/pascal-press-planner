/**
 * GET /api/brand-optout-debug
 *
 * TEMPORARY diagnostic (read-only) — verifies the per-business-unit
 * opt-out properties found via property discovery actually work as
 * expected, with real counts, before using them anywhere permanent.
 *
 * ETZ/Blake/EHC: dedicated business_unit_optout_* rollup fields.
 * Pascal Press: no equivalent rollup exists, so approximated as opted out
 * of any of its 3 named subscription types (confirmed with the user).
 *
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

  const etzOptOut = await throttled([{ propertyName: 'business_unit_optout_114005', operator: 'EQ', value: 'true' }]);
  const blakeOptOut = await throttled([{ propertyName: 'business_unit_optout_114004', operator: 'EQ', value: 'true' }]);
  const ehcOptOut = await throttled([{ propertyName: 'business_unit_optout_1961846', operator: 'EQ', value: 'true' }]);

  // PP: opted out of ANY of its 3 named subscription types (OR via filterGroups,
  // since filterGroups are OR'd together while filters within one group are AND'd)
  const ppOptOut = await throttled([
    { propertyName: 'hs_email_optout_26853179', operator: 'EQ', value: 'true' },
  ]);
  // Note: the above only checks ONE of the three PP subscription types as a
  // sanity check on the field itself; the real OR-combined count needs
  // filterGroups (plural), done separately below via a raw request.
  let ppOptOutAny: number | null = null;
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: 'hs_email_optout_26853179', operator: 'EQ', value: 'true' }] },
          { filters: [{ propertyName: 'hs_email_optout_27395030', operator: 'EQ', value: 'true' }] },
          { filters: [{ propertyName: 'hs_email_optout_33046303', operator: 'EQ', value: 'true' }] },
        ],
        limit: 1,
      }),
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json() as { total?: number };
      ppOptOutAny = json.total ?? null;
    }
  } catch { /* leave null */ }

  return NextResponse.json({
    connected: true,
    etzOptOut,
    blakeOptOut,
    ehcOptOut,
    ppOptOutSchoolCommsOnly: ppOptOut,
    ppOptOutAnyOfThree: ppOptOutAny,
  });
}
