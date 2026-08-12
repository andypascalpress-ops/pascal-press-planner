/**
 * GET /api/etz-sources?month=YYYY-MM
 *
 * Returns a breakdown of ETZ free trials by traffic source.
 *
 * Method: fetch all $0 ETZ pipeline deals for the month (paginated),
 * return hs_analytics_source, hs_latest_source, utm_source on each deal.
 * Groups by source and returns ranked list.
 *
 * Note: HubSpot source properties live on Contacts, not Deals. This endpoint
 * checks whether ETZ's HubSpot configuration syncs them to deals (via workflow).
 * If deals have empty source props, the _meta.sourceQuality flag will say so.
 */
import { NextResponse } from 'next/server';

// Cache for 30 minutes — historical months don't change; current month acceptable
export const revalidate = 1800;

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function hsGet(path: string) {
  const res = await fetch(`${HS_BASE}${path}`, { headers: hsHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`HubSpot GET ${path} → ${res.status}`);
  return res.json();
}

async function hsFetchAllDeals(
  filterGroups: { filters: object[] }[],
  properties: string[],
  wait: (ms: number) => Promise<void>,
): Promise<Record<string, string | null>[]> {
  const results: Record<string, string | null>[] = [];
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = { filterGroups, properties, limit: 100 };
    if (after) body.after = after;

    // 429 retry: wait 1.1 s and retry once before giving up
    let res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST', headers: hsHeaders(),
      body: JSON.stringify(body), cache: 'no-store',
    });
    if (res.status === 429) {
      await wait(1100);
      res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
        method: 'POST', headers: hsHeaders(),
        body: JSON.stringify(body), cache: 'no-store',
      });
    }
    if (!res.ok) throw new Error(`HubSpot search → ${res.status}`);

    const json = await res.json();
    for (const r of (json.results ?? [])) results.push(r.properties ?? {});
    after = json.paging?.next?.after as string | undefined;
    if (after) await wait(250); // slightly longer than minimum to stay clear of the limit
  } while (after);
  return results;
}

function monthToEpochRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    startMs: new Date(Date.UTC(y!, m! - 1, 1)).getTime(),
    endMs:   new Date(Date.UTC(y!, m!,     1)).getTime(),
  };
}

// Map HubSpot source values to friendly labels
function friendlySource(raw: string | null | undefined): string {
  if (!raw || raw === 'UNKNOWN' || raw === '(not set)') return 'Unknown';
  const map: Record<string, string> = {
    'ORGANIC_SEARCH':    'Organic Search',
    'PAID_SEARCH':       'Paid Search',
    'SOCIAL_MEDIA':      'Social Media',
    'PAID_SOCIAL':       'Paid Social',
    'EMAIL_MARKETING':   'Email',
    'REFERRALS':         'Referral',
    'OTHER_CAMPAIGNS':   'Campaigns',
    'DIRECT_TRAFFIC':    'Direct',
    'OFFLINE':           'Offline',
    'ORGANIC_SOCIAL':    'Organic Social',
  };
  return map[raw] ?? raw;
}

export interface EtzSourceRow {
  source:      string;
  trials:      number;
  pct:         number;
}

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    // 1. Get ETZ pipeline ID
    const pipelinesData = await hsGet('/crm/v3/pipelines/deals');
    const pipelines = (pipelinesData.results ?? []) as Array<{ id: string; label: string }>;
    const etzPipeline = pipelines.find(p => p.label.toLowerCase().includes('etz'));
    if (!etzPipeline) return NextResponse.json({ error: 'ETZ pipeline not found' }, { status: 404 });

    // 2. Fetch all $0 ETZ deals this month with source properties
    const { startMs, endMs } = monthToEpochRange(month);
    const deals = await hsFetchAllDeals(
      [{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
          { propertyName: 'pipeline',   operator: 'EQ',  value: etzPipeline.id  },
          { propertyName: 'amount',     operator: 'EQ',  value: '0'             },
        ],
      }],
      [
        'hs_analytics_source',
        'hs_analytics_source_data_1',
        'hs_latest_source',
        'hs_latest_source_data_1',
        'utm_source',
        'utm_medium',
        'utm_campaign',
      ],
      delay,
    );

    // 3. Group by source
    const counts: Record<string, number> = {};
    let hasSourceData = false;

    for (const deal of deals) {
      // Prefer hs_analytics_source (first touch), fall back to latest, then utm_source
      const rawSource =
        deal['hs_analytics_source'] ||
        deal['hs_latest_source']    ||
        deal['utm_source']          ||
        null;

      if (rawSource) hasSourceData = true;
      const label = friendlySource(rawSource);
      counts[label] = (counts[label] ?? 0) + 1;
    }

    const total = deals.length;
    const rows: EtzSourceRow[] = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([source, trials]) => ({
        source,
        trials,
        pct: total > 0 ? Math.round((trials / total) * 100) : 0,
      }));

    return NextResponse.json({
      month,
      total,
      rows,
      _meta: {
        pipeline:        etzPipeline.label,
        dealsInspected:  deals.length,
        hasSourceData,
        note: hasSourceData
          ? 'Source data found on deals — attribution is direct.'
          : 'No source properties on deals. HubSpot source data lives on Contacts; consider a workflow to copy it to deals.',
      },
    });

  } catch (e) {
    console.error('[etz-sources]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
