import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const HS_BASE = 'https://api.hubapi.com';
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function countDeals(pipelineId: string, startMs: number, endMs: number, stageId?: string): Promise<number> {
  const filters: object[] = [
    { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId },
    { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
    { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
  ];
  if (stageId) filters.push({ propertyName: 'dealstage', operator: 'EQ', value: stageId });
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
    cache: 'no-store',
  });
  if (!res.ok) return -1;
  const json = await res.json() as { total: number };
  return json.total;
}

// Fetch a small sample of actual deal records (name + createdate + stage)
// so we can eyeball real examples, not just a count.
async function sampleDeals(pipelineId: string, startMs: number, endMs: number, stageId?: string) {
  const filters: object[] = [
    { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId },
    { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
    { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
  ];
  if (stageId) filters.push({ propertyName: 'dealstage', operator: 'EQ', value: stageId });
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters }],
      properties: ['dealname', 'createdate', 'dealstage', 'amount'],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 5,
    }),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const json = await res.json() as { results: Array<{ properties: Record<string, string> }> };
  return json.results.map(r => r.properties);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start') ?? '2025-09-01';
  const end   = searchParams.get('end')   ?? '2025-09-30';

  const plRes = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(), cache: 'no-store' });
  const plJson = await plRes.json() as { results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }> };
  const pipeline = plJson.results.find(p => p.label.toLowerCase().includes('etz'));
  if (!pipeline) return NextResponse.json({ error: 'no etz pipeline' }, { status: 500 });

  const startMs = new Date(`${start}T00:00:00+10:00`).getTime();
  const endMs   = new Date(`${end}T23:59:59+10:00`).getTime();

  const expiredStage = pipeline.stages.find(s => s.label.toLowerCase().includes('expired trial'));

  const [totalAllStages, expiredTrialCount, sample] = await Promise.all([
    countDeals(pipeline.id, startMs, endMs),
    expiredStage ? countDeals(pipeline.id, startMs, endMs, expiredStage.id) : Promise.resolve(-1),
    expiredStage ? sampleDeals(pipeline.id, startMs, endMs, expiredStage.id) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    range: { start, end, startMs, endMs },
    pipelineId: pipeline.id,
    pipelineLabel: pipeline.label,
    expiredStageId: expiredStage?.id ?? null,
    totalAllStages,
    expiredTrialCount,
    sampleDeals: sample,
  });
}
