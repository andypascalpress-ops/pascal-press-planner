/**
 * Stripe API client for ETZ revenue.
 * Uses /v1/balance_transactions to match the Stripe dashboard "Net volume" figure,
 * which is gross payments minus Stripe fees, refunds, and disputes.
 * Required env var: STRIPE_SECRET_KEY
 */

import { RevenueData } from './bigcommerce-revenue';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeHeaders() {
  return { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
}

function monthUnixRange(month: string): { gte: number; lte: number } {
  const [year, mon] = month.split('-').map(Number);
  // Use UTC midnight — balance_transactions use UTC timestamps,
  // and Stripe's "Net volume" chart for June shows Jun 1–30 UTC.
  const start = new Date(Date.UTC(year!, mon! - 1, 1));
  const end   = new Date(Date.UTC(year!, mon!, 0, 23, 59, 59));
  return {
    gte: Math.floor(start.getTime() / 1000),
    lte: Math.floor(end.getTime()   / 1000),
  };
}

interface BalanceTxn {
  id: string;
  type: string;   // 'payment', 'refund', 'dispute', etc.
  net: number;    // cents, after Stripe fee deducted
  amount: number; // gross cents
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

async function fetchBalanceTxns(
  gte: number,
  lte: number,
  type: string,
): Promise<BalanceTxn[]> {
  const results: BalanceTxn[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const params = new URLSearchParams({
      'created[gte]': String(gte),
      'created[lte]': String(lte),
      type,
      limit: '100',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`${STRIPE_BASE}/balance_transactions?${params}`, {
      headers: stripeHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe balance_transactions error (${res.status}): ${err.slice(0, 200)}`);
    }

    const data: StripeList<BalanceTxn> = await res.json();
    results.push(...data.data);
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1]!.id;
  }

  return results;
}

export async function fetchETZStripeRevenue(month: string): Promise<RevenueData> {
  if (!STRIPE_SECRET_KEY) {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = monthUnixRange(month);

    // Fetch payments (net = gross charge - Stripe fee)
    // and refunds (net is negative) — mirrors Stripe's "Net volume" calculation.
    const [payments, refunds] = await Promise.all([
      fetchBalanceTxns(gte, lte, 'payment'),
      fetchBalanceTxns(gte, lte, 'refund'),
    ]);

    const paymentCents = payments.reduce((s, t) => s + t.net, 0);
    const refundCents  = refunds.reduce((s, t)  => s + t.net, 0); // already negative

    const totalCents  = paymentCents + refundCents;
    const totalOrders = payments.length;

    return {
      totalRevenue: totalCents / 100,
      totalOrders,
      newCustomers: 0,
      returningCustomers: 0,
      source: 'stripe',
      connected: true,
    };
  } catch (err) {
    console.error('[stripe-revenue]', err);
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }
}
