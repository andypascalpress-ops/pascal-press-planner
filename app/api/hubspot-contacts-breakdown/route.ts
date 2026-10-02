/**
 * GET /api/hubspot-contacts-breakdown
 *
 * Breaks down HubSpot's total marketing contacts (hs_marketable_status=true)
 * by business unit, using the `brand` contact property.
 *
 * `brand` is a multi-select checkbox, not a single dropdown — a contact can
 * be tagged with more than one business unit (e.g. a customer who bought
 * from both Pascal Press and Excel Test Zone). That means there's no
 * "clean" single-brand split without either (a) picking an arbitrary
 * priority rule for overlapping contacts, or (b) reporting the overlap as
 * its own category. This route does (b), which is the only version that's
 * both honest and reconciles exactly back to the total — verified by
 * `reconciliation.cleanPartitionSum === total` below.
 *
 * Buckets:
 *   - exclusiveByBrand[brand] — tagged with that brand and no other
 *   - multipleBrands          — tagged with 2+ brands
 *   - unattributed            — no brand ticked at all
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
    if (!res.ok) return 0;
    const json = await res.json() as { total: number };
    return json.total ?? 0;
  } catch { return 0; }
}

interface BrandOption { label: string; value: string }

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const propRes = await fetch(`${HS_BASE}/crm/v3/properties/contacts/brand`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  if (!propRes.ok) {
    return NextResponse.json({ connected: false, error: 'Could not load the brand property' }, { status: 500 });
  }
  const brandProp = await propRes.json() as { options?: BrandOption[] };
  const brandNames = (brandProp.options ?? []).map(o => o.value);

  const MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' };

  const [total, unattributed, anyBrand, exclusiveEntries, overlapEntries] = await Promise.all([
    countContacts([MARKETABLE]),
    countContacts([MARKETABLE, { propertyName: 'brand', operator: 'NOT_HAS_PROPERTY' }]),
    countContacts([MARKETABLE, { propertyName: 'brand', operator: 'HAS_PROPERTY' }]),
    Promise.all(brandNames.map(async name => {
      const others = brandNames.filter(n => n !== name);
      const count = await countContacts([
        MARKETABLE,
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: name },
        ...others.map(o => ({ propertyName: 'brand', operator: 'NOT_CONTAINS_TOKEN', value: o })),
      ]);
      return [name, count] as const;
    })),
    Promise.all(
      brandNames.flatMap((a, i) => brandNames.slice(i + 1).map(b => [a, b] as const))
        .map(async ([a, b]) => {
          const count = await countContacts([
            MARKETABLE,
            { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: a },
            { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: b },
          ]);
          return { a, b, count };
        }),
    ),
  ]);

  const exclusiveByBrand = Object.fromEntries(exclusiveEntries);
  const sumExclusive = exclusiveEntries.reduce((s, [, c]) => s + c, 0);
  const multipleBrands = anyBrand - sumExclusive;

  return NextResponse.json({
    connected: true,
    total,
    exclusiveByBrand,
    multipleBrands,
    unattributed,
    overlapPairs: overlapEntries.filter(o => o.count > 0).sort((a, b) => b.count - a.count),
    reconciliation: {
      cleanPartitionSum: sumExclusive + multipleBrands + unattributed,
    },
  });
}
