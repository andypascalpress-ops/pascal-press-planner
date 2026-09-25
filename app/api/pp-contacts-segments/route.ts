/**
 * GET /api/pp-contacts-segments
 *
 * Returns active marketing contact counts grouped into 6 audience segments
 * (K-2, 3-6, 7-10, 11-12, Teacher, Parent) by querying the HubSpot contact
 * property that Unific uses to record what products a contact has purchased.
 *
 * The Unific "Products Bought" property name is discovered at runtime via
 * the HubSpot Properties API so it doesn't need to be hard-coded.
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

async function hsCount(filterGroups: object[]): Promise<number> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['createdate'] }),
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const json = await res.json();
    return (json.total as number) ?? 0;
  } catch { return 0; }
}

interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
}

async function discoverUnificProperty(): Promise<HubSpotProperty | null> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/properties/contacts?limit=500`, {
      headers: hsHeaders(), cache: 'no-store',
    });
    if (!res.ok) return null;
    const { results } = await res.json() as { results: HubSpotProperty[] };

    // Look for Unific "products bought" property by label or name
    return results.find(p =>
      /products?\s*(bought|purchased)/i.test(p.label) ||
      /unific/i.test(p.label) && /product/i.test(p.label) ||
      /products?_bought/i.test(p.name) ||
      /unific.*product|product.*unific/i.test(p.name)
    ) ?? null;
  } catch { return null; }
}

const SEGMENTS = [
  {
    key: 'k2', label: 'K–2',
    tokens: ['Year 1', 'Year 2', 'Kindergarten', 'Prep', 'Foundation', 'K-2'],
  },
  {
    key: '36', label: '3–6',
    tokens: ['Year 3', 'Year 4', 'Year 5', 'Year 6'],
  },
  {
    key: '710', label: '7–10',
    tokens: ['Year 7', 'Year 8', 'Year 9', 'Year 10'],
  },
  {
    key: '1112', label: '11–12',
    tokens: ['Year 11', 'Year 12', 'HSC'],
  },
  {
    key: 'teacher', label: 'Teacher',
    tokens: ['Teacher'],
  },
  {
    key: 'parent', label: 'Parent',
    tokens: ['Parent'],
  },
] as const;

async function countBySegment(propName: string, tokens: readonly string[]): Promise<number> {
  // Each token is a separate OR filter group
  const filterGroups = tokens.map(token => ({
    filters: [
      { propertyName: propName,              operator: 'CONTAINS_TOKEN', value: token  },
      { propertyName: 'hs_marketable_status', operator: 'EQ',             value: 'true' },
    ],
  }));
  return hsCount(filterGroups);
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const productsProp = await discoverUnificProperty();

  if (!productsProp) {
    return NextResponse.json({
      connected: true,
      propertyFound: false,
      propertyName: null,
      segments: SEGMENTS.map(s => ({ key: s.key, label: s.label, active: null })),
    });
  }

  const counts = await Promise.all(
    SEGMENTS.map(seg => countBySegment(productsProp.name, seg.tokens))
  );

  const segments = SEGMENTS.map((seg, i) => ({
    key: seg.key,
    label: seg.label,
    active: counts[i] ?? 0,
  }));

  return NextResponse.json({
    connected: true,
    propertyFound: true,
    propertyName: productsProp.name,
    propertyLabel: productsProp.label,
    segments,
  });
}
