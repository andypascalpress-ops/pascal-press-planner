/**
 * GET /api/etz-trial-funnel?month=YYYY-MM[&prospectsOnly=true]
 *
 * Counts ETZ free trials the same way the team does manually in HubSpot:
 *   Deals → Excel Test Zone pipeline → Amount = $0 → created this month
 *
 * Free trial deals always have amount = $0.
 * When a trial converts, the deal amount is updated (> $0) so it falls out of this filter.
 * This is simpler and more accurate than tracking stage changes.
 *
 * prospectsOnly=true: additionally fetches hs_analytics_source on each deal and
 * excludes any deal where source = 'OFFLINE' (bulk school imports created via import/API).
 * Returns prospectsTrials, offlineTrials, hasSourceData alongside trialsStarted.
 *
 * trialsStarted    – $0 deals in ETZ pipeline created this month
 * currentlyOnTrial – deals in Active Trial stage right now (all-time snapshot)
 * prospectsTrials  – trialsStarted minus OFFLINE source deals (prospectsOnly=true only)
 * offlineTrials    – count of OFFLINE source deals (prospectsOnly=true only)
 * hasSourceData    – whether hs_analytics_source is populated on deals
 *
 * Required env var: HUBSPOT_CRM_TOKEN (ExcelTestZoneSync legacy app)
 */
import { NextResponse } from 'next/server';

// Cache per month-URL for 30 minutes.
export const revalidate = 1800;

const HS_BASE  = 'https://api.hubapi.com';
const delay    = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
    throw new Error(`HubSpot GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** HubSpot CRM search count with automatic 429 retry (waits 1.1 s then retries once). */
async function hsCount(filterGroups: { filters: object[] }[]): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method:  'POST',
      headers: hsHeaders(),
      body:    JSON.stringify({ filterGroups, limit: 1, properties: ['dealstage'] }),
      cache:   'no-store',
    });
    if (res.status === 429) {
      if (attempt === 0) { await delay(1100); continue; }
      const body = await res.text().catch(() => '');
      throw new Error(`HubSpot search → 429 (rate limit): ${body.slice(0, 200)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HubSpot search → ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    return (json.total as number) ?? 0;
  }
  return 0;
}

/** Fetch all deals matching filter, returning selected properties. Used for prospectsOnly mode. */
async function hsFetchAllDeals(
  filterGroups: { filters: object[] }[],
  properties: string[],
): Promise<Record<string, string | null>[]> {
  const results: Record<string, string | null>[] = [];
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = { filterGroups, properties, limit: 100 };
    if (after) body.after = after;

    let res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST', headers: hsHeaders(),
      body: JSON.stringify(body), cache: 'no-store',
    });
    if (res.status === 429) {
      await delay(1100);
      res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
        method: 'POST', headers: hsHeaders(),
        body: JSON.stringify(body), cache: 'no-store',
      });
    }
    if (!res.ok) {
      const body2 = await res.text().catch(() => '');
      throw new Error(`HubSpot search → ${res.status}: ${body2.slice(0, 200)}`);
    }

    const json = await res.json();
    for (const r of (json.results ?? [])) results.push(r.properties ?? {});
    after = json.paging?.next?.after as string | undefined;
    if (after) await delay(250);
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

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prospectsOnly = searchParams.get('prospectsOnly') === 'true';

  try {
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    // ── 1. Discover ETZ pipeline ──────────────────────────────────────────
    const pipelinesData = await hsGet('/crm/v3/pipelines/deals');
    const pipelines = (pipelinesData.results ?? []) as Array<{
      id: string; label: string;
      stages: Array<{ id: string; label: string }>;
    }>;

    const etzPipeline = pipelines.find(p => p.label.toLowerCase().includes('etz'));
    if (!etzPipeline) {
      return NextResponse.json({
        error: 'ETZ pipeline not found',
        availablePipelines: pipelines.map(p => p.label),
      }, { status: 404 });
    }

    const trialStage = etzPipeline.stages.find(s =>
      s.label.toLowerCase().includes('active trial') || s.label.toLowerCase() === 'trial'
    );
    const paidStage = etzPipeline.stages.find(s =>
      s.label.toLowerCase().includes('active paid') || s.label.toLowerCase() === 'paid'
    );

    // ── 2. Date range ─────────────────────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);
    const thisMonthFilters = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
      { propertyName: 'pipeline',   operator: 'EQ',  value: etzPipeline.id  },
      { propertyName: 'amount',     operator: 'EQ',  value: '0'             },
    ];

    // ── 3. Currently on trial (shared between both modes) ─────────────────
    // Fetch after main count to spread out HubSpot API calls.

    // ── 4a. Fast count mode (default — no prospectsOnly param) ───────────
    if (!prospectsOnly) {
      const trialsStarted = await hsCount([{ filters: thisMonthFilters }]);
      await delay(300);

      const currentlyOnTrial = trialStage
        ? await hsCount([{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] }])
        : 0;

      return NextResponse.json({
        month,
        trialsStarted,
        currentlyOnTrial,
        _meta: {
          pipeline:     etzPipeline.label,
          pipelineId:   etzPipeline.id,
          trialStage:   trialStage?.label  ?? null,
          trialStageId: trialStage?.id     ?? null,
          paidStage:    paidStage?.label   ?? null,
          paidStageId:  paidStage?.id      ?? null,
          method:       'amount=0 in ETZ pipeline (matches team manual check)',
        },
      });
    }

    // ── 4b. Prospects mode: fetch deals with source properties ────────────
    // Fetches all $0 ETZ deals for the month with hs_analytics_source,
    // then excludes OFFLINE deals (school bulk imports) in code.
    const deals = await hsFetchAllDeals(
      [{ filters: thisMonthFilters }],
      ['hs_analytics_source', 'hs_latest_source'],
    );

    const trialsStarted = deals.length;
    let offlineTrials = 0;
    let hasSourceData = false;

    for (const deal of deals) {
      // Prefer hs_analytics_source (first touch), fall back to latest
      const src = deal['hs_analytics_source'] || deal['hs_latest_source'];
      if (src) hasSourceData = true;
      if (src === 'OFFLINE') offlineTrials++;
    }

    // If source data isn't on deals at all, don't subtract anything
    // (all deals show as no-source, not OFFLINE)
    const prospectsTrials = trialsStarted - offlineTrials;

    await delay(300);

    const currentlyOnTrial = trialStage
      ? await hsCount([{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] }])
      : 0;

    return NextResponse.json({
      month,
      trialsStarted,
      prospectsTrials,
      offlineTrials,
      hasSourceData,
      currentlyOnTrial,
      _meta: {
        pipeline:     etzPipeline.label,
        pipelineId:   etzPipeline.id,
        trialStage:   trialStage?.label  ?? null,
        trialStageId: trialStage?.id     ?? null,
        paidStage:    paidStage?.label   ?? null,
        paidStageId:  paidStage?.id      ?? null,
        method:       'prospectsOnly: amount=0 ETZ deals, OFFLINE source excluded',
        note: hasSourceData
          ? `${offlineTrials} OFFLINE (school import) deals excluded — ${prospectsTrials} genuine prospects`
          : 'Source data not on deals — showing all $0 trials (no OFFLINE filtering applied). Consider a HubSpot workflow to copy hs_analytics_source from Contact to Deal.',
      },
    });

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
