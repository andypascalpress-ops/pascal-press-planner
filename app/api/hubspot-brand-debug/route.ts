/**
 * GET /api/hubspot-brand-debug
 *
 * Diagnostic endpoint to inspect HubSpot account structure for brand segmentation.
 * Returns STRUCTURAL data only (no PII — no contact records, no email addresses):
 *   1. Email subscription type definitions (each brand may have its own list)
 *   2. Contact property names/labels that may indicate brand (filtered list, no values)
 *   3. Counts of contacts per unique value for candidate brand properties
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

/**
 * Count contacts where a given property equals a specific value.
 * Returns a count only — no contact data.
 */
async function countContactsByProp(propertyName: string, value: string): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: hsHeaders(),
    cache: 'no-store',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value }] }],
      limit: 1,
      properties: ['createdate'],
    }),
  });
  if (!res.ok) return -1;
  const json = await res.json();
  return json.total ?? 0;
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const [subscriptionDefs, contactProps] = await Promise.allSettled([
    // 1. Email subscription types — if each brand has its own, we can count per-type
    hsGet('/communication-preferences/v3/definitions'),

    // 2. All contact properties — filter to custom ones that might indicate brand
    hsGet('/crm/v3/properties/contacts?limit=500'),
  ]);

  // Extract just property names/labels (no values) for brand-relevant properties
  const BRAND_KEYWORDS = ['brand', 'product', 'source', 'site', 'website', 'domain', 'store', 'list', 'signup'];
  let customProps: { name: string; label: string; type: string; groupName: string; options?: { label: string; value: string }[] }[] = [];
  if (contactProps.status === 'fulfilled' && !('error' in contactProps.value)) {
    const props = (contactProps.value.results ?? []) as {
      name: string; label: string; type: string; groupName: string; calculated: boolean;
      options?: { label: string; value: string }[];
    }[];
    customProps = props.filter(p =>
      !p.calculated &&
      BRAND_KEYWORDS.some(kw => p.name.toLowerCase().includes(kw) || p.label.toLowerCase().includes(kw))
    ).map(({ name, label, type, groupName, options }) => ({
      name, label, type, groupName,
      ...(options?.length ? { options: options.map(o => ({ label: o.label, value: o.value })) } : {}),
    }));
  }

  // Check counts for known brand-value candidates (structural counts only, no PII)
  const brandCandidates = ['pascal press', 'excel test zone', 'etz', 'hsc', 'blake', 'pp'];
  const propCandidates = customProps.filter(p => p.type === 'enumeration' || p.type === 'string').slice(0, 3);

  const candidateCounts: Record<string, Record<string, number>> = {};
  for (const prop of propCandidates) {
    candidateCounts[prop.name] = {};
    for (const val of brandCandidates) {
      const count = await countContactsByProp(prop.name, val);
      if (count > 0) candidateCounts[prop.name]![val] = count;
    }
  }

  return NextResponse.json({
    subscriptionDefs: subscriptionDefs.status === 'fulfilled'
      ? subscriptionDefs.value
      : { error: (subscriptionDefs as PromiseRejectedResult).reason?.message },
    brandRelatedProperties: customProps,
    candidateCounts,
  });
}
