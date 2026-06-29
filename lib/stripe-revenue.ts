/**
 * Stripe API client for ETZ revenue.
 * Required env var: STRIPE_SECRET_KEY
 */

import { RevenueData } from './bigcommerce-revenue';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeHeaders() {
  return {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
  };
}

function monthUnixRange(month: string): { gte: number; lte: number } {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end   = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
  return {
    gte: Math.floor(start.getTime() / 1000),
    lte: Math.floor(end.getTime() / 1000),
  };
}

interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  paid: boolean;
  status: string;
  amount_refunded: number;
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

export async function fetchETZStripeRevenue(month: string): Promise<RevenueData> {
  if (!STRIPE_SECRET_KEY) {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = monthUnixRange(month);
    let totalCents = 0;
    let totalOrders = 0;
    let startingAfter: string | null = null;

    while (true) {
      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders() });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Stripe API error (HTTP ${res.status}): ${errText.slice(0, 300)}`);
      }

      const data: StripeList<StripeCharge> = await res.json();

      for (const charge of data.data) {
        if (charge.paid && charge.status === 'succeeded') {
          totalCents += charge.amount - (charge.amount_refunded ?? 0);
          totalOrders++;
        }
      }

      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1].id;
    }

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
