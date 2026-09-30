import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const HS_BASE = 'https://api.hubapi.com';
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function countStage(pipelineId: string, stageId: string, startMs: number, endMs: number): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId },
        { propertyName: 'dealstage',  operator: 'EQ',  value: stageId },
        { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
        { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
      ]}],
      limit: 1,
    }),
    cache: 'no-store',
  });
  if (!res.ok) return -1;
  const json = await res.json() as { total: number };
  return json.total;
}

export async function GET() {
  const plRes = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(), cache: 'no-store' });
  const plJson = await plRes.json() as { results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }> };
  const pipeline = plJson.results.find(p => p.label.toLowerCase().includes('etz'));
  if (!pipeline) return NextResponse.json({ error: 'no etz pipeline' }, { status: 500 });

  const ranges = {
    'sep2026': { start: '2026-09-01', end: '2026-09-30' },
    'sep2025': { start: '2025-09-01', end: '2025-09-30' },
  };

  const out: Record<string, Record<string, number>> = {};
  for (const [key, r] of Object.entries(ranges)) {
    const startMs = new Date(`${r.start}T00:00:00+10:00`).getTime();
    const endMs   = new Date(`${r.end}T23:59:59+10:00`).getTime();
    const perStage: Record<string, number> = {};
    for (const stage of pipeline.stages) {
      perStage[stage.label] = await countStage(pipeline.id, stage.id, startMs, endMs);
    }
    out[key] = perStage;
  }

  return NextResponse.json({ connected: true, out });
}
