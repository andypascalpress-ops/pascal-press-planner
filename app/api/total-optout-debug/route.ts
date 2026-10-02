/**
 * GET /api/total-optout-debug
 *
 * TEMPORARY diagnostic (read-only) — the real deduplicated count of
 * contacts opted out of at least one business unit, combining all 4
 * brand opt-out signals with OR (not a naive sum of the 4 individual
 * counts, which would double-count anyone opted out of more than one).
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

const HS_SEARCH = `${HS_BASE}/crm/v3/objects/contacts/search`;

async function count(filterGroups: object[]): Promise<number | null> {
  const res = await fetch(HS_SEARCH, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ filterGroups, limit: 1 }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const json = await res.json() as { total?: number };
  return typeof json.total === 'number' ? json.total : null;
}

const ETZ      = { propertyName: 'business_unit_optout_114005', operator: 'EQ', value: 'true' };
const BLAKE     = { propertyName: 'business_unit_optout_114004', operator: 'EQ', value: 'true' };
const EHC       = { propertyName: 'business_unit_optout_1961846', operator: 'EQ', value: 'true' };
const PP_SCHOOL = { propertyName: 'hs_email_optout_26853179',  operator: 'EQ', value: 'true' };
const PP_PROD   = { propertyName: 'hs_email_optout_27395030',  operator: 'EQ', value: 'true' };
const PP_ETZ    = { propertyName: 'hs_email_optout_33046303',  operator: 'EQ', value: 'true' };

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  // HubSpot caps filterGroups at 5, and we have 6 OR'd conditions, so this
  // uses inclusion-exclusion: A = union of the first 5 signals, B = the 6th
  // (PP-ETZ combined) on its own, C = overlap between them. Total = A + B - C.
  const a = await count([
    { filters: [ETZ] }, { filters: [BLAKE] }, { filters: [EHC] }, { filters: [PP_SCHOOL] }, { filters: [PP_PROD] },
  ]);
  const b = await count([{ filters: [PP_ETZ] }]);
  const c = await count([
    { filters: [ETZ, PP_ETZ] }, { filters: [BLAKE, PP_ETZ] }, { filters: [EHC, PP_ETZ] },
    { filters: [PP_SCHOOL, PP_ETZ] }, { filters: [PP_PROD, PP_ETZ] },
  ]);

  if (a === null || b === null || c === null) {
    return NextResponse.json({ connected: false, error: 'One or more counts failed', a, b, c }, { status: 502 });
  }

  return NextResponse.json({
    connected: true,
    unionOfFirstFive: a,
    ppEtzCombinedAlone: b,
    overlapBetweenThem: c,
    totalOptedOutOfAtLeastOneBrand: a + b - c,
    naiveSumForComparison: 136604 + 13953 + 11442 + 1291,
  });
}
