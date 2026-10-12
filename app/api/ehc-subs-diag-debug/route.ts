import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.STRIPE_HSC_SECRET_KEY ?? '';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(path: string, params: URLSearchParams) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.stripe.com/v1/${path}?${params}`, { headers: { Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${path}`);
    await sleep(400 * 2 ** i);
  }
  throw new Error(`failed ${path}`);
}

async function all(path: string, base: [string, string][], max = 4000) {
  const out: any[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const p = new URLSearchParams();
    for (const [k, v] of base) p.append(k, v);
    p.set('limit', '100');
    if (after) p.set('starting_after', after);
    const j = await get(path, p);
    out.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

// Aggregates only: no customer details, ids or emails are returned.
export async function GET() {
  const now = Math.floor(Date.now() / 1000);
  const subs = [
    ...(await all('subscriptions', [['status', 'active'], ['expand[]', 'data.latest_invoice']])),
    ...(await all('subscriptions', [['status', 'past_due'], ['expand[]', 'data.latest_invoice']])),
  ];
  const bucket = (days: number) => (days <= 35 ? '0-35d' : days <= 70 ? '36-70d' : days <= 120 ? '71-120d' : '120d+');
  const groups: Record<string, { n: number; paused: number; sendInvoice: number; cancelAtEnd: number; periodEndInPast: number; zeroAmount: number; discounted: number }> = {};
  const periodAhead: Record<string, number> = {};

  for (const s of subs) {
    const item = s.items?.data?.[0];
    const unit = (item?.price?.unit_amount ?? 0) / 100;
    if (unit <= 0) continue;
    const interval = item?.price?.recurring?.interval === 'year' ? 'year' : 'month';
    const inv = s.latest_invoice && typeof s.latest_invoice === 'object' ? s.latest_invoice : null;
    const paidAt = inv?.status_transitions?.paid_at ?? inv?.created ?? 0;
    const ageDays = paidAt ? Math.floor((now - paidAt) / 86400) : 9999;
    const key = `${interval}|latest invoice ${inv?.status ?? 'none'}|${inv && (inv.amount_paid ?? 0) > 0 ? 'paid>0' : 'paid=0'}|age ${paidAt ? bucket(ageDays) : 'n/a'}`;
    const g = (groups[key] ??= { n: 0, paused: 0, sendInvoice: 0, cancelAtEnd: 0, periodEndInPast: 0, zeroAmount: 0, discounted: 0 });
    g.n++;
    if (s.pause_collection) g.paused++;
    if (s.collection_method === 'send_invoice') g.sendInvoice++;
    if (s.cancel_at_period_end) g.cancelAtEnd++;
    if (s.current_period_end && s.current_period_end < now) g.periodEndInPast++;
    if (inv && (inv.amount_paid ?? 0) === 0) g.zeroAmount++;
    if (s.discount) g.discounted++;
    if (interval === 'month' && s.current_period_end) {
      const d = Math.floor((s.current_period_end - now) / 86400);
      const b = d < 0 ? 'overdue' : d <= 10 ? '0-10d' : d <= 20 ? '11-20d' : d <= 31 ? '21-31d' : '32d+';
      periodAhead[b] = (periodAhead[b] ?? 0) + 1;
    }
  }
  // what each paying monthly subscription was actually charged on its latest invoice
  const hist: Record<string, number> = {};
  let monthlyBilledNow = 0, monthlyAtList = 0, annualBilledPerMonth = 0;
  for (const s of subs) {
    const item = s.items?.data?.[0];
    const unit = (item?.price?.unit_amount ?? 0) / 100;
    if (unit <= 0) continue;
    const inv = s.latest_invoice && typeof s.latest_invoice === 'object' ? s.latest_invoice : null;
    if (item?.price?.recurring?.interval === 'year') { annualBilledPerMonth += unit / 12; continue; }
    const paid = inv ? (inv.amount_paid ?? 0) / 100 : 0;
    const key = String(Math.round(paid));
    hist[key] = (hist[key] ?? 0) + 1;
    monthlyBilledNow += paid;
    monthlyAtList += unit;
  }
  const rows = Object.entries(groups).sort((a, b) => b[1].n - a[1].n);
  return NextResponse.json({ latestInvoiceAmountCounts: hist, monthlyBilledNow: Math.round(monthlyBilledNow), monthlyAtList: Math.round(monthlyAtList), annualBilledPerMonth: Math.round(annualBilledPerMonth), activeOrPastDuePaidPrice: subs.length, groups: Object.fromEntries(rows), monthlyNextRenewalWindow: periodAhead });
}
