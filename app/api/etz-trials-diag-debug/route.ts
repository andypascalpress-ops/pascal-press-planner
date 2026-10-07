import { NextResponse } from 'next/server';
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HS = 'https://api.hubapi.com';
const H = () => ({ Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`, 'Content-Type': 'application/json' });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call(url: string, init?: RequestInit) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { ...init, cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`);
    await sleep(400 * 2 ** i);
  }
  throw new Error(`failed ${url}`);
}

async function count(filters: object[]) {
  const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: H(), body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }) });
  await sleep(150);
  return j.total as number;
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const windows = [
    { name: 'prior', start: sp.get('ps') ?? '2026-09-01', end: sp.get('pe') ?? '2026-09-07' },
    { name: 'current', start: sp.get('cs') ?? '2026-10-01', end: sp.get('ce') ?? '2026-10-07' },
  ];
  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: H() });
  const etz = (pl.results as { id: string; label: string; stages: { id: string; label: string }[] }[]).find(p => p.label.toLowerCase().includes('etz'));
  if (!etz) return NextResponse.json({ error: 'no ETZ pipeline' }, { status: 404 });

  const out: Record<string, unknown> = { pipeline: etz.label };
  for (const w of windows) {
    const gte = String(zonedDateTimeToUnix(w.start, '00:00:00') * 1000);
    const lte = String(zonedDateTimeToUnix(w.end, '23:59:59') * 1000);
    const base = [
      { propertyName: 'pipeline', operator: 'EQ', value: etz.id },
      { propertyName: 'createdate', operator: 'GTE', value: gte },
      { propertyName: 'createdate', operator: 'LTE', value: lte },
    ];
    const byStage: Record<string, number> = {};
    for (const st of etz.stages) byStage[st.label] = await count([...base, { propertyName: 'dealstage', operator: 'EQ', value: st.id }]);
    const all = await count(base);
    const amount0 = await count([...base, { propertyName: 'amount', operator: 'EQ', value: '0' }]);
    const offline = await count([...base, { propertyName: 'hs_analytics_source', operator: 'EQ', value: 'OFFLINE' }]);
    out[w.name] = { window: `${w.start} to ${w.end}`, allDealsInPipeline: all, amountZero: amount0, offlineSource: offline, byStage,
      stageSum: Object.values(byStage).reduce((a, b) => a + b, 0) };
  }
  return NextResponse.json(out);
}
