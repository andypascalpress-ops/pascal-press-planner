/**
 * Stripe API client for ETZ revenue and customer analytics.
 * Revenue : /v1/charges — gross amount minus per-charge refunds.
 *
 * Customer classification (two modes):
 *  accurate: true  (default) — checks each customer's prior charge history. Exact but
 *                              makes one extra Stripe API call per unique customer. Use for
 *                              current-month display only.
 *  accurate: false            — uses customer.created date as proxy. Fast (no extra calls),
 *                              suitable for multi-month history charts.
 *
 * Both modes only count customers with net spend > $1 to exclude $0 Stripe customer
 * objects created during abandoned checkouts.
 *
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

function dateRangeUnix(start: string, end: string): { gte: number; lte: number } {
  return {
    gte: Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000),
    lte: Math.floor(new Date(`${end}T23:59:59Z`).getTime()   / 1000),
  };
}

interface StripeChargeExpanded {
  id: string;
  amount: number;
  amount_refunded: number;
  paid: boolean;
  status: string;
  customer: { id: string; created: number } | null;
}

interface StripeList<T> { data: T[]; has_more: boolean; }

/** Returns true if the customer had any succeeded charge created before `beforeUnix`. */
async function hasPriorCharge(customerId: string, beforeUnix: number): Promise<boolean> {
  const params = new URLSearchParams({
    customer: customerId,
    'created[lt]': String(beforeUnix),
    limit: '1',
  });
  const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
  if (!res.ok) return false;
  const data: StripeList<{ paid: boolean; status: string }> = await res.json();
  return data.data.some(c => c.paid && c.status === 'succeeded');
}

export async function fetchETZStripeRevenue(
  month: string,
  options?: { accurate?: boolean; dateRange?: { start: string; end: string } },
): Promise<RevenueData> {
  // accurate defaults to true (exact new/returning via prior-charge lookup)
  const accurate = options?.accurate !== false;

  if (!STRIPE_SECRET_KEY) {
    return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = options?.dateRange
      ? dateRangeUnix(options.dateRange.start, options.dateRange.end)
      : monthUnixRange(month);

    let totalCents  = 0;
    let totalOrders = 0;
    // customerId → { created: unix, netCents: total net cents this month }
    const customerMap = new Map<string, { created: number; netCents: number }>();
    let startingAfter: string | null = null;

    // ── Fetch all succeeded charges with expanded customer objects ────────────
    while (true) {
      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        'expand[]': 'data.customer',
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Stripe charges error (${res.status}): ${err.slice(0, 200)}`);
      }

      const data: StripeList<StripeChargeExpanded> = await res.json();

      for (const charge of data.data) {
        if (!charge.paid || charge.status !== 'succeeded') continue;
        const net = charge.amount - (charge.amount_refunded ?? 0);
        totalCents += net;
        totalOrders++;

        if (charge.customer?.id) {
          const prev = customerMap.get(charge.customer.id);
          if (!prev) {
            customerMap.set(charge.customer.id, {
              created: charge.customer.created,
              netCents: net,
            });
          } else {
            prev.netCents += net;
          }
        }
      }

      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1]!.id;
    }

    // ── Classify customers who spent > $1 net this month ─────────────────────
    const qualifying = [...customerMap.entries()].filter(([, v]) => v.netCents > 100);

    let newCustomers       = 0;
    let returningCustomers = 0;

    if (accurate) {
      // Exact mode: check actual prior charge history in parallel.
      const checks = qualifying.map(([id]) => hasPriorCharge(id, gte));
      const results = await Promise.all(checks);
      for (const hasPrior of results) {
        if (hasPrior) returningCustomers++;
        else newCustomers++;
      }
    } else {
      // Quick mode: use customer.created date as proxy (no extra API calls).
      // Suitable for multi-month history charts.
      for (const [, { created }] of qualifying) {
        if (created >= gte) newCustomers++;
        else returningCustomers++;
      }
    }

    return {
      totalRevenue: totalCents / 100,
      // Stripe doesn't track referral source — Google revenue breakdown not applicable
      googlePaidRevenue: 0,
      googleOrganicRevenue: 0,
      totalOrders,
      newCustomers,
      returningCustomers,
      source: 'stripe',
      connected: true,
    };
  } catch (err) {
    console.error('[stripe-revenue]', err);
    return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }
}
