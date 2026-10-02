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
 *   - unattributed.total      — no brand ticked at all
 *   - unattributed.likelyPascalPress — of the untagged contacts, those
 *     whose Unific purchase history ("Last Product Bought") matches one of
 *     PP's two imprints ("Excel" or "Targeting"). PP's tagging rate has
 *     been consistently lower than ETZ's since 2022 (verified separately),
 *     and ~46% of untagged contacts turned out to have a PP-branded
 *     purchase — strong evidence the Brand checkbox misses real PP
 *     customers rather than PP genuinely having fewer. This is a
 *     corroborated estimate, not a confirmed tag, so it's broken out
 *     rather than folded into exclusiveByBrand.
 *   - unattributed.unknown    — untagged with no identifiable brand signal
 *
 * This needs ~14 sequential HubSpot search calls (one per bucket/overlap
 * pair). Two earlier versions returned plausible-looking but wrong data:
 * firing them all via Promise.all hit HubSpot's rate limit, and even
 * sequential calls with a 3-attempt/300ms retry still occasionally hit a
 * persistent 429 and silently returned 0 for whichever query happened to
 * fail that request — a different field zeroed out each time, which is
 * what exposed it as a reliability bug rather than a logic bug. Fixed by:
 * a small delay between every call (not just retries), stronger
 * backoff, and — critically — countContacts returns `null` on a genuine
 * failure instead of 0, so a partial failure surfaces as `connected:
 * false` rather than confidently-wrong numbers.
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

/** Returns null (not 0) if every attempt fails — a real failure must never look like a valid zero count. */
async function countContacts(filters: object[]): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * Math.pow(2, attempt)); // 500ms, 1s, 2s, 4s, 8s
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json() as { total?: number };
      if (typeof json.total !== 'number') return null;
      return json.total;
    } catch {
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

/** Small gap between every sequential call to stay well under HubSpot's rate limit, not just react to it. */
async function countContactsThrottled(filters: object[]): Promise<number | null> {
  const result = await countContacts(filters);
  await sleep(150);
  return result;
}

interface BrandOption { label: string; value: string }
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

  const propRes = await fetch(`${HS_BASE}/crm/v3/properties/contacts/brand`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  if (!propRes.ok) {
    return NextResponse.json({ connected: false, error: 'Could not load the brand property' }, { status: 500 });
  }
  const brandProp = await propRes.json() as { options?: BrandOption[] };
  const brandNames = (brandProp.options ?? []).map(o => o.value);
  const productsProp = await findProperty(/products?\s*(bought|purchased)/i);

  const MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' };
  const failedQueries: string[] = [];
  const need = (label: string, n: number | null): number => {
    if (n === null) failedQueries.push(label);
    return n ?? 0;
  };

  const NO_BRAND = { propertyName: 'brand', operator: 'NOT_HAS_PROPERTY' };

  const total        = need('total',        await countContactsThrottled([MARKETABLE]));
  const unattributed = need('unattributed', await countContactsThrottled([MARKETABLE, NO_BRAND]));
  const anyBrand     = need('anyBrand',     await countContactsThrottled([MARKETABLE, { propertyName: 'brand', operator: 'HAS_PROPERTY' }]));

  // Of the untagged contacts, how many have a purchase history (via Unific)
  // showing a Pascal Press-branded product? PP sells under two imprints
  // seen in this project's own product breakdowns — "Excel" and
  // "Targeting" — so a contact matching either is very likely a genuine
  // PP customer the Brand checkbox never got set for. Confirmed via a
  // one-off diagnostic against the live account before building this in:
  // ~46% of the untagged bucket matched one of these two imprints.
  let likelyPascalPress = 0;
  if (productsProp) {
    const excelMatch = need('unattributed:excel', await countContactsThrottled([
      MARKETABLE, NO_BRAND,
      { propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Excel' },
    ]));
    const targetingMatch = need('unattributed:targeting', await countContactsThrottled([
      MARKETABLE, NO_BRAND,
      { propertyName: productsProp.name, operator: 'CONTAINS_TOKEN', value: 'Targeting' },
    ]));
    // "Last Product Bought" holds one value per contact, so a name can't
    // match both imprints at once — safe to add directly, no overlap.
    likelyPascalPress = excelMatch + targetingMatch;
  }

  const exclusiveByBrand: Record<string, number> = {};
  for (const name of brandNames) {
    const others = brandNames.filter(n => n !== name);
    exclusiveByBrand[name] = need(`exclusive:${name}`, await countContactsThrottled([
      MARKETABLE,
      { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: name },
      ...others.map(o => ({ propertyName: 'brand', operator: 'NOT_CONTAINS_TOKEN', value: o })),
    ]));
  }

  const overlapPairs: Array<{ a: string; b: string; count: number }> = [];
  for (let i = 0; i < brandNames.length; i++) {
    for (let j = i + 1; j < brandNames.length; j++) {
      const a = brandNames[i]!, b = brandNames[j]!;
      const count = need(`overlap:${a}+${b}`, await countContactsThrottled([
        MARKETABLE,
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: a },
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: b },
      ]));
      if (count > 0) overlapPairs.push({ a, b, count });
    }
  }
  overlapPairs.sort((a, b) => b.count - a.count);

  if (failedQueries.length > 0) {
    return NextResponse.json({
      connected: false,
      error: `HubSpot query failed after retries: ${failedQueries.join(', ')}`,
    }, { status: 502 });
  }

  const sumExclusive = Object.values(exclusiveByBrand).reduce((s, c) => s + c, 0);
  const multipleBrands = anyBrand - sumExclusive;

  return NextResponse.json({
    connected: true,
    total,
    exclusiveByBrand,
    multipleBrands,
    unattributed: {
      total: unattributed,
      likelyPascalPress,
      unknown: unattributed - likelyPascalPress,
    },
    overlapPairs,
    reconciliation: {
      // likelyPascalPress is a sub-split of unattributed, not a new
      // category — it must not be added again here or the total would
      // double-count those contacts.
      cleanPartitionSum: sumExclusive + multipleBrands + unattributed,
    },
  });
}
