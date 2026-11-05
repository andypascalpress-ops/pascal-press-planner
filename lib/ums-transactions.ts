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
  byPaymentMethod: Record<string, number>;
  byReturning: Record<string, number>;
  perDay: Record<string, { orders: number; total: number }>;
  itemFieldNames: string[];
  byItemType: Record<string, number>;
  topItems: { name: string; quantity: number }[];
}

function origin(): string {
  const configured = (process.env.UMS_API_URL ?? '').trim();
  try { return configured ? new URL(configured).origin : DEFAULT_ORIGIN; } catch { return DEFAULT_ORIGIN; }
}

function monthChunks(start: string, end: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cur = start;
  while (cur <= end && out.length < 4) {
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

export async function fetchUmsTransactionSummary(start: string, end: string): Promise<UmsTransactionSummary> {
  const token = (process.env.UMS_API_TOKEN ?? '').trim();
  if (!token) throw new Error('UMS_API_TOKEN is not set');

  const byType: Record<string, number> = {};
  const trialsByDay: Record<string, number> = {};
  const familySet = new Set<string>();
  const seenPairs = new Set<string>();
  let rows = 0, trialRows = 0, repeat = 0;
  const orders: OrdersAgg = { count: 0, byStatus: {}, byPaymentMethod: {}, byReturning: {}, perDay: {}, itemFieldNames: [], byItemType: {}, topItems: [] };
  const itemQty = new Map<string, number>();
  const sydneyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
  let fieldNames: string[] = [], topLevelKeys: string[] = [], sampleDateFormat: string | null = null;

  for (const chunk of monthChunks(start, end)) {
    // The live path is /reporting/transactions (plural); Greg's message had the singular, which is a 404
    let res: Response | null = null;
    for (const path of ['reporting/transactions', 'reporting/transaction']) {
      res = await fetch(`${origin()}/${path}?start_date=${chunk.start}&end_date=${chunk.end}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(50_000),
      });
      if (res.status !== 404) break;
    }
    if (!res || !res.ok) throw new Error(`UMS transaction report failed (${res?.status}) for ${chunk.start} to ${chunk.end}`);
    const { rows: data, topKeys } = findRows(await res.json());
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
        const pm = String(r.payment_method ?? 'unknown'); orders.byPaymentMethod[pm] = (orders.byPaymentMethod[pm] ?? 0) + 1;
        const rc = String(r.returning_customer ?? 'unknown'); orders.byReturning[rc] = (orders.byReturning[rc] ?? 0) + 1;
        const d = new Date(String(r.purchase_date));
        if (!isNaN(d.getTime())) { const day = sydneyDay.format(d); const pd = (orders.perDay[day] ??= { orders: 0, total: 0 }); pd.orders += 1; pd.total = Math.round((pd.total + total) * 100) / 100; }
        const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
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
