/**
 * GET /api/hubspot-brand-debug
 *
 * Diagnostic endpoint to inspect HubSpot account structure for brand segmentation.
 * Fetches:
 *   1. Email subscription type definitions (each brand may have its own list)
 *   2. Contact custom properties (looking for brand/product identifiers)
 *   3. A few sample contacts to see which properties are populated
 *
 * Not cached — remove after figuring out brand segmentation approach.
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

async function hsGet(path: string) {
  const res = await fetch(`${HS_BASE}${path}`, { headers: hsHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `${res.status}: ${body.slice(0, 300)}` };
  }
  return res.json();
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const [subscriptionDefs, contactProps, sampleContacts] = await Promise.allSettled([
    // 1. Email subscription types — if each brand has its own, we can count per-type
    hsGet('/communication-preferences/v3/definitions'),

    // 2. All contact properties — filter to custom ones that might indicate brand
    hsGet('/crm/v3/properties/contacts?limit=500'),

    // 3. Sample of 5 recent contacts with all their properties
    fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      cache: 'no-store',
      body: JSON.stringify({
        filterGroups: [],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        limit: 5,
        properties: [
          'email', 'createdate', 'lifecyclestage',
          'hs_email_optout', 'hs_email_domain',
          'brand', 'product', 'product_interest', 'associated_brand',
          'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
          'hs_latest_source', 'hs_latest_source_data_1',
          'hs_analytics_first_referrer', 'hs_analytics_last_referrer',
          'website', 'company',
        ],
      }),
    }).then(r => r.json()),
  ]);

  // Extract just the interesting contact properties (custom ones and brand-relevant ones)
  const BRAND_KEYWORDS = ['brand', 'product', 'source', 'site', 'website', 'domain', 'store', 'list'];
  let customProps: { name: string; label: string; type: string; groupName: string }[] = [];
  if (contactProps.status === 'fulfilled' && !('error' in contactProps.value)) {
    const props = (contactProps.value.results ?? []) as {
      name: string; label: string; type: string; groupName: string; calculated: boolean;
    }[];
    customProps = props.filter(p =>
      !p.calculated &&
      (BRAND_KEYWORDS.some(kw => p.name.toLowerCase().includes(kw) || p.label.toLowerCase().includes(kw)) ||
       p.groupName === 'contactinformation' && !p.name.startsWith('hs_'))
    ).map(({ name, label, type, groupName }) => ({ name, label, type, groupName }));
  }

  return NextResponse.json({
    subscriptionDefs: subscriptionDefs.status === 'fulfilled' ? subscriptionDefs.value : { error: subscriptionDefs.reason?.message },
    customBrandProps: customProps,
    sampleContacts: sampleContacts.status === 'fulfilled' ? {
      total: sampleContacts.value.total,
      results: (sampleContacts.value.results ?? []).map((c: { id: string; properties: Record<string, string | null> }) => ({
        id: c.id,
        properties: Object.fromEntries(
          Object.entries(c.properties).filter(([, v]) => v != null && v !== '')
        ),
      })),
    } : { error: (sampleContacts as PromiseRejectedResult).reason?.message },
  });
}
