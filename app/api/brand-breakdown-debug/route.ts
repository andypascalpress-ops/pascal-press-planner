/**
 * GET /api/brand-breakdown-debug
 *
 * TEMPORARY diagnostic — figures out whether HubSpot marketing contacts can
 * be cleanly attributed to a business unit (Pascal Press / ETZ / EHC /
 * Blake) so the four counts sum back to the total. We already know the
 * `brand` property alone undercounts (PP alone showed ~13K vs ~49K real
 * total earlier this project), so this checks the property's actual value
 * distribution — including how many marketable contacts have NO value set
 * — rather than assuming a clean split exists.
 *
 * Delete once the real segmentation approach is confirmed.
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

async function countContacts(filters: object[]): Promise<number> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
      cache: 'no-store',
    });
    if (!res.ok) return -1;
    const json = await res.json() as { total: number };
    return json.total ?? 0;
  } catch { return -1; }
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  // 1. Total marketable contacts
  const totalMarketable = await countContacts([
    { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
  ]);

  // 2. Discover the `brand` property's defined options (if it's an enum)
  const propRes = await fetch(`${HS_BASE}/crm/v3/properties/contacts/brand`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  const brandProp = propRes.ok ? await propRes.json() as {
    label: string; type: string; fieldType: string;
    options?: Array<{ label: string; value: string }>;
  } : null;

  // 3. Count marketable contacts per brand value (if options exist)
  const perBrandValue: Record<string, number> = {};
  if (brandProp?.options) {
    for (const opt of brandProp.options) {
      perBrandValue[opt.value] = await countContacts([
        { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
        { propertyName: 'brand',                operator: 'EQ', value: opt.value },
      ]);
    }
  }

  // 4. Marketable contacts with brand NOT SET at all
  const brandNotSet = await countContacts([
    { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    { propertyName: 'brand',                operator: 'NOT_HAS_PROPERTY' },
  ]);

  // 5. Marketable contacts WITH some brand value set (any value)
  const brandIsSet = await countContacts([
    { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' },
    { propertyName: 'brand',                operator: 'HAS_PROPERTY' },
  ]);

  return NextResponse.json({
    connected: true,
    totalMarketable,
    brandProperty: brandProp ? { label: brandProp.label, type: brandProp.type, fieldType: brandProp.fieldType, options: brandProp.options } : null,
    perBrandValue,
    brandNotSet,
    brandIsSet,
    reconciliation: {
      sumOfBrandValues: Object.values(perBrandValue).reduce((a, b) => a + b, 0),
      brandIsSetPlusNotSet: brandIsSet + brandNotSet,
      shouldEqualTotal: totalMarketable,
    },
  });
}
