/**
 * GET /api/untagged-sample-debug
 *
 * TEMPORARY diagnostic — directly tests whether the "no Brand tagged"
 * contacts are actually Pascal Press contacts, instead of assuming it from
 * a weaker, indirect clue (PP's tagging rate being lower than ETZ's).
 * Checks a property independent of the Brand checkbox — "Source store",
 * which Unific sets to the BigCommerce store domain (pascalpress.com.au
 * for PP, a different domain for Blake, which also runs on BigCommerce) —
 * and reports counts only, no individual contact records or PII.
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

interface HubSpotProperty { name: string; label: string; type: string; fieldType: string }

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

  const sourceStoreProp = await findProperty(/source\s*store/i);
  await sleep(150);
  const productsProp = await findProperty(/products?\s*(bought|purchased)/i);
  await sleep(150);

  const MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' };
  const NO_BRAND    = { propertyName: 'brand', operator: 'NOT_HAS_PROPERTY' };

  const untaggedTotal = await countContacts([MARKETABLE, NO_BRAND]);
  await sleep(150);

  let untaggedWithPascalPressSourceStore: number | null = null;
  if (sourceStoreProp) {
    untaggedWithPascalPressSourceStore = await countContacts([
      MARKETABLE, NO_BRAND,
      { propertyName: sourceStoreProp.name, operator: 'CONTAINS_TOKEN', value: 'pascalpress' },
    ]);
    await sleep(150);
  }

  let untaggedWithAnySourceStore: number | null = null;
  if (sourceStoreProp) {
    untaggedWithAnySourceStore = await countContacts([
      MARKETABLE, NO_BRAND,
      { propertyName: sourceStoreProp.name, operator: 'HAS_PROPERTY' },
    ]);
    await sleep(150);
  }

  let untaggedWithAnyProductsBought: number | null = null;
  if (productsProp) {
    untaggedWithAnyProductsBought = await countContacts([
      MARKETABLE, NO_BRAND,
      { propertyName: productsProp.name, operator: 'HAS_PROPERTY' },
    ]);
    await sleep(150);
  }

  // PP's product line is branded "Excel" (e.g. "Excel NAPLAN Book Pack Year 3").
  // Check how many of the untagged-with-a-purchase contacts bought an
  // Excel-branded product, vs some other brand's naming.
  let untaggedWithExcelProduct: number | null = null;
  if (productsProp) {
    untaggedWithExcelProduct = await countContacts([
      MARKETABLE, NO_BRAND,
      { propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Excel' },
    ]);
  }

  return NextResponse.json({
    connected: true,
    discoveredProperties: {
      sourceStoreProp: sourceStoreProp ? { name: sourceStoreProp.name, label: sourceStoreProp.label, fieldType: sourceStoreProp.fieldType } : null,
      productsProp: productsProp ? { name: productsProp.name, label: productsProp.label, fieldType: productsProp.fieldType } : null,
    },
    untaggedTotal,
    untaggedWithPascalPressSourceStore,
    untaggedWithAnySourceStore,
    untaggedWithAnyProductsBought,
    untaggedWithExcelProduct,
  });
}
