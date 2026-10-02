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

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  // filterGroups are OR'd together; each group here is a single EQ=true check
  // on one of the 4 brands' opt-out signals (PP split across its 3 named
  // subscription types, each its own OR'd group).
  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: 'business_unit_optout_114005', operator: 'EQ', value: 'true' }] }, // ETZ
        { filters: [{ propertyName: 'business_unit_optout_114004', operator: 'EQ', value: 'true' }] }, // Blake
        { filters: [{ propertyName: 'business_unit_optout_1961846', operator: 'EQ', value: 'true' }] }, // EHC
        { filters: [{ propertyName: 'hs_email_optout_26853179',  operator: 'EQ', value: 'true' }] }, // PP School Comms
        { filters: [{ propertyName: 'hs_email_optout_27395030',  operator: 'EQ', value: 'true' }] }, // PP Product Updates
        { filters: [{ propertyName: 'hs_email_optout_33046303',  operator: 'EQ', value: 'true' }] }, // PP-ETZ combined
      ],
      limit: 1,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ connected: false, status: res.status, body: text.slice(0, 500) }, { status: 500 });
  }

  const json = await res.json() as { total?: number };

  return NextResponse.json({
    connected: true,
    totalOptedOutOfAtLeastOneBrand: json.total ?? null,
    naiveSumForComparison: 136604 + 13953 + 11442 + 1291,
  });
}
