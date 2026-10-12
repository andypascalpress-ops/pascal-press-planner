import { NextResponse } from 'next/server';
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

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

async function all(path: string, base: Record<string, string>, max = 6000) {
  const out: any[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const p = new URLSearchParams({ ...base, limit: '100' });
    if (after) p.set('starting_after', after);
    const j = await get(path, p);
    out.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

const sydney = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' });

// Aggregates only: no customer details are returned.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const today = sydney.format(new Date());
  const start = sp.get('start') ?? `${today.slice(0, 7)}-01`;
  const gte = String(zonedDateTimeToUnix(start, '00:00:00'));

  // 1) payments this month
  const charges = await all('charges', { 'created[gte]': gte });
  const byDay: Record<string, { n: number; gross: number; refunded: number; failed: number }> = {};
  let gross = 0, refunded = 0, ok = 0, refundedCharges = 0, failed = 0, disputed = 0, notPaid = 0;
  for (const c of charges) {
    const day = sydney.format(new Date(c.created * 1000));
    const d = (byDay[day] ??= { n: 0, gross: 0, refunded: 0, failed: 0 });
    if (c.status === 'failed') { failed++; d.failed++; continue; }
    if (!c.paid || c.status !== 'succeeded') { notPaid++; continue; }
    ok++; d.n++;
    gross += c.amount / 100; d.gross += c.amount / 100;
    refunded += (c.amount_refunded ?? 0) / 100; d.refunded += (c.amount_refunded ?? 0) / 100;
    if ((c.amount_refunded ?? 0) > 0) refundedCharges++;
    if (c.disputed) disputed++;
  }

  // 2) paid invoices this month (to spot money recorded outside charges)
  const invoices = await all('invoices', { 'created[gte]': gte, status: 'paid' });
  const invPaid = invoices.reduce((s, i) => s + (i.amount_paid ?? 0) / 100, 0);
  const invNoCharge = invoices.filter(i => !i.charge && !i.payment_intent && (i.amount_paid ?? 0) > 0).length;
  const invZero = invoices.filter(i => (i.amount_paid ?? 0) === 0).length;

  // 3) subscriptions, fully paginated (the dashboard card only looks at the first 100)
  const subs = await all('subscriptions', { status: 'all' }, 8000);
  const byStatus: Record<string, number> = {};
  let mrr = 0, activeCount = 0, activeMonthly = 0, activeYearly = 0, cancelAtPeriodEnd = 0;
  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === 'active' || s.status === 'past_due') {
      activeCount++;
      if (s.cancel_at_period_end) cancelAtPeriodEnd++;
      const item = s.items?.data?.[0];
      const unit = (item?.price?.unit_amount ?? 0) / 100;
      const rec = item?.price?.recurring;
      if (rec?.interval === 'year') { activeYearly++; mrr += unit / 12; }
      else { activeMonthly++; mrr += unit / (rec?.interval_count ?? 1); }
    }
  }
  const byPrice: Record<string, { n: number; discounted: number }> = {};
  for (const s of subs) {
    if (s.status !== 'active' && s.status !== 'past_due') continue;
    const item = s.items?.data?.[0];
    const rec = item?.price?.recurring;
    const key = `${(item?.price?.unit_amount ?? 0) / 100}|${rec ? `${rec.interval_count} ${rec.interval}` : 'one-off'}`;
    const cell = (byPrice[key] ??= { n: 0, discounted: 0 });
    cell.n++;
    if (s.discount) cell.discounted++;
  }
  const canceledThisMonth = subs.filter(s => s.canceled_at && s.canceled_at >= Number(gte)).length;
  const createdThisMonth = subs.filter(s => s.created >= Number(gte)).length;

  return NextResponse.json({
    start, today,
    payments: { successful: ok, gross: Math.round(gross * 100) / 100, refunded: Math.round(refunded * 100) / 100, net: Math.round((gross - refunded) * 100) / 100, refundedCharges, failed, notPaid, disputed },
    byDay: Object.fromEntries(Object.entries(byDay).sort().map(([k, v]) => [k, { orders: v.n, gross: Math.round(v.gross * 100) / 100, refunded: Math.round(v.refunded * 100) / 100, failed: v.failed }])),
    invoices: { paid: invoices.length, amountPaid: Math.round(invPaid * 100) / 100, paidWithNoCharge: invNoCharge, zeroValue: invZero },
    subscriptions: { byPrice, total: subs.length, byStatus, payingNow: activeCount, monthly: activeMonthly, yearly: activeYearly, mrr: Math.round(mrr), cancelAtPeriodEnd, canceledThisMonth, createdThisMonth },
  });
}
