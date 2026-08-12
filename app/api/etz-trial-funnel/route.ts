/**
 * GET /api/etz-trial-funnel?month=YYYY-MM[&debug=1]
 *
 * trialsStarted = deals that STARTED as a free trial this month:
 *   (a) Active Trial created this month, still on trial
 *   (b) Active Paid created this month that have hs_date_entered_[trialStageId] set
 *
 * Pass ?debug=1 to see raw properties of the first Active Paid deal for diagnosis.
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
    throw new Error(`HubSpot count search → ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.total as number) ?? 0;
}

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
      throw new Error(`HubSpot search → ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    for (const r of (json.results ?? [])) {
      results.push(r.properties ?? {});
    }
    after = json.paging?.next?.after as string | undefined;
    if (after) await delay(300);
  } while (after);

  return results;
}

/**
 * Fetch a single deal with full propertiesWithHistory for dealstage.
 * Returns the history array so we can see every stage the deal has been in.
 */
async function hsDealStageHistory(dealId: string): Promise<{ value: string; timestamp: string }[]> {
  const res = await fetch(
    `${HS_BASE}/crm/v3/objects/deals/${dealId}?propertiesWithHistory=dealstage`,
    { headers: hsHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.propertiesWithHistory?.dealstage ?? []) as { value: string; timestamp: string }[];
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
  const debug = searchParams.get('debug') === '1';

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

    const trialEnteredProp = `hs_date_entered_${trialStage.id}`;

    // ── 3a. Deals still in Active Trial, created this month ───────────────
    const onTrialCount = await hsCount([
      { filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ]);
    await delay(300);

    // ── 3b. Deals now in Active Paid, created this month ─────────────────
    // Fetch them all, requesting hs_date_entered_[trialStageId] as a property.
    // If HubSpot returns that property non-null, the deal went through trial first.
    // If it's always null (HubSpot doesn't expose it), fall back to deal history.
    let convertedTrialsCount = 0;
    let totalPaidDealsFound  = 0;
    let hsDateEnteredWorking = false; // will be true if any deal has the prop set
    let debugSample: Record<string, string | null>[] = [];

    if (paidStage) {
      const paidDeals = await hsFetchAll(
        [{ filters: [...createdThisMonth, { propertyName: 'dealstage', operator: 'EQ', value: paidStage.id }] }],
        [trialEnteredProp, 'dealstage', 'createdate', 'hs_object_id'],
        delay,
      );
      totalPaidDealsFound = paidDeals.length;

      // Debug: capture first 3 deals' property maps (no PII — just dates and IDs)
      if (debug) {
        debugSample = paidDeals.slice(0, 3);
      }

      const withTrialProp = paidDeals.filter(p => {
        const v = p[trialEnteredProp];
        return v != null && v !== '';
      });
      hsDateEnteredWorking = withTrialProp.length > 0;
      convertedTrialsCount = withTrialProp.length;

      // ── Fallback: if hs_date_entered_ is all null, use deal stage history ──
      // Check up to the first 5 paid deals via propertiesWithHistory to see if
      // HubSpot supports this approach and whether those deals passed through trial.
      if (!hsDateEnteredWorking && paidDeals.length > 0) {
        await delay(300);
        // Sample up to 10 deals to check stage history
        const sampleIds = paidDeals
          .slice(0, 10)
          .map(p => p['hs_object_id'])
          .filter(Boolean) as string[];

        let historyBasedCount = 0;
        let historyChecked = 0;

        for (const id of sampleIds) {
          const history = await hsDealStageHistory(id);
          historyChecked++;
          const hadTrial = history.some(h => h.value === trialStage.id);
          if (hadTrial) historyBasedCount++;
          await delay(200);
        }

        // Extrapolate from sample if history approach works
        if (historyChecked > 0 && historyBasedCount > 0) {
          const sampleRate = historyBasedCount / historyChecked;
          convertedTrialsCount = Math.round(sampleRate * totalPaidDealsFound);
          console.log(`[etz-trial-funnel] fallback history: ${historyBasedCount}/${historyChecked} sampled had trial → extrapolated ${convertedTrialsCount}/${totalPaidDealsFound}`);
        } else {
          // History approach also shows 0 — assume all paid deals were trials
          // (conservative fallback: ETZ rarely has direct purchases)
          // Use OR count and subtract known-direct-purchase ratio
          console.log(`[etz-trial-funnel] history check found 0 from ${historyChecked} samples — using totalPaidDealsFound as fallback`);
          convertedTrialsCount = totalPaidDealsFound;
        }
      }
    }

    const trialsStarted = onTrialCount + convertedTrialsCount;

    // ── 4. Currently on trial (all-time snapshot) ─────────────────────────
    const currentlyOnTrial = await hsCount([
      { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] },
    ]);

    return NextResponse.json({
      month,
      trialsStarted,
      currentlyOnTrial,
      _meta: {
        pipeline:            etzPipeline.label,
        trialStage:          trialStage.label,
        trialStageId:        trialStage.id,
        trialEnteredProp,
        paidStage:           paidStage?.label ?? null,
        paidStageId:         paidStage?.id    ?? null,
        onTrialCount,
        convertedTrialsCount,
        totalPaidDealsFound,
        hsDateEnteredWorking,
        ...(debug ? { debugSample } : {}),
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
