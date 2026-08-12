/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * HubSpot trial counts for the ETZ funnel:
 *
 *  trialsStarted    – deals that STARTED as a free trial this month:
 *                     = (Active Trial created this month, still on trial)
 *                     + (Active Paid created this month that passed through Active Trial)
 *
 *                     The second bucket uses hs_date_entered_[trialStageId] returned
 *                     as a property (not a filter — filtering on it returns 400).
 *                     Deals created directly in Active Paid (direct purchases, no trial)
 *                     will have that property null and are correctly excluded.
 *
 *  currentlyOnTrial – deals sitting in Active Trial right now (all-time snapshot).
 *
 * Required env var: HUBSPOT_CRM_TOKEN (ExcelTestZoneSync legacy app)
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
    throw new Error(`HubSpot GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Count-only search (limit:1 just to get .total). */
async function hsCount(filterGroups: { filters: object[] }[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ filterGroups, limit: 1, properties: ['dealstage'] }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot deals search → ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.total as number) ?? 0;
}

/**
 * Fetch ALL deals matching filterGroups, paginating until done.
 * Returns the raw properties object for each deal.
 */
async function hsFetchAll(
  filterGroups: { filters: object[] }[],
  properties: string[],
  delay: (ms: number) => Promise<void>,
): Promise<Record<string, string | null>[]> {
  const results: Record<string, string | null>[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = { filterGroups, properties, limit: 100 };
    if (after) body.after = after;

    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HubSpot deals search → ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();

    for (const r of (json.results ?? [])) {
      results.push(r.properties ?? {});
    }

    after = json.paging?.next?.after as string | undefined;
    if (after) await delay(300); // respect rate limits between pages
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

  try {
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    // ── 1. Discover ETZ pipeline + stage IDs ──────────────────────────────
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

    if (!trialStage) {
      return NextResponse.json({
        error: 'Active Trial stage not found',
        stages: etzPipeline.stages.map(s => s.label),
      }, { status: 404 });
    }

    // ── 2. Date range ─────────────────────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);
    const createdThisMonth = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ];

    // ── 3a. Deals still in Active Trial, created this month ───────────────
    const onTrialCount = await hsCount([
      { filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ]);
    await delay(300);

    // ── 3b. Deals now in Active Paid, created this month ─────────────────
    // Fetch all of them and check which ones have hs_date_entered_[trialStageId]
    // set (meaning they actually went through the trial stage first).
    // Deals created directly in Active Paid (direct purchases) will have null there.
    let convertedTrialsCount = 0;
    if (paidStage) {
      const trialEnteredProp = `hs_date_entered_${trialStage.id}`;
      const paidDeals = await hsFetchAll(
        [{ filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id }] }],
        [trialEnteredProp, 'dealstage', 'createdate'],
        delay,
      );
      convertedTrialsCount = paidDeals.filter(p => {
        const v = p[trialEnteredProp];
        return v != null && v !== '';
      }).length;
      await delay(300);
    }

    const trialsStarted = onTrialCount + convertedTrialsCount;

    // ── 4. Currently on trial (all-time snapshot) ─────────────────────────
    const currentlyOnTrial = await hsCount([
      { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ]);

    return NextResponse.json({
      month,
      _meta: {
        pipeline:            etzPipeline.label,
        trialStage:          trialStage.label,
        trialStageId:        trialStage.id,
        paidStage:           paidStage?.label ?? null,
        paidStageId:         paidStage?.id    ?? null,
        onTrialCount,
        convertedTrialsCount,
      },
      trialsStarted,
      currentlyOnTrial,
    });

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
