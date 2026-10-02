/**
 * GET /api/full-contacts-debug
 *
 * TEMPORARY diagnostic — checks the FULL HubSpot contact database (418K+),
 * not just the ~47.8K marketing-contacts subset every other check this
 * session has filtered to. Hypothesis: a large chunk of real Pascal Press
 * customers exist in HubSpot but are marked hs_marketable_status != true
 * (opted out, never consented, suppressed for compliance) — which would
 * make them invisible to the marketing-contacts breakdown entirely, a much
 * bigger gap than the Brand-tagging gap already found within the
 * marketable subset.
 *
 * Reports aggregate counts only — no individual contact records or PII.
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

interface HubSpotProperty { name: string; label: string }
async function findProperty(labelPattern: RegExp): Promise<HubSpotProperty | null> {
  const res = await fetch(`${HS_BASE}/crm/v3/properties/contacts?limit=500`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  if (!res.ok) return null;
  const { results } = await res.json() as { results: HubSpotProperty[] };
  return results.find(p => labelPattern.test(p.label)) ?? null;
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const productsProp = await findProperty(/products?\s*(bought|purchased)/i);
  await sleep(150);

  const totalAllContacts = await throttled([]);
  const totalMarketable  = await throttled([{ propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' }]);
  const totalNonMarketable = totalAllContacts - totalMarketable;

  // PP-tagged, regardless of marketable status
  const ppTaggedAny = await throttled([
    { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Pascal Press' },
  ]);
  // PP-tagged AND marketable (what the dashboard already shows)
  const ppTaggedMarketable = await throttled([
    { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Pascal Press' },
    { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
  ]);
  // PP-tagged but NOT marketable
  const ppTaggedNotMarketable = ppTaggedAny - ppTaggedMarketable;

  let ppProductAny: number | null = null;
  let ppProductMarketable: number | null = null;
  if (productsProp) {
    const excelAny = await throttled([{ propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Excel' }]);
    const targetingAny = await throttled([{ propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Targeting' }]);
    ppProductAny = excelAny + targetingAny;

    const excelMkt = await throttled([
      { propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Excel' },
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    ]);
    const targetingMkt = await throttled([
      { propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Targeting' },
      { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    ]);
    ppProductMarketable = excelMkt + targetingMkt;
  }

  return NextResponse.json({
    connected: true,
    totalAllContacts,
    totalMarketable,
    totalNonMarketable,
    ppTaggedAny,
    ppTaggedMarketable,
    ppTaggedNotMarketable,
    ppProductAny,
    ppProductMarketable,
    ppProductNotMarketable: ppProductAny != null && ppProductMarketable != null ? ppProductAny - ppProductMarketable : null,
    productsPropUsed: productsProp,
  });
}
