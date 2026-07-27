/**
 * GET /api/etz-trial-funnel
 * Pulls ETZ free-trial → paid conversion data from HubSpot.
 * Fetches the dashboard reports (ID 12580086) and also queries
 * contacts/deals filtered by lifecycle stage for raw funnel numbers.
 */
import { NextResponse } from 'next/server';

const HS_BASE      = 'https://api.hubapi.com';
const DASHBOARD_ID = '12580086';
const PORTAL_ID    = '20605150';

export const revalidate = 0;

function hsHeaders() {
  const key = process.env.HUBSPOT_API_KEY ?? '';
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function hsGet(path: string) {
  const res = await fetch(`${HS_BASE}${path}`, { headers: hsHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function hsPost(path: string, body: unknown) {
  const res = await fetch(`${HS_BASE}${path}`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot POST ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function GET() {
  const key = process.env.HUBSPOT_API_KEY ?? '';
  if (!key) return NextResponse.json({ error: 'HUBSPOT_API_KEY not configured' }, { status: 500 });

  try {
    // ── 1. Fetch the dashboard metadata + its reports ─────────────────────────
    const [dashboard, reports] = await Promise.allSettled([
      hsGet(`/analytics/v2/reports/dashboards/${DASHBOARD_ID}`),
      hsGet(`/analytics/v2/reports/dashboards/${DASHBOARD_ID}/reports`),
    ]);

    // ── 2. Contact lifecycle stage counts (CRM contacts API) ─────────────────
    // Free trial contacts are typically in a specific lifecycle stage or have
    // a custom property. Pull counts grouped by lifecyclestage.
    const lifecycleCounts = await hsPost('/crm/v3/objects/contacts/search', {
      filterGroups: [],
      properties: ['lifecyclestage', 'hs_lead_status'],
      limit: 0,
      aggregations: [{ type: 'TERMS', property: 'lifecyclestage' }],
    }).catch(() => null);

    // ── 3. Try fetching ETZ-specific contact properties that track trial status
    // Search for contacts with a free_trial property set
    const [trialContacts, paidContacts] = await Promise.allSettled([
      hsPost('/crm/v3/objects/contacts/search', {
        filterGroups: [{
          filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'subscriber' }],
        }],
        properties: ['email', 'lifecyclestage', 'createdate', 'hs_lead_status'],
        limit: 1,
      }),
      hsPost('/crm/v3/objects/contacts/search', {
        filterGroups: [{
          filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }],
        }],
        properties: ['email', 'lifecyclestage', 'createdate'],
        limit: 1,
      }),
    ]);

    // ── 4. Fetch contact property definitions to find trial-related fields ────
    const properties = await hsGet('/crm/v3/properties/contacts?limit=100').catch(() => null);
    const trialProps = properties?.results?.filter((p: { name: string; label: string }) =>
      p.name.toLowerCase().includes('trial') ||
      p.label.toLowerCase().includes('trial') ||
      p.name.toLowerCase().includes('free') ||
      p.label.toLowerCase().includes('free')
    ) ?? [];

    // ── 5. Deal pipeline stages (trials often tracked as deals) ──────────────
    const pipelines = await hsGet('/crm/v3/pipelines/deals').catch(() => null);

    // ── 6. Fetch report widgets from the dashboard if available ───────────────
    const reportsList = reports.status === 'fulfilled' ? reports.value : null;

    return NextResponse.json({
      dashboard:  dashboard.status === 'fulfilled' ? dashboard.value : { error: dashboard.reason?.message },
      reports:    reportsList,
      lifecycleCounts,
      trialContacts: trialContacts.status === 'fulfilled' ? { total: trialContacts.value?.total } : null,
      paidContacts:  paidContacts.status  === 'fulfilled' ? { total: paidContacts.value?.total  } : null,
      trialRelatedProperties: trialProps.map((p: { name: string; label: string; type: string }) => ({
        name: p.name, label: p.label, type: p.type,
      })),
      dealPipelines: pipelines?.results?.map((p: { id: string; label: string; stages: { id: string; label: string }[] }) => ({
        id: p.id, label: p.label,
        stages: p.stages?.map((s: { id: string; label: string }) => ({ id: s.id, label: s.label })),
      })),
    });

  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
