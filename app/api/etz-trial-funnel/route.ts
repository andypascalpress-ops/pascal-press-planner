/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * Counts ETZ free trials the same way the team does manually in HubSpot:
 *   Deals → Excel Test Zone pipeline → Amount = $0 → created this month
 *
 * Free trial deals always have amount = $0.
 * When a trial converts, the deal amount is updated (> $0) so it falls out of this filter.
 * This is simpler and more accurate than tracking stage changes.
 *
 * trialsStarted    – $0 deals in ETZ pipeline created this month
 * currentlyOnTrial – deals in Active Trial stage right now (all-time snapshot)
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

async function hsCount(filterGroups: { filters: object[] }[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ filterGroups, limit: 1, properties: ['dealstage'] }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot search → ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.total as number) ?? 0;
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
    const createdThisMonth = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ];

    // ── 3. Trials started this month ──────────────────────────────────────
    // Same logic as the team's manual check:
    //   Deals → Excel Test Zone → Amount = $0 → created this month
    // Free trials are always $0; paid conversions update the amount to > $0.
    const trialsStarted = await hsCount([{
      filters: [
        ...createdThisMonth,
        { propertyName: 'pipeline',  operator: 'EQ', value: etzPipeline.id },
        { propertyName: 'amount',    operator: 'EQ', value: '0'            },
      ],
    }]);
    await delay(300);

    // ── 4. Currently on trial (all-time snapshot) ─────────────────────────
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

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
