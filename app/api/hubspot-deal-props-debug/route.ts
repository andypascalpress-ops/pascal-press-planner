import { NextResponse } from 'next/server';

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
  await sleep(120);
  return j.total as number;
}

// Metadata and aggregate counts only.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const re = new RegExp(sp.get('re') ?? 'subject|course|deal.?type|voucher|referr|source|teacher|plan|product|subscription', 'i');
  const props = await call(`${HS}/crm/v3/properties/deals`, { headers: H() });
  const list = (props.results as { name: string; label: string; type: string; fieldType: string; options?: { label: string; value: string }[]; hubspotDefined?: boolean }[])
    .filter(p => re.test(p.name) || re.test(p.label))
    .map(p => ({ name: p.name, label: p.label, type: p.type, fieldType: p.fieldType, custom: !p.hubspotDefined, options: (p.options ?? []).slice(0, 40).map(o => `${o.label}=${o.value}`) }));

  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: H() });
  const pipe = (pl.results as { id: string; label: string; stages: { id: string; label: string }[] }[]).find(p => p.label.toLowerCase().includes('ehc'));
  const stageCounts: Record<string, number> = {};
  let total = 0;
  if (pipe) {
    for (const st of pipe.stages) {
      stageCounts[st.label] = await count([{ propertyName: 'pipeline', operator: 'EQ', value: pipe.id }, { propertyName: 'dealstage', operator: 'EQ', value: st.id }]);
      total += stageCounts[st.label]!;
    }
  }
  return NextResponse.json({ matched: list.length, properties: list, ehcStageCountsAllTime: stageCounts, ehcTotalDeals: total });
}
