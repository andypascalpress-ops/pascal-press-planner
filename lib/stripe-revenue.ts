/**
 * Stripe API client for ETZ revenue.
 * Revenue: uses /v1/balance_transactions to match Stripe "Net volume" (after fees, refunds, disputes).
 * Customers: uses /v1/charges?expand[]=data.customer to classify new vs returning.
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
  // UTC — balance_transactions and the Stripe net volume chart both use UTC timestamps.
  const start = new Date(Date.UTC(year!, mon! - 1, 1));
  const end   = new Date(Date.UTC(year!, mon!, 0, 23, 59, 59));
  return {
    gte: Math.floor(start.getTime() / 1000),
    lte: Math.floor(end.getTime()   / 1000),
  };
}

// ─── Balance transactions (net revenue) ──────────────────────────────────────

interface BalanceTxn {
  id: string;
  type: string;
  net: number;
}

interface StripeList<T> { data: T[]; has_more: boolean; }

async function fetchBalanceTxns(gte: number, lte: number, type: string): Promise<BalanceTxn[]> {
  const results: BalanceTxn[] = [];
  let startingAfter: string | null = null;
  while (true) {
    const params = new URLSearchParams({ 'created[gte]': String(gte), 'created[lte]': String(lte), type, limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const res = await fetch(`${STRIPE_BASE}/balance_transactions?${params}`, { headers: stripeHeaders() });
    if (!res.ok) throw new Error(`Stripe balance_transactions ${type} -> HTTP ${res.status}`);
    const data: StripeList<BalanceTxn> = await res.json();
    results.push(...data.data);
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1]!.id;
  }
  return results;
}

// ─── Customer classification ──────────────────────────────────────────────────

interface StripeCharge {
  id: string;
  paid: boolean;
  status: string;
  // customer is expanded → full object, or null for guest checkouts
  customer: { id: string; created: number } | null;
}

async function fetchCustomerStats(
  gte: number,
  lte: number,
): Promise<{ newCustomers: number; returningCustomers: number; totalOrders: number }> {
  const seenCustomerIds = new Map<string, number>(); // customerId → created timestamp
  let guestOrders = 0;
  let totalOrders = 0;
  let startingAfter: string | null = null;

  while (true) {
    const params = new URLSearchParams({
      'created[gte]': String(gte),
      'created[lte]': String(lte),
      'expand[]': 'data.customer',
      limit: '100',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
    if (!res.ok) break;
    const data: StripeList<StripeCharge> = await res.json();

    for (const charge of data.data) {
      if (!charge.paid || charge.status !== 'succeeded') continue;
      totalOrders++;

      if (!charge.customer) {
        // Guest checkout — no prior purchase history available, count as new
        guestOrders++;
      } else {
        // Record the earliest seen customer creation date (deduplicate repeat buyers)
        const existing = seenCustomerIds.get(charge.customer.id);
        if (existing === undefined) {
          seenCustomerIds.set(charge.customer.id, charge.customer.created);
        }
      }
    }

    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1]!.id;
  }

  // Classify: if the customer account was created within this month → new, otherwise → returning.
  // Customer objects in Stripe are created at first checkout, so this is a reliable proxy.
  let newCustomers  = guestOrders;
  let returningCustomers = 0;

  for (const [, created] of seenCustomerIds) {
    if (created >= gte) {
      newCustomers++;
    } else {
      returningCustomers++;
    }
  }

  return { newCustomers, returningCustomers, totalOrders };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchETZStripeRevenue(month: string): Promise<RevenueData> {
  if (!STRIPE_SECRET_KEY) {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = monthUnixRange(month);

    // Run revenue + customer stats in parallel
    const [payments, refunds, customerStats] = await Promise.all([
      fetchBalanceTxns(gte, lte, 'payment'),
      fetchBalanceTxns(gte, lte, 'refund'),
      fetchCustomerStats(gte, lte),
    ]);

    const totalCents = payments.reduce((s, t) => s + t.net, 0)
                     + refunds.reduce((s, t)  => s + t.net, 0); // refund net values are negative

    return {
      totalRevenue: totalCents / 100,
      totalOrders: customerStats.totalOrders,
      newCustomers: customerStats.newCustomers,
      returningCustomers: customerStats.returningCustomers,
      source: 'stripe',
      connected: true,
    };
  } catch (err) {
    console.error('[stripe-revenue]', err);
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }
}
