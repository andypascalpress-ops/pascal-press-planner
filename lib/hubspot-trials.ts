/**
 * Shared HubSpot trial-pipeline helpers for ETZ/EHC.
 *
 * Trials live as $0 deals in a per-brand pipeline (stages like "Active
 * Trial", "Expired Trial", "Active Paid", "Expired Paid", "Quote"). Counting
 * every deal in the pipeline as a trial (an earlier assumption in this
 * codebase) overcounts badly — confirmed against the live account, September
 * 2026 had 656 total pipeline deals but only 408 were actually in a trial
 * stage; the rest had already converted to paid or were sales quotes.
 * Always filter to stages whose label contains "trial" or "paid".
 */

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

export interface TrialPipeline {
  id: string;
  trialStageIds: string[];
  paidStageIds: string[];
}

export async function resolveTrialPipeline(pipelineLabel: string): Promise<TrialPipeline | null> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    const { results } = await res.json() as {
      results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }>
    };
    const pipeline = results.find(p => p.label.toLowerCase().includes(pipelineLabel.toLowerCase()));
    if (!pipeline) return null;
    return {
      id: pipeline.id,
      trialStageIds: pipeline.stages.filter(s => s.label.toLowerCase().includes('trial')).map(s => s.id),
      paidStageIds:  pipeline.stages.filter(s => s.label.toLowerCase().includes('paid')).map(s => s.id),
    };
  } catch { return null; }
}

async function countDealsByStage(
  pipelineId: string, stageIds: string[], startMs: number, endMs: number,
): Promise<number> {
  if (stageIds.length === 0) return 0;
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId },
          { propertyName: 'dealstage',  operator: 'IN',  values: stageIds },
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
        ]}],
        limit: 1,
      }),
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const json = await res.json() as { total: number };
    return json.total ?? 0;
  } catch { return 0; }
}

/** Deals created in [startMs, endMs] currently sitting in a trial stage. */
export async function fetchTrialsStartedInRange(
  pipelineLabel: string, startMs: number, endMs: number,
): Promise<number> {
  const pipeline = await resolveTrialPipeline(pipelineLabel);
  if (!pipeline) return 0;
  return countDealsByStage(pipeline.id, pipeline.trialStageIds, startMs, endMs);
}

export interface TrialConversion {
  /** Still sitting in a trial stage — not yet resolved. */
  trialsStarted: number;
  /** Now in a paid stage — converted. */
  converted: number;
  /** trialsStarted + converted — the best available denominator for "created in this period". */
  totalEverStarted: number;
  /** converted / totalEverStarted, as a whole-number percent. Null when totalEverStarted is 0. */
  pct: number | null;
}

/**
 * Trial-to-paid conversion for deals created in [startMs, endMs]. This is a
 * live snapshot, not a matured cohort result: a recent period's trials that
 * haven't resolved yet (still "Active Trial") are excluded from both the
 * numerator and denominator, so `pct` for a very recent period will read
 * artificially high and keep changing as more trials resolve — callers
 * should surface `trialsStarted` alongside `pct` so this is visible.
 */
export async function fetchTrialConversion(
  pipelineLabel: string, startMs: number, endMs: number,
): Promise<TrialConversion> {
  const pipeline = await resolveTrialPipeline(pipelineLabel);
  if (!pipeline) return { trialsStarted: 0, converted: 0, totalEverStarted: 0, pct: null };

  const [trialsStarted, converted] = await Promise.all([
    countDealsByStage(pipeline.id, pipeline.trialStageIds, startMs, endMs),
    countDealsByStage(pipeline.id, pipeline.paidStageIds, startMs, endMs),
  ]);
  const totalEverStarted = trialsStarted + converted;
  const pct = totalEverStarted > 0 ? Math.round((converted / totalEverStarted) * 100) : null;
  return { trialsStarted, converted, totalEverStarted, pct };
}
