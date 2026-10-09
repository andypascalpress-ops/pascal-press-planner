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
  await sleep(120);
  return j.total as number;
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Aggregate counts only: no names, emails or deal ids are returned.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const weeks = Math.min(Number(sp.get('weeks') ?? '14') || 14, 30);
  const label = sp.get('pipeline') ?? 'ehc';
  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: H() });
  const pipes = pl.results as { id: string; label: string; stages: { id: string; label: string }[] }[];
  const p = pipes.find(x => x.label.toLowerCase().includes(label));
  if (!p) return NextResponse.json({ error: 'pipeline not found', pipelines: pipes.map(x => x.label) }, { status: 404 });

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = addDays(today, -((dow + 6) % 7));

  const rows: Record<string, unknown>[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const s = addDays(thisMonday, -7 * w), e = addDays(s, 6);
    const base = [
      { propertyName: 'pipeline', operator: 'EQ', value: p.id },
      { propertyName: 'createdate', operator: 'GTE', value: String(zonedDateTimeToUnix(s, '00:00:00') * 1000) },
      { propertyName: 'createdate', operator: 'LTE', value: String(zonedDateTimeToUnix(e, '23:59:59') * 1000) },
    ];
    const byStage: Record<string, number> = {};
    for (const st of p.stages) byStage[st.label] = await count([...base, { propertyName: 'dealstage', operator: 'EQ', value: st.id }]);
    const all = await count(base);
    const amount0 = await count([...base, { propertyName: 'amount', operator: 'EQ', value: '0' }]);
    rows.push({ week: `${s}`, all, amount0, ...byStage });
  }
  return NextResponse.json({ pipeline: p.label, stages: p.stages.map(s => s.label), rows });
}
