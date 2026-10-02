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
 *
 * Queries run SEQUENTIALLY, not via Promise.all. An earlier version fired
 * all ~13 HubSpot search calls at once and silently got back a mix of
 * rate-limited (429) responses — countContacts swallows a failed request
 * as 0 rather than throwing, so the bug showed up as plausible-looking but
 * wrong zeros, not a visible error. Sequential calls (plus a couple of
 * retries on transient failures) cost a few extra seconds but are correct.
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countContacts(filters: object[]): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      if (!res.ok) return 0;
      const json = await res.json() as { total: number };
      return json.total ?? 0;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }
  return 0;
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

  const total        = await countContacts([MARKETABLE]);
  const unattributed = await countContacts([MARKETABLE, { propertyName: 'brand', operator: 'NOT_HAS_PROPERTY' }]);
  const anyBrand     = await countContacts([MARKETABLE, { propertyName: 'brand', operator: 'HAS_PROPERTY' }]);

  const exclusiveByBrand: Record<string, number> = {};
  for (const name of brandNames) {
    const others = brandNames.filter(n => n !== name);
    exclusiveByBrand[name] = await countContacts([
      MARKETABLE,
      { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: name },
      ...others.map(o => ({ propertyName: 'brand', operator: 'NOT_CONTAINS_TOKEN', value: o })),
    ]);
  }

  const overlapPairs: Array<{ a: string; b: string; count: number }> = [];
  for (let i = 0; i < brandNames.length; i++) {
    for (let j = i + 1; j < brandNames.length; j++) {
      const a = brandNames[i]!, b = brandNames[j]!;
      const count = await countContacts([
        MARKETABLE,
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: a },
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: b },
      ]);
      if (count > 0) overlapPairs.push({ a, b, count });
    }
  }
  overlapPairs.sort((a, b) => b.count - a.count);

  const sumExclusive = Object.values(exclusiveByBrand).reduce((s, c) => s + c, 0);
  const multipleBrands = anyBrand - sumExclusive;

  return NextResponse.json({
    connected: true,
    total,
    exclusiveByBrand,
    multipleBrands,
    unattributed,
    overlapPairs,
    reconciliation: {
      cleanPartitionSum: sumExclusive + multipleBrands + unattributed,
    },
  });
}
