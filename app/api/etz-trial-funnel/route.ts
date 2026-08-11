/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * Returns ETZ trial data from HubSpot Deals only:
 *  - trialsStarted: deals that ENTERED the Active Trial stage this month (event-based,
 *    matches HubSpot's ETZ_Trial Conversion report)
 *  - onTrial: deals currently sitting in Active Trial right now (all time)
 *
 * Conversion rate is calculated in the UI by dividing Stripe orders / trialsStarted,
 * since Stripe is the source of truth for actual payments.
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

async function hsSearchCount(filters: object[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ filterGroups: [{ filters }], limit: 1, properties: ['dealstage'] }),
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
    if (!trialStage) {
      return NextResponse.json({
        error: 'Active Trial stage not found',
        stages: etzPipeline.stages.map(s => s.label),
      }, { status: 404 });
    }

    // ── 2. Counts ─────────────────────────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);

    // Deals that ENTERED Active Trial this month (event-based — matches HubSpot reports)
    const trialsStarted = await hsSearchCount([
      { propertyName: `hs_date_entered_${trialStage.id}`, operator: 'GTE', value: String(startMs) },
      { propertyName: `hs_date_entered_${trialStage.id}`, operator: 'LT',  value: String(endMs)   },
    ]);
    await delay(300);

    // Deals currently sitting in Active Trial (snapshot, all time)
    const currentlyOnTrial = await hsSearchCount([
      { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id },
    ]);

    return NextResponse.json({
      month,
      _meta: {
        pipeline:     etzPipeline.label,
        trialStage:   trialStage.label,
        trialStageId: trialStage.id,
      },
      trialsStarted,    // entered Active Trial this month
      currentlyOnTrial, // in Active Trial right now (all time)
    });

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
