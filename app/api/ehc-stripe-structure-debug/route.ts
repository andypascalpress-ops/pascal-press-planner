import { NextResponse } from 'next/server';
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.STRIPE_HSC_SECRET_KEY ?? '';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, { headers: { Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${path}`);
    await sleep(400 * 2 ** i);
  }
  throw new Error(`failed ${path}`);
}

async function all(path: string, params: Record<string, string>, max = 3000) {
  const out: any[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const j = await get(path, { ...params, limit: '100', ...(after ? { starting_after: after } : {}) });
    out.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

// Aggregate structure only: no customer names, emails, ids or descriptions are returned.
export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get('days') ?? '45');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - days);
  const gte = String(zonedDateTimeToUnix(start.toISOString().slice(0, 10), '00:00:00'));

  const charges = await all('charges', { 'created[gte]': gte });
  const ok = charges.filter(c => c.paid && c.status === 'succeeded');
  const withInvoice = ok.filter(c => c.invoice).length;

  const invoices = await all('invoices', { 'created[gte]': gte, status: 'paid' });
  const byReason: Record<string, number> = {};
  const byIntervalReason: Record<string, number> = {};
  const byAmount: Record<string, number> = {};
  for (const inv of invoices) {
    byReason[inv.billing_reason ?? 'none'] = (byReason[inv.billing_reason ?? 'none'] ?? 0) + 1;
    const line = inv.lines?.data?.[0];
    const rec = line?.price?.recurring ?? line?.plan;
    const key = `${inv.billing_reason}|${rec ? `${rec.interval_count ?? 1} ${rec.interval}` : 'one-off'}`;
    byIntervalReason[key] = (byIntervalReason[key] ?? 0) + 1;
    const a = String(Math.round((inv.amount_paid ?? 0) / 100));
    byAmount[a] = (byAmount[a] ?? 0) + 1;
  }
  const noInvoiceAmounts: Record<string, number> = {};
  for (const c of ok.filter(c => !c.invoice)) {
    const a = String(Math.round(c.amount / 100));
    noInvoiceAmounts[a] = (noInvoiceAmounts[a] ?? 0) + 1;
  }
  const prices = await all('prices', { active: 'true' }, 300);
  const priceSummary = prices.map(p => ({
    nickname: p.nickname ?? null, amount: (p.unit_amount ?? 0) / 100, type: p.type,
    interval: p.recurring ? `${p.recurring.interval_count} ${p.recurring.interval}` : 'one-off',
  })).slice(0, 60);

  return NextResponse.json({
    windowDays: days, charges: ok.length, chargesWithInvoice: withInvoice, chargesWithoutInvoice: ok.length - withInvoice,
    paidInvoices: invoices.length, byBillingReason: byReason, byReasonAndInterval: byIntervalReason,
    invoiceAmountCounts: byAmount, nonInvoiceChargeAmountCounts: noInvoiceAmounts, activePrices: priceSummary,
  });
}
