/**
 * Stripe API client for ETZ / HSC revenue and customer analytics.
 * Revenue : /v1/charges — net = amount − amount_refunded (refunds attributed to charge date).
 *
 * Date boundaries use Australia/Sydney (AEST/AEDT) so monthly totals match Stripe Dashboard
 * when the account timezone is Sydney — not UTC midnight and not a fixed +10 offset.
 *
 * Customer classification (two modes):
 *  accurate: true  (default) — checks each customer's prior charge history. Exact but
 *                              makes one extra Stripe API call per unique customer. Use for
 *                              current-month display only.
 *  accurate: false            — treats all customers as "returning" unless we can prove
 *                              otherwise via a single prior-charge lookup budget; preferred
 *                              for multi-month history charts (no expand, fewer calls).
 *
 * Both modes only count customers with net spend > $1 to exclude $0 Stripe customer
 * objects created during abandoned checkouts.
 *
 * Required env vars: STRIPE_SECRET_KEY (ETZ), STRIPE_HSC_SECRET_KEY (HSC)
 */

import { RevenueData } from './bigcommerce-revenue';

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY     ?? '';
const STRIPE_HSC_SECRET_KEY = process.env.STRIPE_HSC_SECRET_KEY ?? '';
const STRIPE_BASE = 'https://api.stripe.com/v1';
const ACCOUNT_TZ = 'Australia/Sydney';

function stripeHeaders(key: string) {
  return { Authorization: `Bearer ${key}` };
}

/**
 * Convert a local calendar date/time in `timeZone` to a Unix timestamp (seconds).
 * Handles AEST/AEDT transitions via Intl — do not hardcode +10/+11.
 */
export function zonedDateTimeToUnix(ymd: string, hms: string, timeZone = ACCOUNT_TZ): number {
  const [Y, M, D] = ymd.split('-').map(Number);
  const [h, m, s] = hms.split(':').map(Number);
  const desiredAsUtcMs = Date.UTC(Y!, M! - 1, D!, h!, m!, s!);

  let utcMs = desiredAsUtcMs;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcMs))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asLocalMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const diff = desiredAsUtcMs - asLocalMs;
    if (diff === 0) break;
    utcMs += diff;
  }

  return Math.floor(utcMs / 1000);
}

function monthUnixRange(month: string): { gte: number; lte: number } {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const startYmd = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endYmd   = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    gte: zonedDateTimeToUnix(startYmd, '00:00:00'),
    lte: zonedDateTimeToUnix(endYmd,   '23:59:59'),
  };
}

function dateRangeUnix(start: string, end: string): { gte: number; lte: number } {
  return {
    gte: zonedDateTimeToUnix(start, '00:00:00'),
    lte: zonedDateTimeToUnix(end,   '23:59:59'),
  };
}

interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  paid: boolean;
  status: string;
  // Without expand this is a string id; with expand it is an object
  customer: string | { id: string; created: number } | null;
}

interface StripeList<T> { data: T[]; has_more: boolean; }

function customerIdOf(customer: StripeCharge['customer']): string | null {
  if (!customer) return null;
  if (typeof customer === 'string') return customer;
  return customer.id ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True if the customer had a real prior purchase (net > $1) before `beforeUnix`.
 * Returns null if Stripe errors after retries — caller must not treat that as "new"
 * (a prior bug: failed lookups inflated new-customer counts).
 */
async function hasPriorPaidCharge(
  customerId: string,
  beforeUnix: number,
  secretKey: string,
): Promise<boolean | null> {
  const params = new URLSearchParams({
    customer: customerId,
    'created[lt]': String(beforeUnix),
    limit: '100', // larger page so old paid charges aren't missed behind recent fails
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, {
        headers: stripeHeaders(secretKey),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.error('[stripe-revenue] prior charge lookup failed', customerId, res.status);
        return null;
      }
      const data: StripeList<{ paid: boolean; status: string; amount: number; amount_refunded: number }> =
        await res.json();
      return data.data.some((c) => {
        if (!c.paid || c.status !== 'succeeded') return false;
        const net = (c.amount ?? 0) - (c.amount_refunded ?? 0);
        return net > 100; // > $1.00 AUD — ignore $0 auths / fully refunded noise
      });
    } catch (err) {
      console.error('[stripe-revenue] prior charge lookup error', customerId, err);
      await sleep(250 * (attempt + 1));
    }
  }
  return null;
}

/** Fetch customer.created (unix seconds). Returns null on failure. */
async function fetchCustomerCreated(
  customerId: string,
  secretKey: string,
): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${STRIPE_BASE}/customers/${customerId}`, {
        headers: stripeHeaders(secretKey),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json() as { created?: number };
      return typeof data.created === 'number' ? data.created : null;
    } catch {
      await sleep(250 * (attempt + 1));
    }
  }
  return null;
}

async function fetchStripeRevenueWithKey(
  secretKey: string,
  month: string,
  options?: { accurate?: boolean; dateRange?: { start: string; end: string } },
): Promise<RevenueData> {
  const accurate = options?.accurate !== false;

  if (!secretKey) {
    return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
  }

  try {
    const { gte, lte } = options?.dateRange
      ? dateRangeUnix(options.dateRange.start, options.dateRange.end)
      : monthUnixRange(month);

    let totalCents  = 0;
    let totalOrders = 0;
    // customerId → net cents this period
    const customerNet = new Map<string, number>();
    let startingAfter: string | null = null;
    let pages = 0;

    // No expand[] — keeps payloads small and avoids expand-related truncation.
    // Revenue only needs amount fields; customer is a string id.
    while (true) {
      pages++;
      if (pages > 50) break; // hard safety cap (5000 charges)

      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, {
        headers: stripeHeaders(secretKey),
        cache: 'no-store',
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Stripe charges error (${res.status}): ${err.slice(0, 200)}`);
      }

      const data: StripeList<StripeCharge> = await res.json();

      for (const charge of data.data) {
        if (!charge.paid || charge.status !== 'succeeded') continue;
        const net = (charge.amount ?? 0) - (charge.amount_refunded ?? 0);
        totalCents += net;
        totalOrders++;

        const cid = customerIdOf(charge.customer);
        if (cid) {
          customerNet.set(cid, (customerNet.get(cid) ?? 0) + net);
        }
      }

      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1]!.id;
    }

    // Classify customers who spent > $1 net this period (exclude abandoned $0 customer objects)
    const qualifying = [...customerNet.entries()].filter(([, net]) => net > 100);

    let newCustomers       = 0;
    let returningCustomers = 0;

    if (accurate && qualifying.length > 0) {
      // New = first real payment (net > $1) falls in this period — matches Stripe
      // "customers who made their first payment during this period".
      // Low concurrency + retries avoid rate-limit false "new" counts.
      const ids = qualifying.map(([id]) => id);
      const chunkSize = 4;
      const pending: string[] = [];

      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (id) => {
            const created = await fetchCustomerCreated(id, secretKey);
            // Brand-new Stripe customer object this period ⇒ first payment this period
            if (created != null && created >= gte && created <= lte) {
              return 'new' as const;
            }
            const hasPrior = await hasPriorPaidCharge(id, gte, secretKey);
            if (hasPrior === null) return 'retry' as const;
            return hasPrior ? 'returning' as const : 'new' as const;
          }),
        );
        for (let j = 0; j < chunkResults.length; j++) {
          const kind = chunkResults[j]!;
          if (kind === 'retry') pending.push(chunk[j]!);
          else if (kind === 'returning') returningCustomers++;
          else newCustomers++;
        }
      }

      // Second pass for rate-limited lookups (serial, with backoff)
      for (const id of pending) {
        await sleep(300);
        const hasPrior = await hasPriorPaidCharge(id, gte, secretKey);
        if (hasPrior === true) returningCustomers++;
        else if (hasPrior === false) newCustomers++;
        else {
          // Still unknown after retries: conservatively count as returning so we
          // never inflate new / understate CAC from API blips.
          console.error('[stripe-revenue] classifying as returning after failed prior lookup', id);
          returningCustomers++;
        }
      }
    } else {
      // History charts: skip extra API calls; customer split not shown there
      newCustomers = qualifying.length;
      returningCustomers = 0;
    }

    return {
      totalRevenue: Math.round(totalCents) / 100,
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

export interface CustomerTrendMonth {
  newCustomers: number;
  newRevenue: number;
  returningCustomers: number;
  returningRevenue: number;
}

/**
 * Per-month new vs returning customer revenue split across a set of months,
 * computed with ONE bulk paginated charge fetch spanning the whole window
 * (plus a lookback buffer) — zero per-customer API calls. An earlier version
 * used a customer.created lookup per unique paying customer, which does not
 * scale for a subscription business: ETZ alone has enough distinct paying
 * customers across 12 months that the lookups took well over a minute and
 * risked a function timeout, reintroducing the exact problem accurate:false
 * was meant to fix.
 *
 * A customer counts as "new" in the first month they appear in the fetched
 * window (lookback included). This can misclassify a long-standing customer
 * as "new" if their actual first-ever payment predates the lookback buffer —
 * acceptable for a trend chart; the Finance tab's precise numbers still use
 * the accurate per-period path.
 */
export async function fetchStripeCustomerTrend(
  secretKey: string,
  months: string[],
): Promise<Record<string, CustomerTrendMonth>> {
  // Plain object, not a Map — this crosses an unstable_cache boundary in the
  // caller, and Map/Set objects lose their prototype (and .get()) once
  // round-tripped through the Data Cache's JSON serialization.
  const result: Record<string, CustomerTrendMonth> = {};
  if (!secretKey || months.length === 0) return result;

  try {
    const sorted = [...months].sort();
    const firstMonth = sorted[0]!;

    // Look back a few months before the window so a customer who paid
    // recently but not in the window's first month isn't misclassified as
    // "new" the first time they show up inside the reported window.
    const LOOKBACK_MONTHS = 3;
    const [ly, lm] = firstMonth.split('-').map(Number);
    let lbY = ly!, lbM = lm! - LOOKBACK_MONTHS;
    while (lbM < 1) { lbM += 12; lbY--; }
    const lookbackMonth = `${lbY}-${String(lbM).padStart(2, '0')}`;

    const { gte } = monthUnixRange(lookbackMonth);
    const { lte } = monthUnixRange(sorted[sorted.length - 1]!);

    let startingAfter: string | null = null;
    let pages = 0;
    const firstSeenMonth = new Map<string, string>();                     // customerId -> earliest month seen (incl. lookback)
    const perMonthCustomerNet = new Map<string, Map<string, number>>();   // month -> customerId -> net cents (reported months only)

    while (true) {
      pages++;
      if (pages > 150) break; // hard safety cap (~15,000 charges across window + lookback)

      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_BASE}/charges?${params}`, {
        headers: stripeHeaders(secretKey),
        cache: 'no-store',
      });
      if (!res.ok) break;
      const data: StripeList<StripeCharge & { created: number }> = await res.json();

      for (const charge of data.data) {
        if (!charge.paid || charge.status !== 'succeeded') continue;
        const net = (charge.amount ?? 0) - (charge.amount_refunded ?? 0);
        if (net <= 100) continue; // > $1.00 AUD — matches the "qualifying" rule elsewhere
        const cid = customerIdOf(charge.customer);
        if (!cid) continue;

        const month = new Date((charge.created * 1000) + 10 * 60 * 60 * 1000)
          .toISOString().slice(0, 7); // AEST month

        const seen = firstSeenMonth.get(cid);
        if (!seen || month < seen) firstSeenMonth.set(cid, month);

        if (months.includes(month)) {
          const monthMap = perMonthCustomerNet.get(month) ?? new Map<string, number>();
          monthMap.set(cid, (monthMap.get(cid) ?? 0) + net);
          perMonthCustomerNet.set(month, monthMap);
        }
      }

      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1]!.id;
    }

    for (const month of months) {
      const monthMap = perMonthCustomerNet.get(month);
      let newCustomers = 0, newRevenue = 0, returningCustomers = 0, returningRevenue = 0;
      if (monthMap) {
        for (const [cid, netCents] of monthMap) {
          if (firstSeenMonth.get(cid) === month) {
            newCustomers++;
            newRevenue += netCents;
          } else {
            returningCustomers++;
            returningRevenue += netCents;
          }
        }
      }
      result[month] = {
        newCustomers,
        newRevenue: Math.round(newRevenue) / 100,
        returningCustomers,
        returningRevenue: Math.round(returningRevenue) / 100,
      };
    }
  } catch (err) {
    console.error('[stripe-revenue] customer trend error', err);
  }

  return result;
}

export async function fetchETZStripeRevenue(
  month: string,
  options?: { accurate?: boolean; dateRange?: { start: string; end: string } },
): Promise<RevenueData> {
  return fetchStripeRevenueWithKey(STRIPE_SECRET_KEY, month, options);
}

export async function fetchHSCStripeRevenue(
  month: string,
  options?: { accurate?: boolean; dateRange?: { start: string; end: string } },
): Promise<RevenueData> {
  return fetchStripeRevenueWithKey(STRIPE_HSC_SECRET_KEY, month, options);
}

export async function fetchETZCustomerTrend(months: string[]): Promise<Record<string, CustomerTrendMonth>> {
  return fetchStripeCustomerTrend(STRIPE_SECRET_KEY, months);
}

export async function fetchHSCCustomerTrend(months: string[]): Promise<Record<string, CustomerTrendMonth>> {
  return fetchStripeCustomerTrend(STRIPE_HSC_SECRET_KEY, months);
}

/**
 * Revenue and charge count per product description for every succeeded charge
 * in [start, end] (YYYY-MM-DD, AEST). Fully paginated — a single page would
 * silently drop earlier charges in any busy period.
 */
export async function fetchStripeProductMap(
  key: string, start: string, end: string,
): Promise<Map<string, { revenue: number; qty: number }>> {
  const map = new Map<string, { revenue: number; qty: number }>();
  if (!key) return map;
  try {
    const gte = zonedDateTimeToUnix(start, '00:00:00');
    const lte = zonedDateTimeToUnix(end, '23:59:59');

    let startingAfter: string | undefined;
    let pages = 0;
    while (true) {
      pages++;
      if (pages > 50) break; // hard safety cap (5,000 charges)

      const params = new URLSearchParams({
        'created[gte]': String(gte),
        'created[lte]': String(lte),
        limit: '100',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
        headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
      });
      if (!res.ok) break;
      const { data: charges, has_more } = await res.json() as {
        data: { id: string; status: string; description: string | null; amount: number; amount_refunded: number }[];
        has_more: boolean;
      };

      for (const c of charges) {
        if (c.status !== 'succeeded') continue;
        const net = (c.amount - (c.amount_refunded ?? 0)) / 100;
        if (net <= 0) continue;
        const name  = c.description || 'Other';
        const entry = map.get(name) ?? { revenue: 0, qty: 0 };
        map.set(name, { revenue: entry.revenue + net, qty: entry.qty + 1 });
      }

      if (!has_more || charges.length === 0) break;
      startingAfter = charges[charges.length - 1]!.id;
    }
  } catch { /* return what we have */ }
  return map;
}

export interface DailyRevenue { revenue: number; orders: number }

const sydneyYmd = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACCOUNT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Net revenue and charge count per Sydney calendar day for [start, end] (YYYY-MM-DD).
 * Uses the same rules as fetchStripeRevenueWithKey (paid + succeeded charges, net of refunds),
 * so the daily figures add up to the period totals shown elsewhere. Throws on API failure.
 */
export async function fetchStripeDailyRevenue(
  secretKey: string, start: string, end: string,
): Promise<Record<string, DailyRevenue>> {
  const out: Record<string, DailyRevenue> = {};
  if (!secretKey) return out;
  const gte = zonedDateTimeToUnix(start, '00:00:00');
  const lte = zonedDateTimeToUnix(end, '23:59:59');

  let startingAfter: string | null = null;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ 'created[gte]': String(gte), 'created[lte]': String(lte), limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);

    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders(secretKey), cache: 'no-store' });
      if (res.ok) break;
      if (res.status !== 429 && res.status < 500) break;
      await sleep(400 * Math.pow(2, attempt));
    }
    if (!res || !res.ok) throw new Error(`Stripe charges error (${res?.status ?? 'no response'})`);

    const data = await res.json() as { data: (StripeCharge & { created: number })[]; has_more: boolean };
    for (const c of data.data) {
      if (!c.paid || c.status !== 'succeeded') continue;
      const day = sydneyYmd.format(new Date(c.created * 1000));
      const cell = (out[day] ??= { revenue: 0, orders: 0 });
      cell.revenue += ((c.amount ?? 0) - (c.amount_refunded ?? 0)) / 100;
      cell.orders += 1;
    }
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1]!.id;
  }
  for (const k of Object.keys(out)) out[k]!.revenue = Math.round(out[k]!.revenue * 100) / 100;
  return out;
}

export async function fetchETZDailyRevenue(start: string, end: string) {
  return fetchStripeDailyRevenue(STRIPE_SECRET_KEY, start, end);
}

export async function fetchHSCDailyRevenue(start: string, end: string) {
  return fetchStripeDailyRevenue(STRIPE_HSC_SECRET_KEY, start, end);
}
