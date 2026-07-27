/**
 * GET /api/etz-trial-funnel
 * Discovers where ETZ free-trial data lives in HubSpot, then returns the funnel.
 */
import { NextResponse } from 'next/server';

const HS_BASE = 'https://api.hubapi.com';
export const revalidate = 0;

function hsHeaders() {
  return { Authorization: `Bearer ${process.env.HUBSPOT_API_KEY ?? ''}`, 'Content-Type': 'application/json' };
}

async function hsGet(path: string) {
  const res = await fetch(`${HS_BASE}${path}`, { headers: hsHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function hsPost(path: string, body: unknown) {
  const res = await fetch(`${HS_BASE}${path}`, {
    method: 'POST', headers: hsHeaders(), body: JSON.stringify(body), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

// Count contacts matching a filter
async function countContacts(filters: object[]) {
  const r = await hsPost('/crm/v3/objects/contacts/search', {
    filterGroups: filters.length ? [{ filters }] : [],
    limit: 1,
    properties: ['email'],
  });
  return r.total ?? 0;
}

export async function GET() {
  if (!process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'HUBSPOT_API_KEY not configured' }, { status: 500 });
  }

  try {
    // ── 1. All contact properties (find trial-related ones) ───────────────────
    const allProps = await hsGet('/crm/v3/properties/contacts?limit=1000');
    const trialProps = (allProps.results ?? []).filter((p: { name: string; label: string }) => {
      const n = (p.name + ' ' + p.label).toLowerCase();
      return n.includes('trial') || n.includes('free') || n.includes('subscri') || n.includes('plan') || n.includes('convert');
    });

    // ── 2. Deal pipelines + stages ────────────────────────────────────────────
    const pipelines = await hsGet('/crm/v3/pipelines/deals');

    // ── 3. Count contacts by lifecycle stage ──────────────────────────────────
    const stages = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'];
    const lifecycleCounts = Object.fromEntries(
      await Promise.all(stages.map(async s => [s, await countContacts([{ propertyName: 'lifecyclestage', operator: 'EQ', value: s }]).catch(() => '?')]))
    );
    const totalContacts = await countContacts([]).catch(() => 0);

    // ── 4. If we found trial-related properties, count them ───────────────────
    const trialPropCounts: Record<string, unknown> = {};
    for (const prop of trialProps.slice(0, 10)) {
      try {
        const hasValue = await countContacts([{ propertyName: prop.name, operator: 'HAS_PROPERTY' }]);
        trialPropCounts[prop.name] = { label: prop.label, type: prop.type, contactsWithValue: hasValue };
      } catch { /* skip */ }
    }

    // ── 5. Fetch list of all contact lists (free trial lists often here) ──────
    const lists = await hsGet('/contacts/v1/lists?count=100&offset=0').catch(() => null);
    const trialLists = (lists?.lists ?? []).filter((l: { name: string }) =>
      l.name.toLowerCase().includes('trial') || l.name.toLowerCase().includes('free')
    );

    // ── 6. Reporting dashboards list ──────────────────────────────────────────
    const dashboards = await hsGet('/reporting/v2/reports?limit=50').catch(() => null);

    return NextResponse.json({
      totalContacts,
      lifecycleCounts,
      trialRelatedProperties: trialProps.map((p: { name: string; label: string; type: string }) => ({ name: p.name, label: p.label, type: p.type })),
      trialPropCounts,
      trialLists,
      dealPipelines: (pipelines.results ?? []).map((p: { id: string; label: string; stages: { id: string; label: string; displayOrder: number }[] }) => ({
        id: p.id, label: p.label,
        stages: (p.stages ?? []).sort((a: { displayOrder: number }, b: { displayOrder: number }) => a.displayOrder - b.displayOrder).map((s: { id: string; label: string }) => ({ id: s.id, label: s.label })),
      })),
      dashboards,
    });

  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
