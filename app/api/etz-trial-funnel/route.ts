/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * Returns ETZ free-trial funnel data from HubSpot Deals using event-based
 * stage-entry timestamps — matching HubSpot's own ETZ_Trial Conversion report.
 *
 * Key insight: HubSpot stores hs_date_entered_[stageId] on every deal.
 * Filtering on THAT property (not createdate + current dealstage) gives us
 * "how many deals entered stage X during month Y" — exactly what the HubSpot
 * funnel reports track.
 *
 * Deal stages in the ETZ pipeline:
 *   "Active Trial (ETZ Pipeline Status)" → trial started
 *   "Active Paid (ETZ Pipeline Status)"  → converted to paid
 *
 * Required env var:  HUBSPOT_CRM_TOKEN  (ExcelTestZoneSync legacy app token)
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
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: hsHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Count deals matching filters. Returns total count only. */
async function hsSearchCount(filters: object[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters }],
      limit: 1,
      properties: ['dealstage'],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot deals search → ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.total as number) ?? 0;
}

/** Sum the `amount` property of matching deals (paginates up to 200). */
async function hsSearchSumAmount(filters: object[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters }],
      limit: 200,
      properties: ['amount'],
    }),
    cache: 'no-store',
  });
  if (!res.ok) return 0;
  const json = await res.json();
  const deals = (json.results ?? []) as Array<{ properties: { amount?: string } }>;
  return deals.reduce((sum, d) => sum + parseFloat(d.properties.amount ?? '0'), 0);
}

function monthToEpochRange(month: string): { startMs: number; endMs: number } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end   = new Date(Date.UTC(y!, m!, 1));
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export async function GET(request: Request) {
  const token = process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // ── 1. Discover the ETZ deal pipeline and stage IDs ────────────────────
    const pipelinesData = await hsGet('/crm/v3/pipelines/deals');
    const pipelines = (pipelinesData.results ?? []) as Array<{
      id: string; label: string;
      stages: Array<{ id: string; label: string }>;
    }>;

    const etzPipeline = pipelines.find(p =>
      p.label.toLowerCase().includes('etz')
    );

    if (!etzPipeline) {
      return NextResponse.json({
        error: 'ETZ pipeline not found',
        availablePipelines: pipelines.map(p => ({ id: p.id, label: p.label })),
      }, { status: 404 });
    }

    const trialStage = etzPipeline.stages.find(s =>
      s.label.toLowerCase().includes('active trial') ||
      s.label.toLowerCase() === 'trial'
    );
    const paidStage = etzPipeline.stages.find(s =>
      s.label.toLowerCase().includes('active paid') ||
      s.label.toLowerCase() === 'paid'
    );

    if (!trialStage || !paidStage) {
      return NextResponse.json({
        error: 'Could not find trial or paid stages',
        pipeline: { id: etzPipeline.id, label: etzPipeline.label },
        stages: etzPipeline.stages.map(s => ({ id: s.id, label: s.label })),
      }, { status: 404 });
    }

    // ── 2. Date range ─────────────────────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);

    // HubSpot stores hs_date_entered_[stageId] per deal — this is the
    // event-based timestamp HubSpot's funnel reports filter on.
    const enteredTrialThisMonth = [
      { propertyName: `hs_date_entered_${trialStage.id}`, operator: 'GTE', value: String(startMs) },
      { propertyName: `hs_date_entered_${trialStage.id}`, operator: 'LT',  value: String(endMs)   },
    ];
    const enteredPaidThisMonth = [
      { propertyName: `hs_date_entered_${paidStage.id}`, operator: 'GTE', value: String(startMs) },
      { propertyName: `hs_date_entered_${paidStage.id}`, operator: 'LT',  value: String(endMs)   },
    ];

    // ── 3. Counts — sequential to respect HubSpot rate limits ─────────────

    // This month: deals that ENTERED Active Trial stage (event-based — matches HubSpot)
    const trialsEnteredThisMonth = await hsSearchCount(enteredTrialThisMonth);
    await delay(300);

    // This month: deals that ENTERED Active Paid stage (converted this month)
    const convertedThisMonth = await hsSearchCount(enteredPaidThisMonth);
    await delay(300);

    // This month: deal revenue from conversions (sum of amount on paid deals)
    const revenueThisMonth = await hsSearchSumAmount(enteredPaidThisMonth);
    await delay(300);

    // All time: currently in Active Trial stage right now
    const totalOnTrial = await hsSearchCount([
      { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id },
    ]);
    await delay(300);

    // All time: currently in Active Paid stage
    const totalConverted = await hsSearchCount([
      { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id },
    ]);

    // ── 4. Derived metrics ────────────────────────────────────────────────
    // Conversion rate: of deals that entered trial this month, how many converted?
    // Note: some conversions may have entered trial in a prior month, so this is
    // an approximation — but it matches what HubSpot's funnel report shows.
    const convRateMonth = trialsEnteredThisMonth > 0
      ? convertedThisMonth / trialsEnteredThisMonth
      : null;

    return NextResponse.json({
      month,
      _meta: {
        pipeline:      etzPipeline.label,
        pipelineId:    etzPipeline.id,
        trialStage:    trialStage.label,
        trialStageId:  trialStage.id,
        paidStage:     paidStage.label,
        paidStageId:   paidStage.id,
      },
      thisMonth: {
        trialsStarted:  trialsEnteredThisMonth,  // deals that entered Active Trial this month
        converted:      convertedThisMonth,       // deals that entered Active Paid this month
        conversionRate: convRateMonth,            // 0–1, approx (matches HubSpot funnel report)
        revenue:        revenueThisMonth,         // AUD sum of converted deal amounts
      },
      allTime: {
        onTrial:   totalOnTrial,    // deals currently in Active Trial
        converted: totalConverted,  // deals currently in Active Paid
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
