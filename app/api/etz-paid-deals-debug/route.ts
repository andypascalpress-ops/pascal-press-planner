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

// Aggregates only: no names, emails or deal ids are returned.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const start = sp.get('s') ?? '2026-10-01', end = sp.get('e') ?? '2026-10-07';
  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: H() });
  const etz = (pl.results as { id: string; label: string; stages: { id: string; label: string }[] }[]).find(p => p.label.toLowerCase().includes('etz'))!;
  const paid = etz.stages.filter(s => s.label.toLowerCase().includes('paid')).map(s => s.id);
  const gte = String(zonedDateTimeToUnix(start, '00:00:00') * 1000), lte = String(zonedDateTimeToUnix(end, '23:59:59') * 1000);

  const deals: { amount: number; source: string; created: string; closed: string | null }[] = [];
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: etz.id },
        { propertyName: 'dealstage', operator: 'IN', values: paid },
        { propertyName: 'createdate', operator: 'GTE', value: gte },
        { propertyName: 'createdate', operator: 'LTE', value: lte },
      ] }],
      properties: ['amount', 'hs_analytics_source', 'createdate', 'closedate'], limit: 100,
    };
    if (after) body.after = after;
    const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: H(), body: JSON.stringify(body) });
    for (const r of j.results ?? []) deals.push({ amount: Number(r.properties.amount ?? 0), source: r.properties.hs_analytics_source ?? '(none)', created: (r.properties.createdate ?? '').slice(0, 10), closed: r.properties.closedate ? String(r.properties.closedate).slice(0, 10) : null });
    after = j.paging?.next?.after; await sleep(200);
  } while (after);

  const sum = (a: { amount: number }[]) => Math.round(a.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const bySource: Record<string, { n: number; amount: number }> = {};
  for (const d of deals) { const b = (bySource[d.source] ??= { n: 0, amount: 0 }); b.n++; b.amount = Math.round((b.amount + d.amount) * 100) / 100; }
  const buckets = { zero: 0, under50: 0, from50to150: 0, from150to500: 0, over500: 0 };
  for (const d of deals) { if (d.amount <= 0) buckets.zero++; else if (d.amount < 50) buckets.under50++; else if (d.amount < 150) buckets.from50to150++; else if (d.amount < 500) buckets.from150to500++; else buckets.over500++; }
  const offline = deals.filter(d => d.source === 'OFFLINE'), online = deals.filter(d => d.source !== 'OFFLINE');
  return NextResponse.json({
    window: `${start} to ${end}`, paidDeals: deals.length, totalDealAmount: sum(deals), bySource, amountBuckets: buckets,
    offline: { n: offline.length, amount: sum(offline) }, nonOffline: { n: online.length, amount: sum(online) },
    createdDayCounts: deals.reduce((m: Record<string, number>, d) => ((m[d.created] = (m[d.created] ?? 0) + 1), m), {}),
  });
}
