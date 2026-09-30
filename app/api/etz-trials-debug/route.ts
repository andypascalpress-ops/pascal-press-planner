/**
 * GET /api/etz-trials-debug
 *
 * TEMPORARY diagnostic — breaks down ETZ pipeline deals created this month
 * by dealstage, to check whether "every deal in the pipeline is a trial"
 * (the assumption business-unit-trend and business-unit both currently
 * make) actually holds. The business-unit route's trials-started count
 * (611) came in well above what the user's own ETZ trials dashboard shows
 * (383), so something in that assumption is likely wrong.
 *
 * Delete once the real trial definition is confirmed and the route(s)
 * fixed.
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

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start') ?? '2026-09-01';
  const end   = searchParams.get('end')   ?? '2026-09-29';
  const startMs = new Date(`${start}T00:00:00+10:00`).getTime();
  const endMs   = new Date(`${end}T23:59:59+10:00`).getTime();

  const plRes = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(), cache: 'no-store' });
  const plJson = await plRes.json() as { results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }> };

  const matchingPipelines = plJson.results.filter(p => p.label.toLowerCase().includes('etz'));

  const perPipeline = await Promise.all(matchingPipelines.map(async pipeline => {
    // Count deals per stage created in the window
    const perStage = await Promise.all(pipeline.stages.map(async stage => {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({
          filterGroups: [{ filters: [
            { propertyName: 'pipeline',   operator: 'EQ',  value: pipeline.id },
            { propertyName: 'dealstage',  operator: 'EQ',  value: stage.id },
            { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
            { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
          ]}],
          limit: 1,
        }),
        cache: 'no-store',
      });
      const json = res.ok ? await res.json() as { total: number } : { total: -1 };
      return { stageId: stage.id, stageLabel: stage.label, count: json.total };
    }));

    // Total with no stage filter, for comparison
    const totalRes = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'pipeline',   operator: 'EQ',  value: pipeline.id },
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
        ]}],
        limit: 1,
      }),
      cache: 'no-store',
    });
    const totalJson = totalRes.ok ? await totalRes.json() as { total: number } : { total: -1 };

    return {
      pipelineId: pipeline.id,
      pipelineLabel: pipeline.label,
      totalNoStageFilter: totalJson.total,
      perStage,
    };
  }));

  return NextResponse.json({ connected: true, range: { start, end, startMs, endMs }, pipelines: perPipeline });
}
