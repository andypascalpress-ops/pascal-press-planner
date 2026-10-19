/**
 * Excel Test Zone free trials straight from the UMS (user management system) conversion report.
 *
 * Endpoint (set in Vercel, never in the browser):
 *   UMS_API_URL    the conversion-report address (defaults to the production address Greg supplied)
 *   UMS_API_TOKEN  bearer token. Sensitive: environment variable only, never logged, never returned.
 *
 * The report returns one row per customer who started a trial in the date range:
 *   { trials: [{ product_id, product_name, start_time, end_time }], first_purchase_items: [{ type, id, name, quantity }] }
 * Bulk school sign-ups are not trials in the UMS, so they are not included. A customer can hold several trials
 * (one per child or product). first_purchase_items is the first purchase after the trial started; it is empty
 * when they have not bought. (The purchase date and amount are being added by IT.)
 *
 * The endpoint reads the PRODUCTION database and errors on long ranges, so this module:
 *   - splits any range into calendar-month chunks and calls them one at a time,
 *   - caches every chunk for an hour (completed past months for a day),
 *   - times out each call, and
 *   - returns only aggregate counts (no per-customer rows leave this file).
 */

const DEFAULT_URL = 'https://vc3bydynt2.execute-api.ap-southeast-2.amazonaws.com/reporting/conversion-report';

interface UmsRow {
  trials?: { product_id?: number; product_name?: string; start_time?: string; end_time?: string }[];
  first_purchase_items?: { type?: string; id?: number; name?: string; quantity?: number }[];
}

export interface UmsTrialSummary {
  /** Customers who started at least one trial in the range. */
  customers: number;
  /** Trial records (a customer can start more than one). */
  trials: number;
  /** Customers with a purchase after their trial started. */
  customersWhoBought: number;
  /** customersWhoBought divided by customers, whole percent (null when there are no customers). */
  pct: number | null;
  /** Customers holding more than one trial. */
  customersWithMultipleTrials: number;
  /** Trial records per product name, largest first. */
  byProduct: { name: string; trials: number }[];
}

export function umsConfigured(): boolean {
  return Boolean((process.env.UMS_API_TOKEN ?? '').trim());
}

function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Calendar-month chunks covering [start, end] (YYYY-MM-DD, inclusive). */
function monthChunks(start: string, end: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cur = start;
  while (cur <= end) {
    const [y, m] = cur.split('-').map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    const chunkEnd = last < end ? last : end;
    out.push({ start: cur, end: chunkEnd });
    const next = new Date(`${chunkEnd}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
  }
  return out;
}

async function fetchChunk(start: string, end: string): Promise<UmsRow[]> {
  const token = (process.env.UMS_API_TOKEN ?? '').trim();
  if (!token) throw new Error('UMS_API_TOKEN is not set');
  const base = (process.env.UMS_API_URL ?? '').trim() || DEFAULT_URL;
  const url = `${base}?start_date=${start}&end_date=${end}`;
  // a month that has fully finished will not change much: cache it for a day; anything else for an hour
  const finished = end < sydneyToday().slice(0, 8) + '01';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    next: { revalidate: finished ? 86_400 : 3_600 },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`UMS conversion report failed (${res.status}) for ${start} to ${end}`);
  const json = await res.json() as { results?: UmsRow[] };
  return Array.isArray(json.results) ? json.results : [];
}

export async function fetchUmsTrials(start: string, end: string): Promise<UmsTrialSummary> {
  const rows: UmsRow[] = [];
  // one at a time: this hits the production database
  for (const chunk of monthChunks(start, end)) rows.push(...await fetchChunk(chunk.start, chunk.end));

  const byProduct = new Map<string, number>();
  let trials = 0, bought = 0, multi = 0;
  for (const r of rows) {
    const t = r.trials ?? [];
    trials += t.length;
    if (t.length > 1) multi += 1;
    if ((r.first_purchase_items ?? []).length > 0) bought += 1;
    for (const x of t) {
      const name = (x.product_name ?? 'Unknown').trim() || 'Unknown';
      byProduct.set(name, (byProduct.get(name) ?? 0) + 1);
    }
  }
  return {
    customers: rows.length,
    trials,
    customersWhoBought: bought,
    pct: rows.length > 0 ? Math.round((bought / rows.length) * 100) : null,
    customersWithMultipleTrials: multi,
    byProduct: [...byProduct.entries()].map(([name, n]) => ({ name, trials: n })).sort((a, b) => b.trials - a.trials),
  };
}
