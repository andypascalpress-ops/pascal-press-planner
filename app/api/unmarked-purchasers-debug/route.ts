/**
 * GET /api/unmarked-purchasers-debug
 *
 * TEMPORARY diagnostic — of the 186,489 Pascal Press-tagged contacts that
 * are not marketable and have never actively opted out, how many have an
 * actual purchase on record (via the Unific "Last Product Bought"
 * property)? Distinguishes genuine lapsed/unconsented customers from
 * contacts that only ever got the Brand tag without a real transaction
 * (e.g. a newsletter signup, lead form, or import).
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

  const PP_TAGGED        = { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Pascal Press' };
  const NOT_MARKETABLE   = { propertyName: 'hs_marketable_status', operator: 'NEQ', value: 'true' };
  const NOT_OPTED_OUT    = { propertyName: 'hs_email_optout', operator: 'NEQ', value: 'true' };
  const PRODUCT_PROPERTY = 'unific_last_product_bought_text'; // confirmed earlier this session

  const segment = [PP_TAGGED, NOT_MARKETABLE, NOT_OPTED_OUT];

  const segmentTotal = await throttled(segment);

  const withAnyPurchase = await throttled([
    ...segment,
    { propertyName: PRODUCT_PROPERTY, operator: 'HAS_PROPERTY' },
  ]);

  const withExcelPurchase = await throttled([
    ...segment,
    { propertyName: PRODUCT_PROPERTY, operator: 'CONTAINS_TOKEN', value: 'Excel' },
  ]);

  const withTargetingPurchase = await throttled([
    ...segment,
    { propertyName: PRODUCT_PROPERTY, operator: 'CONTAINS_TOKEN', value: 'Targeting' },
  ]);

  const withNoPurchaseRecord = segmentTotal - withAnyPurchase;

  return NextResponse.json({
    connected: true,
    segmentTotal,
    withAnyPurchase,
    withExcelPurchase,
    withTargetingPurchase,
    withOtherUnidentifiedPurchase: withAnyPurchase - withExcelPurchase - withTargetingPurchase,
    withNoPurchaseRecord,
  });
}
