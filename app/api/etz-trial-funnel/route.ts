/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * HubSpot trial counts for the ETZ funnel:
 *
 *  trialsStarted    – new deals in the ETZ pipeline this month across BOTH
 *                     Active Trial AND Active Paid stages (OR query).
 *                     A deal starts in Active Trial; if it converts it moves
 *                     to Active Paid. Counting both stages by createdate gives
 *                     us every trial that began this month regardless of where
 *                     it ended up.
 *
 *  currentlyOnTrial – deals sitting in Active Trial right now (all-time snapshot).
 *
 * NOTE: hs_date_entered_[stageId] is NOT filterable via the CRM search API —
 * that syntax only works in HubSpot's report builder. We use createdate instead.
 *
 * Conversion rate is computed in the UI: Stripe totalOrders ÷ trialsStarted.
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

/**
 * Count deals matching ANY of the supplied filter groups (OR between groups,
 * AND within each group). Returns total from HubSpot's paginated response.
 */
async function hsSearchCountOr(filterGroups: { filters: object[] }[]): Promise<number> {
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
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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

    // ── 3. Trials started this month ──────────────────────────────────────
    // Count deals created this month in Active Trial OR Active Paid.
    // A trial deal starts in Active Trial; converting moves it to Active Paid.
    // Counting both by createdate captures every trial regardless of outcome.
    //
    // Uses filterGroups (OR between groups) rather than a single AND block.
    const trialGroups: { filters: object[] }[] = [
      { filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ];
    if (paidStage) {
      trialGroups.push(
        { filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id }] },
      );
    }

    const trialsStarted = await hsSearchCountOr(trialGroups);
    await delay(300);

    // ── 4. Currently on trial (all-time snapshot) ─────────────────────────
    const currentlyOnTrial = await hsSearchCountOr([
      { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ]);

    return NextResponse.json({
      month,
      _meta: {
        pipeline:     etzPipeline.label,
        trialStage:   trialStage.label,
        trialStageId: trialStage.id,
        paidStage:    paidStage?.label ?? null,
        paidStageId:  paidStage?.id    ?? null,
      },
      trialsStarted,    // new deals in ETZ pipeline this month (trial + paid stages)
      currentlyOnTrial, // in Active Trial right now
    });

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
