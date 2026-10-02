/**
 * GET /api/brand-age-debug
 *
 * TEMPORARY diagnostic — checks the `brand` checkbox breakdown from a
 * different angle: contact creation date, not the Brand property itself.
 * Hypothesis: Pascal Press is the oldest business unit, so if the Brand
 * tagging process was only set up at some point (e.g. when ETZ/EHC
 * launched and needed brand-based segmentation), PP's oldest contacts
 * might predate it and sit in the "no brand tagged" bucket — which would
 * mean PP's real count is undercounted, not that PP is genuinely smaller.
 *
 * Delete once this is confirmed or ruled out.
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

  const MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' };
  const NO_BRAND = { propertyName: 'brand', operator: 'NOT_HAS_PROPERTY' };

  // Year buckets for createdate (AEST-ish, using UTC year boundaries which is close enough for this check)
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
  const yearRanges = years.slice(0, -1).map((y, i) => ({
    label: `${y}`,
    gte: Date.UTC(y, 0, 1),
    lt: Date.UTC(years[i + 1]!, 0, 1),
  }));

  // 1. No-brand contacts by creation year
  const noBrandByYear: Record<string, number> = {};
  for (const r of yearRanges) {
    noBrandByYear[r.label] = await throttled([
      MARKETABLE, NO_BRAND,
      { propertyName: 'createdate', operator: 'GTE', value: String(r.gte) },
      { propertyName: 'createdate', operator: 'LT',  value: String(r.lt) },
    ]);
  }

  // 2. For comparison: PP-tagged (any) contacts by creation year
  const ppByYear: Record<string, number> = {};
  for (const r of yearRanges) {
    ppByYear[r.label] = await throttled([
      MARKETABLE,
      { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Pascal Press' },
      { propertyName: 'createdate', operator: 'GTE', value: String(r.gte) },
      { propertyName: 'createdate', operator: 'LT',  value: String(r.lt) },
    ]);
  }

  // 3. ETZ-tagged (any) contacts by creation year, for contrast
  const etzByYear: Record<string, number> = {};
  for (const r of yearRanges) {
    etzByYear[r.label] = await throttled([
      MARKETABLE,
      { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: 'Excel Test Zone' },
      { propertyName: 'createdate', operator: 'GTE', value: String(r.gte) },
      { propertyName: 'createdate', operator: 'LT',  value: String(r.lt) },
    ]);
  }

  // 4. Overall earliest createdate per brand (sanity check on "PP is the oldest brand")
  async function earliestCreateDate(extraFilter: object | null): Promise<string | null> {
    const filters: object[] = [MARKETABLE];
    if (extraFilter) filters.push(extraFilter);
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({
          filterGroups: [{ filters }],
          sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
          properties: ['createdate'],
          limit: 1,
        }),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const json = await res.json() as { results: Array<{ properties: { createdate?: string } }> };
      return json.results[0]?.properties.createdate ?? null;
    } catch { return null; }
  }

  const contains = (value: string) => ({ propertyName: 'brand', operator: 'CONTAINS_TOKEN', value });

  const earliest = {
    overallAny:    await earliestCreateDate(null).then(async d => { await sleep(150); return d; }),
    noBrandTagged: await earliestCreateDate(NO_BRAND).then(async d => { await sleep(150); return d; }),
    pascalPress:   await earliestCreateDate(contains('Pascal Press')).then(async d => { await sleep(150); return d; }),
    excelTestZone: await earliestCreateDate(contains('Excel Test Zone')).then(async d => { await sleep(150); return d; }),
    blake:         await earliestCreateDate(contains('Blake Education')).then(async d => { await sleep(150); return d; }),
    ehc:           await earliestCreateDate(contains('Excel HSC Copilot')).then(async d => { await sleep(150); return d; }),
  };

  return NextResponse.json({ connected: true, noBrandByYear, ppByYear, etzByYear, earliest });
}
