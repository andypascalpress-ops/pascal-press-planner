/**
 * Stripe API client for ETZ revenue and customer analytics.
 * Revenue : /v1/charges — gross amount minus per-charge refunds.
 * Customers: only counts customers with net spend > $1 this month.
 *            "New"       = no prior succeeded charge before this month.
 *            "Returning" = has at least one prior succeeded charge.
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
  const start = new Date(Date.UTC(year!, mon! - 1, 1));
  const end   = new Date(Date.UTC(year!, mon!,  0, 23, 59, 59));
  return {
    gte: Math.floor(start.getTime() / 1000),
    lte: Math.floor(end.getTime()   / 1000),
  };
}

interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  paid: boolean;
  status: string;
  customer: { id: string } | null;
}

interface StripeList<T> { data: T[]; has_more: boolean; }

/** Returns true if this customer has any succeeded charge created before `beforeUnix`. */
async function hasPriorCharge(customerId: string, beforeUnix: number): Promise<boolean> {
  const params = new URLSearchParams({
    customer: customerId,
    'created[lt]': String(beforeUnix),
    limit: '1',
  });
  const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
  if (!res.ok) return false;
  const data: StripeList<{ paid: boolean; status: string }> = await res.json();
  // Only count as "prior" if there's an actual succeeded charge, not just a failed attempt
  return data.data.some(c => c.paid && c.status === 'succeeded');
}

export async function fetchETZStripeRevenue(month: string): Promise<RevenueData> {
  if (!STRIPE_SECRET_KEY) {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = monthUnixRange(month);

    let totalCents  = 0;
    let totalOrders = 0;
    // Map from customerId → net cents spent this month (to filter > $1 buyers)
    const customerNetSpend = new Map<string, number>();
    let startingAfter: string | null = null;

    // ── Step 1: collect all succeeded charges ─────────────────────────────────
    while (true) {
      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Stripe charges error (${res.status}): ${err.slice(0, 200)}`);
      }

      const data: StripeList<StripeCharge> = await res.json();

      for (const charge of data.data) {
        if (!charge.paid || charge.status !== 'succeeded') continue;

        const net = charge.amount - (charge.amount_refunded ?? 0);
        totalCents += net;
        totalOrders++;

        // Track per-customer net spend (only for customers with a Stripe ID)
        if (charge.customer?.id) {
          const prev = customerNetSpend.get(charge.customer.id) ?? 0;
          customerNetSpend.set(charge.customer.id, prev + net);
        }
      }

      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1]!.id;
    }

    // ── Step 2: filter to customers who spent > $1 net this month ─────────────
    const qualifyingIds = [...customerNetSpend.entries()]
      .filter(([, cents]) => cents > 100) // > $1.00
      .map(([id]) => id);

    // ── Step 3: check prior charge history in parallel ────────────────────────
    const priorChecks = qualifyingIds.map(id => hasPriorCharge(id, gte));
    const priorResults = await Promise.all(priorChecks);

    let newCustomers       = 0;
    let returningCustomers = 0;
    for (const hasPrior of priorResults) {
      if (hasPrior) {
        returningCustomers++;
      } else {
        newCustomers++;
      }
    }

    return {
      totalRevenue: totalCents / 100,
      totalOrders,
      newCustomers,
      returningCustomers,
      source: 'stripe',
      connected: true,
    };
  } catch (err) {
    console.error('[stripe-revenue]', err);
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }
}
