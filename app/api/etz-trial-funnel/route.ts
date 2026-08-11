/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * Returns ETZ free-trial funnel data from HubSpot Deals:
 *  - Trials started this month  (deals created in the ETZ pipeline this month)
 *  - Converted this month       (deals in "Active Paid" stage created this month)
 *  - All-time: currently on trial, converted, total
 *
 * The ETZ pipeline tracks test-pack trials. Deal stages:
 *   "Active Trial (ETZ Pipeline Status)" → currently trialling
 *   "Active Paid (ETZ Pipeline Status)"  → converted to paid
 *
 * Required env var:  HUBSPOT_CRM_TOKEN  (ExcelTestZoneSync legacy app token)
 *                    Must have crm.objects.deals.read scope.
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

async function hsSearchDeals(filters: object[]): Promise<number> {
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
    const createdThisMonth = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ];
    const inEtzPipeline = { propertyName: 'pipeline', operator: 'EQ', value: etzPipeline.id };

    // ── 3. Counts — sequential to respect HubSpot rate limits ─────────────
    // This month: new deals that started in Active Trial stage
    // (matches HubSpot's ETZ_Trial Conversion report which counts entries into that stage)
    const signupsThisMonth = await hsSearchDeals([
      ...createdThisMonth,
      { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id },
    ]);
    await delay(300);

    // This month: new Active Paid deals (includes direct purchases + trial conversions)
    const paidThisMonth = await hsSearchDeals([
      ...createdThisMonth,
      { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id },
    ]);
    await delay(300);

    // All time: currently on trial (Active Trial stage)
    const totalOnTrial = await hsSearchDeals([
      { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id },
    ]);
    await delay(300);

    // All time: converted to paid (Active Paid stage)
    const totalConverted = await hsSearchDeals([
      { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id },
    ]);

    // All-time total = known stages only (avoids unreliable full-pipeline count)
    const totalAll = totalOnTrial + totalConverted;

    // ── 4. Derived metrics ────────────────────────────────────────────────
    // This month conversion: paidThisMonth / (signupsThisMonth + paidThisMonth)
    // paidThisMonth may include direct purchases, but it's the closest proxy available
    const totalNewThisMonth = signupsThisMonth + paidThisMonth;
    const convRateMonth     = totalNewThisMonth > 0 ? paidThisMonth / totalNewThisMonth : null;
    const convRateAllTime   = totalAll > 0 ? totalConverted / totalAll : null;

    return NextResponse.json({
      month,
      _meta: {
        pipeline:        etzPipeline.label,
        pipelineId:      etzPipeline.id,
        trialStage:      trialStage.label,
        trialStageId:    trialStage.id,
        paidStage:       paidStage.label,
        paidStageId:     paidStage.id,
      },
      thisMonth: {
        signups:        signupsThisMonth,   // new Active Trial deals created this month
        converted:      paidThisMonth,      // new Active Paid deals created this month
        conversionRate: convRateMonth,      // 0–1
      },
      allTime: {
        total:          totalAll,           // onTrial + converted (known stages only)
        onTrial:        totalOnTrial,
        converted:      totalConverted,
        conversionRate: convRateAllTime,    // converted ÷ (onTrial + converted)
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
