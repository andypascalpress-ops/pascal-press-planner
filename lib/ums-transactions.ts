/**
 * UMS transaction report (the same list as the UMS "transactions" export), read straight from the API.
 *
 *   GET {UMS address}/reporting/transactions?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *   Authorization: Bearer UMS_API_TOKEN   (environment variable only; never logged or returned)
 *
 * Only aggregate counts leave this file: no names, emails or any per-customer row. The field names of the
 * response are returned so the team can see the shape of the data. One calendar month per call (production database).
 */

const DEFAULT_ORIGIN = 'https://vc3bydynt2.execute-api.ap-southeast-2.amazonaws.com';

export interface UmsTransactionSummary {
  rows: number;
  fieldNames: string[];
  topLevelKeys: string[];
  sampleDateFormat: string | null;
  byType: Record<string, number>;
  trialRows: number;
  trialFamilies: number;
  /** Trial rows where the same family started the same product again. */
  repeatTrialRows: number;
  trialsByDay: Record<string, number>;
  /** Orders report (id, purchase_date, status, total, payment_method, returning_customer, items): counts only. */
  orders: OrdersAgg;
}

export interface OrdersAgg {
  count: number;
  byStatus: Record<string, { orders: number; total: number }>;
  byPaymentMethod: Record<string, { orders: number; total: number }>;
  byReturning: Record<string, number>;
  perDay: Record<string, { orders: number; total: number }>;
  /** Per payment method and Sydney day: rows and items (a row can hold several packs). */
  perMethodDay: Record<string, Record<string, { rows: number; items: number; returning: number }>>;
  itemFieldNames: string[];
  byItemType: Record<string, number>;
  topItems: { name: string; quantity: number }[];
}

function origin(): string {
  const configured = (process.env.UMS_API_URL ?? '').trim();
  try { return configured ? new URL(configured).origin : DEFAULT_ORIGIN; } catch { return DEFAULT_ORIGIN; }
}

function monthChunks(start: string, end: string, max = 4): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cur = start;
  while (cur <= end && out.length < max) {
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

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function dayOf(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  return m ? `${m[3]}-${MONTHS[m[2]!.toLowerCase()] ?? '00'}-${m[1]!.padStart(2, '0')}` : null;
}

function findRows(json: unknown): { rows: Record<string, unknown>[]; topKeys: string[] } {
  if (Array.isArray(json)) return { rows: json as Record<string, unknown>[], topKeys: [] };
  const obj = (json ?? {}) as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  for (const k of ['results', 'transactions', 'data', 'items', 'rows']) if (Array.isArray(obj[k])) return { rows: obj[k] as Record<string, unknown>[], topKeys };
  const any = topKeys.find(k => Array.isArray(obj[k]));
  return { rows: any ? (obj[any] as Record<string, unknown>[]) : [], topKeys };
}

/** One calendar-month chunk of the transaction report. The live path is /reporting/transactions (plural). */
async function fetchTransactionsChunk(token: string, chunk: { start: string; end: string }, cacheInit: { cache?: 'no-store'; next?: { revalidate: number } }): Promise<unknown> {
  let res: Response | null = null;
  for (const path of ['reporting/transactions', 'reporting/transaction']) {
    res = await fetch(`${origin()}/${path}?start_date=${chunk.start}&end_date=${chunk.end}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      ...cacheInit,
      signal: AbortSignal.timeout(50_000),
    });
    if (res.status !== 404) break;
  }
  if (!res || !res.ok) throw new Error(`UMS transaction report failed (${res?.status}) for ${chunk.start} to ${chunk.end}`);
  return res.json();
}

/**
 * Free trials from the transaction report: rows whose payment_method is FREE_TRIAL, counted per pack (one trial per
 * item), the same way the UMS transactions export lists them. Checked against the export for 1-3 Nov 2026: identical
 * per day. The report has no customer id, so families cannot be counted from it.
 */
export async function fetchUmsTrialPacks(start: string, end: string): Promise<{ trials: number; byProduct: { name: string; trials: number }[] }> {
  const token = (process.env.UMS_API_TOKEN ?? '').trim();
  if (!token) throw new Error('UMS_API_TOKEN is not set');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const byProduct = new Map<string, number>();
  let trials = 0;
  for (const chunk of monthChunks(start, end)) {
    const finished = chunk.end < today.slice(0, 8) + '01';
    const { rows } = findRows(await fetchTransactionsChunk(token, chunk, { next: { revalidate: finished ? 86_400 : 900 } }));
    for (const r of rows) {
      if (String(r.payment_method ?? '').toUpperCase() !== 'FREE_TRIAL') continue;
      const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
      if (items.length === 0) { trials += 1; continue; }
      for (const it of items) {
        const n = Number(it.quantity) || 1;
        trials += n;
        const name = String(it.name ?? 'Unknown').trim() || 'Unknown';
        byProduct.set(name, (byProduct.get(name) ?? 0) + n);
      }
    }
  }
  return { trials, byProduct: [...byProduct.entries()].map(([name, n]) => ({ name, trials: n })).sort((x, y) => y.trials - x.trials) };
}

/** Free trials started per Sydney day (one per pack), for a line chart. Days with no trials are 0. */
export async function fetchUmsDailyTrials(start: string, end: string): Promise<Record<string, number>> {
  const token = (process.env.UMS_API_TOKEN ?? '').trim();
  if (!token) throw new Error('UMS_API_TOKEN is not set');
  const sydney = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = sydney.format(new Date());
  const out: Record<string, number> = {};
  for (const chunk of monthChunks(start, end, 14)) {
    const finished = chunk.end < today.slice(0, 8) + '01';
    const { rows } = findRows(await fetchTransactionsChunk(token, chunk, { next: { revalidate: finished ? 86_400 : 900 } }));
    for (const r of rows) {
      if (String(r.payment_method ?? '').toUpperCase() !== 'FREE_TRIAL') continue;
      const d = new Date(String(r.purchase_date));
      if (isNaN(d.getTime())) continue;
      const day = sydney.format(d);
      if (day < start || day > end) continue;
      const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
      out[day] = (out[day] ?? 0) + (items.length ? items.reduce((n, it) => n + (Number(it.quantity) || 1), 0) : 1);
    }
  }
  return out;
}

export async function fetchUmsTransactionSummary(start: string, end: string): Promise<UmsTransactionSummary> {
  const token = (process.env.UMS_API_TOKEN ?? '').trim();
  if (!token) throw new Error('UMS_API_TOKEN is not set');

  const byType: Record<string, number> = {};
  const trialsByDay: Record<string, number> = {};
  const familySet = new Set<string>();
  const seenPairs = new Set<string>();
  let rows = 0, trialRows = 0, repeat = 0;
  const orders: OrdersAgg = { count: 0, byStatus: {}, byPaymentMethod: {}, byReturning: {}, perDay: {}, perMethodDay: {}, itemFieldNames: [], byItemType: {}, topItems: [] };
  const itemQty = new Map<string, number>();
  const sydneyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
  let fieldNames: string[] = [], topLevelKeys: string[] = [], sampleDateFormat: string | null = null;

  for (const chunk of monthChunks(start, end)) {
    const json = await fetchTransactionsChunk(token, chunk, { cache: 'no-store' });
    const { rows: data, topKeys } = findRows(json);
    if (topKeys.length) topLevelKeys = topKeys;
    if (data.length && fieldNames.length === 0) fieldNames = Object.keys(data[0]!);

    const key = (re: RegExp) => fieldNames.find(f => re.test(f));
    const typeKey = key(/purchase.?type|^type$/i), emailKey = key(/e.?mail/i), dateKey = key(/date|time|created/i), productKey = key(/product/i);
    if (dateKey && data.length && !sampleDateFormat) sampleDateFormat = String(data[0]![dateKey] ?? '').slice(0, 40);

    for (const r of data) {
      rows += 1;
      if ('purchase_date' in r) {
        orders.count += 1;
        const status = String(r.status ?? 'unknown');
        const total = parseFloat(String(r.total ?? '0')) || 0;
        const st = (orders.byStatus[status] ??= { orders: 0, total: 0 }); st.orders += 1; st.total = Math.round((st.total + total) * 100) / 100;
        const pm = String(r.payment_method ?? 'unknown'); const pmA = (orders.byPaymentMethod[pm] ??= { orders: 0, total: 0 }); pmA.orders += 1; pmA.total = Math.round((pmA.total + total) * 100) / 100;
        const rc = String(r.returning_customer ?? 'unknown'); orders.byReturning[rc] = (orders.byReturning[rc] ?? 0) + 1;
        const d = new Date(String(r.purchase_date));
        if (!isNaN(d.getTime())) { const day = sydneyDay.format(d); const pd = (orders.perDay[day] ??= { orders: 0, total: 0 }); pd.orders += 1; pd.total = Math.round((pd.total + total) * 100) / 100; }
        const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
        if (!isNaN(d.getTime())) { const md = ((orders.perMethodDay[pm] ??= {})[sydneyDay.format(d)] ??= { rows: 0, items: 0, returning: 0 }); md.rows += 1; md.items += items.reduce((n, it) => n + (Number(it.quantity) || 1), 0); if (String(r.returning_customer) === 'true') md.returning += 1; }
        for (const it of items) {
          if (orders.itemFieldNames.length === 0) orders.itemFieldNames = Object.keys(it);
          const t = String(it.type ?? 'unknown'); orders.byItemType[t] = (orders.byItemType[t] ?? 0) + 1;
          const nm = String(it.name ?? 'unknown'); itemQty.set(nm, (itemQty.get(nm) ?? 0) + (Number(it.quantity) || 1));
        }
        continue;
      }
      const type = String(typeKey ? r[typeKey] ?? '' : '').trim() || 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
      if (!/trial/i.test(type)) continue;
      trialRows += 1;
      const email = String(emailKey ? r[emailKey] ?? '' : '').trim().toLowerCase();
      if (email) familySet.add(email);
      const pair = `${email}|${productKey ? String(r[productKey] ?? '') : ''}`;
      if (seenPairs.has(pair)) repeat += 1; else seenPairs.add(pair);
      const day = dayOf(dateKey ? r[dateKey] : null);
      if (day) trialsByDay[day] = (trialsByDay[day] ?? 0) + 1;
    }
  }
  return { rows, fieldNames, topLevelKeys, sampleDateFormat, byType, trialRows, trialFamilies: familySet.size, repeatTrialRows: repeat, trialsByDay, orders: { ...orders, topItems: [...itemQty.entries()].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 12) } };
}
