import { NextResponse } from 'next/server';
import { etzPurchaseDiagnostics } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.STRIPE_SECRET_KEY ?? '';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const start = sp.get('start') ?? '2026-09-28';
  const end = sp.get('end') ?? '2026-10-04';

  const ga = await etzPurchaseDiagnostics(start, end);

  const gte = Math.floor(new Date(`${start}T00:00:00+10:00`).getTime() / 1000);
  const lte = Math.floor(new Date(`${end}T23:59:59+10:00`).getTime() / 1000);
  type Ch = { id: string; payment_intent: string | null; invoice: string | null; amount: number; amount_refunded: number; created: number; paid: boolean; status: string; description: string | null };
  const charges: Ch[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const p = new URLSearchParams({ 'created[gte]': String(gte), 'created[lte]': String(lte), limit: '100' });
    if (after) p.set('starting_after', after);
    const r = await fetch(`https://api.stripe.com/v1/charges?${p}`, { headers: { Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
    const j = await r.json() as { data: Ch[]; has_more: boolean };
    charges.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1]!.id;
  }
  const ok = charges.filter(c => c.paid && c.status === 'succeeded');
  const ids = new Set<string>();
  for (const c of ok) { ids.add(c.id); if (c.payment_intent) ids.add(c.payment_intent); if (c.invoice) ids.add(c.invoice); }

  const gaTx = ga.byTx as { d: string[]; m: string[] }[];
  const real = gaTx.filter(r => r.d[0] !== '(not set)');
  const notSet = gaTx.filter(r => r.d[0] === '(not set)');
  const matched = real.filter(r => ids.has(r.d[0]!));
  const unmatched = real.filter(r => !ids.has(r.d[0]!));
  const sum = (a: { m: string[] }[], i: number) => Math.round(a.reduce((s, r) => s + parseFloat(r.m[i] ?? '0'), 0) * 100) / 100;

  return NextResponse.json({
    period: { start, end },
    stripe: {
      succeededCharges: ok.length,
      net: Math.round(ok.reduce((s, c) => s + c.amount - c.amount_refunded, 0)) / 100,
      gross: Math.round(ok.reduce((s, c) => s + c.amount, 0)) / 100,
      refundedCharges: ok.filter(c => c.amount_refunded > 0).length,
      withInvoice: ok.filter(c => c.invoice).length,
      idStyles: Array.from(new Set(ok.map(c => (c.payment_intent ?? '').slice(0, 3)))),
      sampleGa4Ids: real.slice(0, 5).map(r => r.d[0]),
    },
    ga4: {
      distinctTransactionIds: real.length,
      idsRevenue: sum(real, 1), idsTransactions: sum(real, 0),
      notSetRows: notSet.length, notSetRevenue: sum(notSet, 1), notSetTransactions: sum(notSet, 0),
      matchedToStripe: matched.length, matchedRevenue: sum(matched, 1),
      unmatched: unmatched.length, unmatchedRevenue: sum(unmatched, 1),
      unmatchedSample: unmatched.slice(0, 25).map(r => ({ id: r.d[0], date: r.d[1], tx: r.m[0], rev: r.m[1] })),
    },
    byHost: ga.byHost, sessionsByHost: ga.byDate, byHostMonth: (ga as unknown as { byHostMonth: unknown }).byHostMonth,
    stripeUnmatchedByGa4: ok.filter(c => !real.some(r => r.d[0] === c.id || r.d[0] === c.payment_intent || r.d[0] === c.invoice)).length,
  });
}
