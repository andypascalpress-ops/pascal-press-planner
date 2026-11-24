/**
 * Excel Test Zone executive report: every figure, computed from the UMS transaction list (from 1 Jul 2024) plus ad spend.
 *
 * Rules follow the hand-made report (G's version, 24 Nov 2026), with the anonymous parent id in place of email:
 *  - Online = CARD rows above $0 (Stripe). Schools = INVOICE rows above $0 for revenue; $0 allocations count as schools only.
 *  - Customers = distinct parent ids (a parent buying several packs counts once). Schools = distinct school account ids
 *    (the export used school names; the API has no name, so this is the closest equivalent).
 *  - UMS manual entries (students added to an existing school licence) and unknown / coupon rows are left out of every count.
 *  - Duplicated bundle rows (same parent, same minute, same items, full price on both) are dropped; the extra copy is counted
 *    in dataNotes. Orders listed in the ETZ_EXCLUDED_ORDERS setting (for example a refunded school order paid through Stripe) are left out.
 *  - Revenue is not net of refunds. Days are Sydney days; the report runs to the last complete day.
 * Only totals leave this file: no ids, emails or names.
 */
import { fetchUmsRows, type UmsRawRow } from '@/lib/ums-transactions';

export const DATA_START = '2024-07-01';

/** Promotion windows marked on the charts. Update when a new promotion is planned. */
export const PROMOS = {
  thisYear: { start: '2026-11-10', end: '2026-11-29', label: 'This year promo 10–29 Nov' },
  lastYear: { start: '2025-11-11', end: '2025-11-15', label: "Last year's Black Friday promo 11–15 Nov 2025" },
};

/**
 * Orders known to be refunded or misfiled, left out as in the hand-made report. Kept in a Vercel setting, not in code:
 *   ETZ_EXCLUDED_ORDERS = "YYYY-MM-DD:amount,YYYY-MM-DD:amount"
 */
function excludedOrders(): { day: string; total: number }[] {
  return (process.env.ETZ_EXCLUDED_ORDERS ?? '').split(',').map(x => x.trim()).filter(Boolean)
    .map(x => { const [day, amt] = x.split(':'); return { day: (day ?? '').trim(), total: parseFloat(amt ?? '') }; })
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.day) && Number.isFinite(x.total));
}

/** First month with ad spend in the report (the advertising history starts here). */
export const AD_START_MONTH = '2025-11';

// ---------------------------------------------------------------- dates (Sydney)

const sydDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
const sydMinute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const todaySydney = () => sydDay.format(new Date());
export function addDays(ymd: string, n: number): string { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + n, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12)).getUTCDate();
  t.setUTCDate(Math.min(d!, last));
  return t.toISOString().slice(0, 10);
}
export const monthOf = (ymd: string) => ymd.slice(0, 7);
export function monthEnd(ym: string): string { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0, 12)).toISOString().slice(0, 10); }
export function nextMonth(ym: string): string { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`; }
export function monthsBetween(a: string, b: string): string[] { const out: string[] = []; for (let m = a; m <= b; m = nextMonth(m)) out.push(m); return out; }
export const fyStart = (ymd: string) => { const [y, m] = ymd.split('-').map(Number); return m! >= 7 ? `${y}-07-01` : `${y! - 1}-07-01`; };
const shiftYear = (ymd: string, n = -1) => addMonths(ymd, 12 * n);
const daysDiff = (a: number, b: number) => (b - a) / 86_400_000;

// ---------------------------------------------------------------- normalised rows

export interface Order { id: string; uid: string; day: string; at: number; total: number; lines: { name: string; line: ProductLine; amount: number }[] }
export interface Trial { uid: string; day: string; at: number; pack: string }
export interface SchoolTx { uid: string; day: string; total: number }
export type ProductLine = 'Bundles' | 'NAPLAN' | 'Selective & Scholarship' | 'Opportunity Class' | 'Assessment / Skills Check' | 'Other';
export const PRODUCT_LINES: ProductLine[] = ['Bundles', 'NAPLAN', 'Selective & Scholarship', 'Opportunity Class', 'Assessment / Skills Check'];

function productLine(name: string): ProductLine {
  const n = name.toLowerCase();
  if (n.includes('bundle')) return 'Bundles';
  if (n.includes('naplan')) return 'NAPLAN';
  if (n.includes('selective') || n.includes('scholarship')) return 'Selective & Scholarship';
  if (n.includes('opportunity class')) return 'Opportunity Class';
  if (n.includes('skills check') || n.includes('assessment')) return 'Assessment / Skills Check';
  return 'Other';
}
const num = (v: unknown) => { const n = parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v).trim());

export interface Dataset {
  asOf: string;
  orders: Order[]; trials: Trial[]; schools: SchoolTx[];
  notes: { duplicateRows: number; duplicateValue: number; duplicateLastSeen: string | null; manualRows: number; unknownRows: number; zeroCardRows: number; excludedOrders: number; rowsWithoutParent: number; schoolRowsWithoutId: number };
}

export function normalise(raw: UmsRawRow[], asOf: string): Dataset {
  const orders: Order[] = [], trials: Trial[] = [], schools: SchoolTx[] = [];
  const notes = { duplicateRows: 0, duplicateValue: 0, duplicateLastSeen: null as string | null, manualRows: 0, unknownRows: 0, zeroCardRows: 0, excludedOrders: 0, rowsWithoutParent: 0, schoolRowsWithoutId: 0 };
  const seen = new Set<string>();
  const lastAt = new Map<string, number>();
  const dupBy = new Map<string, number>();
  const excluded = excludedOrders();
  const excludedKeys = new Set<string>();
  if (excluded.length) {
    const sums = new Map<string, number>();
    for (const r of raw) {
      if (str(r.payment_method).toUpperCase() !== 'CARD') continue;
      const d0 = new Date(str(r.purchase_date)); if (isNaN(d0.getTime())) continue;
      const k = `${str(r.user_id)}|${sydDay.format(d0)}`; sums.set(k, (sums.get(k) ?? 0) + num(r.total));
    }
    for (const [k, total] of sums) if (excluded.some(x => k.endsWith(`|${x.day}`) && Math.abs(x.total - total) < 1)) excludedKeys.add(k);
  }
  const sorted = [...raw].sort((a, b) => str(a.purchase_date).localeCompare(str(b.purchase_date)));
  // full price = the highest price each item set has sold for (promotional prices are lower)
  const itemsKey = (r: UmsRawRow) => (Array.isArray(r.items) ? r.items : []).map(it => `${str(it.name)}x${num(it.quantity) || 1}`).sort().join('|');
  const fullPriceOf = new Map<string, number>();
  for (const r of sorted) { if (str(r.payment_method).toUpperCase() !== 'CARD') continue; const k = itemsKey(r), t = num(r.total); if (t > (fullPriceOf.get(k) ?? 0)) fullPriceOf.set(k, t); }
  for (const r of sorted) {
    const d = new Date(str(r.purchase_date));
    if (isNaN(d.getTime())) continue;
    const day = sydDay.format(d);
    if (day < DATA_START || day > asOf) continue;
    const method = str(r.payment_method).toUpperCase();
    const uid = str(r.user_id);
    const total = num(r.total);
    const items = Array.isArray(r.items) ? r.items : [];
    if (method === 'MANUAL') { notes.manualRows += 1; continue; }
    if (method !== 'CARD' && method !== 'INVOICE' && method !== 'FREE_TRIAL') { notes.unknownRows += 1; continue; }
    // school orders carry no parent id: their revenue still counts; schools can only be counted where an id is present
    if (method === 'INVOICE') { schools.push({ uid, day, total }); if (!uid) notes.schoolRowsWithoutId += 1; continue; }
    if (!uid) { notes.rowsWithoutParent += 1; continue; }
    if (method === 'FREE_TRIAL') {
      for (const it of items.length ? items : [{ name: 'Unknown' }]) trials.push({ uid, day, at: d.getTime(), pack: str(it.name) || 'Unknown' });
      continue;
    }
    // CARD (online)
    if (total <= 0) { notes.zeroCardRows += 1; continue; }
    if (excludedKeys.has(`${uid}|${day}`) || excluded.some(x => x.day === day && Math.abs(x.total - total) < 0.01)) { notes.excludedOrders += 1; continue; }
    const names = items.map(it => `${str(it.name)}x${num(it.quantity) || 1}`).sort().join('|');
    const key = `${uid}|${sydMinute.format(d)}|${names}|${total.toFixed(2)}`;
    // a duplicate is only dropped at full price on both rows, as in the hand-made report
    const fullPrice = total >= (fullPriceOf.get(names) ?? Infinity) - 0.01;
    // a logging duplicate lands within a few seconds of the original; rows further apart are real repeat purchases
    const nearTwin = seen.has(key);
    if (nearTwin && fullPrice && names.toLowerCase().includes('bundle')) {
      notes.duplicateRows += 1; notes.duplicateValue += total;
      { const k = `${names} @ ${total.toFixed(0)} (gap ${Math.round((d.getTime() - (lastAt.get(key) ?? d.getTime())) / 1000)}s)`.replace(/ \(gap \d+s\)/, d.getTime() - (lastAt.get(key) ?? 0) < 5000 ? ' (<5s)' : ' (5-60s)'); dupBy.set(k, (dupBy.get(k) ?? 0) + 1); }
      if (!notes.duplicateLastSeen || day > notes.duplicateLastSeen) notes.duplicateLastSeen = day;
      continue;
    }
    seen.add(key);
    lastAt.set(key, d.getTime());
    let lines = items.map(it => ({ name: str(it.name) || 'Unknown', amount: num(it.total) || num(it.unit_price) * (num(it.quantity) || 1) }));
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    if (!lines.length) lines = [{ name: 'Unknown', amount: total }];
    else if (sum > 0 && Math.abs(sum - total) > 0.01) lines = lines.map(l => ({ ...l, amount: (l.amount / sum) * total }));
    else if (sum === 0) lines = lines.map(l => ({ ...l, amount: total / lines.length }));
    orders.push({ id: str(r.id), uid, day, at: d.getTime(), total, lines: lines.map(l => ({ ...l, line: productLine(l.name) })) });
  }
  notes.duplicateValue = Math.round(notes.duplicateValue);
  (notes as Record<string, unknown>).duplicateBreakdown = [...dupBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  return { asOf, orders, trials, schools, notes };
}

// ---------------------------------------------------------------- window totals

export interface Window {
  start: string; end: string;
  online: number; orders: number; aov: number | null;
  schools: number; payingSchools: number; allSchools: number;
  total: number;
  customers: number; trialCustomers: number;
  trialBought: number;          // trial customers in the window who bought online in the window after their trial
  newCustomers: number;         // first ever paid online purchase falls in the window
  returning: number;            // bought in the window and had paid before it
  byLine: Record<ProductLine, number>;
}

export function makeIndex(ds: Dataset) {
  const firstPurchase = new Map<string, number>();
  const purchasesByUid = new Map<string, number[]>();
  for (const o of ds.orders) {
    if (!firstPurchase.has(o.uid) || o.at < firstPurchase.get(o.uid)!) firstPurchase.set(o.uid, o.at);
    const a = purchasesByUid.get(o.uid) ?? []; a.push(o.at); purchasesByUid.set(o.uid, a);
  }
  for (const a of purchasesByUid.values()) a.sort((x, y) => x - y);
  const firstTrial = new Map<string, Trial>();
  for (const t of ds.trials) { const f = firstTrial.get(t.uid); if (!f || t.at < f.at) firstTrial.set(t.uid, t); }
  return { firstPurchase, purchasesByUid, firstTrial };
}
type Index = ReturnType<typeof makeIndex>;

export function windowTotals(ds: Dataset, ix: Index, start: string, end: string): Window {
  const os = ds.orders.filter(o => o.day >= start && o.day <= end);
  const ts = ds.trials.filter(t => t.day >= start && t.day <= end);
  const ss = ds.schools.filter(s => s.day >= start && s.day <= end);
  const online = os.reduce((s, o) => s + o.total, 0);
  const schoolRev = ss.filter(s => s.total > 0).reduce((s, x) => s + x.total, 0);
  const customers = new Set(os.map(o => o.uid));
  const trialUids = new Set(ts.map(t => t.uid));
  const firstTrialInWin = new Map<string, number>();
  for (const t of ts) { const f = firstTrialInWin.get(t.uid); if (f === undefined || t.at < f) firstTrialInWin.set(t.uid, t.at); }
  let trialBought = 0;
  for (const [uid, at] of firstTrialInWin) if (os.some(o => o.uid === uid && o.at >= at)) trialBought += 1;
  const startAt = new Date(`${start}T00:00:00+10:00`).getTime();
  let newC = 0, ret = 0;
  for (const uid of customers) { const f = ix.firstPurchase.get(uid)!; if (sydDay.format(new Date(f)) >= start) newC += 1; else ret += 1; }
  void startAt;
  const byLine = Object.fromEntries([...PRODUCT_LINES, 'Other'].map(l => [l, 0])) as Record<ProductLine, number>;
  for (const o of os) for (const l of o.lines) byLine[l.line] += l.amount;
  return {
    start, end,
    online, orders: os.length, aov: os.length ? online / os.length : null,
    schools: schoolRev, payingSchools: new Set(ss.filter(s => s.total > 0 && s.uid).map(s => s.uid)).size, allSchools: new Set(ss.filter(s => s.uid).map(s => s.uid)).size,
    total: online + schoolRev,
    customers: customers.size, trialCustomers: trialUids.size, trialBought,
    newCustomers: newC, returning: ret, byLine,
  };
}

// ---------------------------------------------------------------- the whole report

export interface AdMonth { month: string; google: number | null; meta: number | null; total: number | null; partial: boolean; source: 'live' | 'none' }

export async function buildEtzExecData(asOfIn?: string, adLive?: (month: string, start: string, end: string) => Promise<{ google: number; meta: number } | null>) {
  const asOf = asOfIn ?? addDays(todaySydney(), -1);
  const raw = await fetchUmsRows(DATA_START, asOf);
  const ds = normalise(raw, asOf);
  const ix = makeIndex(ds);
  const W = (s: string, e: string) => windowTotals(ds, ix, s, e);

  const curMonth = monthOf(asOf);
  const mtdStart = `${curMonth}-01`;
  const lyAsOf = shiftYear(asOf);
  const lyMonthStart = shiftYear(mtdStart);
  const fy = fyStart(asOf), lyFy = shiftYear(fy);
  const r12Start = addDays(shiftYear(asOf), 1), p12Start = addDays(shiftYear(asOf, -2), 1), p12End = shiftYear(asOf);

  // --- headline windows
  const mtd = W(mtdStart, asOf), mtdLy = W(lyMonthStart, lyAsOf), lyFullMonth = W(lyMonthStart, monthEnd(monthOf(lyMonthStart)));
  const fytd = W(fy, asOf), fytdLy = W(lyFy, lyAsOf), lyFullFy = W(lyFy, addDays(fy, -1));
  const r12 = W(r12Start, asOf), p12 = W(p12Start, p12End);

  // --- monthly table (last 15 months)
  const tableMonths = monthsBetween(monthOf(addMonths(mtdStart, -14)), curMonth);
  const monthly = tableMonths.map(m => { const w = W(`${m}-01`, m === curMonth ? asOf : monthEnd(m)); return { month: m, partial: m === curMonth, ...w }; });

  // --- day by day for the current month vs the same dates last year
  const dim = Number(monthEnd(curMonth).slice(8, 10));
  const lyMonth = monthOf(lyMonthStart), lyDim = Number(monthEnd(lyMonth).slice(8, 10));
  const daily = Array.from({ length: Math.max(dim, lyDim) }, (_, i) => {
    const d = i + 1, dd = String(d).padStart(2, '0');
    const tyDay = `${curMonth}-${dd}`, lyDay = `${lyMonth}-${dd}`;
    const per = (day: string, okDay: boolean) => okDay ? {
      trials: new Set(ds.trials.filter(t => t.day === day).map(t => t.uid)).size,
      paying: new Set(ds.orders.filter(o => o.day === day).map(o => o.uid)).size,
    } : null;
    const weekday = new Date(`${tyDay}T12:00:00Z`).getUTCDay();
    return { day: d, weekday, ty: d <= dim && tyDay <= asOf ? per(tyDay, true) : null, ly: d <= lyDim ? per(lyDay, true) : null };
  });
  const cumulative = (start: string, end: string) => {
    const seenU = new Set<string>(); const out: number[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) { for (const o of ds.orders) if (o.day === day) seenU.add(o.uid); out.push(seenU.size); }
    return out;
  };
  const cumulativePaying = { ty: cumulative(mtdStart, asOf), ly: cumulative(lyMonthStart, monthEnd(lyMonth)) };
  const weekBuckets = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]].map(([a, b]) => {
    const bEnd = Math.min(b!, dim), lyEnd = Math.min(b!, lyDim);
    const ty = (() => { const s = `${curMonth}-${String(a).padStart(2, '0')}`; const e0 = `${curMonth}-${String(bEnd).padStart(2, '0')}`; const e = e0 > asOf ? asOf : e0; return s > asOf || a! > dim ? null : W(s, e); })();
    const lyEndDay = ty ? Math.min(lyEnd, Number(ty.end.slice(8, 10))) : lyEnd;
    const ly = a! > lyDim ? null : W(`${lyMonth}-${String(a).padStart(2, '0')}`, `${lyMonth}-${String(lyEndDay).padStart(2, '0')}`);
    const lyFull = a! > lyDim ? null : W(`${lyMonth}-${String(a).padStart(2, '0')}`, `${lyMonth}-${String(lyEnd).padStart(2, '0')}`);
    return { from: a, to: b === 31 ? dim : b, partialTo: ty && ty.end < `${curMonth}-${String(bEnd).padStart(2, '0')}` ? Number(ty.end.slice(8, 10)) : null,
      ty: ty && { trials: ty.trialCustomers, paying: ty.customers }, ly: ly && { trials: ly.trialCustomers, paying: ly.customers }, lyFull: lyFull && { trials: lyFull.trialCustomers, paying: lyFull.customers } };
  });
  const lyRest = (() => { const s = addDays(lyAsOf, 1), e = monthEnd(lyMonth); return s > e ? null : W(s, e); })();
  const promo = {
    ...PROMOS,
    tyToDate: PROMOS.thisYear.start <= asOf ? W(PROMOS.thisYear.start, asOf < PROMOS.thisYear.end ? asOf : PROMOS.thisYear.end) : null,
    lySameDates: PROMOS.thisYear.start <= asOf ? W(shiftYear(PROMOS.thisYear.start), shiftYear(asOf < PROMOS.thisYear.end ? asOf : PROMOS.thisYear.end)) : null,
  };

  // --- FY month-end positions (cumulative from 1 Jul), this year to date and the whole of last year
  const fyMonths = monthsBetween(monthOf(fy), curMonth);
  const lyFyMonths = monthsBetween(monthOf(lyFy), monthOf(addDays(fy, -1)));
  const cumFy = (start: string, month: string, cap: string) => { const e0 = monthEnd(month); return W(start, e0 > cap ? cap : e0); };
  const fyPositions = fyMonths.map(m => {
    const ty = cumFy(fy, m, asOf);
    const lyM = monthOf(shiftYear(`${m}-01`));
    const ly = cumFy(lyFy, lyM, m === curMonth ? lyAsOf : monthEnd(lyM));
    return { month: m, partial: m === curMonth, ty: pickFy(ty), ly: pickFy(ly) };
  });
  const lyFyCurve = lyFyMonths.map(m => ({ month: m, ...pickFy(cumFy(lyFy, m, monthEnd(m))) }));
  const fyMonthlyBars = fyMonths.map(m => {
    const tyEnd = m === curMonth ? asOf : monthEnd(m);
    const lyM = monthOf(shiftYear(`${m}-01`)); const lyEnd = m === curMonth ? lyAsOf : monthEnd(lyM);
    const ty = W(`${m}-01`, tyEnd), ly = W(`${lyM}-01`, lyEnd);
    return { month: m, partial: m === curMonth, ty: { online: ty.online, schools: ty.schools, trials: ty.trialCustomers, paying: ty.customers }, ly: { online: ly.online, schools: ly.schools, trials: ly.trialCustomers, paying: ly.customers } };
  });

  // --- rolling 12 months: monthly bars across each window, and repeat buyers
  const r12Months = monthsBetween(monthOf(r12Start), curMonth).map(m => {
    const s = `${m}-01` < r12Start ? r12Start : `${m}-01`; const e = monthEnd(m) > asOf ? asOf : monthEnd(m);
    const lm = monthOf(shiftYear(`${m}-01`)); const ls = `${lm}-01` < p12Start ? p12Start : `${lm}-01`; const le = monthEnd(lm) > p12End ? p12End : monthEnd(lm);
    const a = W(s, e), b = W(ls, le);
    return { month: m, partial: s !== `${m}-01` || e !== monthEnd(m), ty: { total: a.total, paying: a.customers }, ly: { total: b.total, paying: b.customers } };
  });
  const p12Uids = new Set(ds.orders.filter(o => o.day >= p12Start && o.day <= p12End).map(o => o.uid));
  const r12Uids = new Set(ds.orders.filter(o => o.day >= r12Start && o.day <= asOf).map(o => o.uid));
  const boughtAgain = [...p12Uids].filter(u => r12Uids.has(u)).length;
  const pp12Uids = new Set(ds.orders.filter(o => o.day >= addDays(shiftYear(asOf, -3), 1) && o.day <= shiftYear(asOf, -2)).map(o => o.uid));
  const boughtAgainPrev = pp12Uids.size ? [...pp12Uids].filter(u => p12Uids.has(u)).length / pp12Uids.size : null;

  // --- conversion by month of first trial
  const firstTrials = [...ix.firstTrial.values()];
  const conv = (list: Trial[]) => {
    let b30 = 0, bAll = 0;
    for (const t of list) {
      const p = (ix.purchasesByUid.get(t.uid) ?? []).find(at => at >= t.at);
      if (p === undefined) continue;
      bAll += 1; if (daysDiff(t.at, p) <= 30) b30 += 1;
    }
    return { trialCustomers: list.length, bought30: b30, rate30: list.length ? b30 / list.length : null, boughtToDate: bAll, rateToDate: list.length ? bAll / list.length : null };
  };
  const newBuyersIn = (s: string, e: string) => {
    let n = 0, trialled = 0;
    for (const [uid, at] of ix.firstPurchase) { const d = sydDay.format(new Date(at)); if (d < s || d > e) continue; n += 1; const ft = ix.firstTrial.get(uid); if (ft && ft.at <= at) trialled += 1; }
    return { newBuyers: n, trialledPct: n ? trialled / n : null };
  };
  const cohorts = tableMonths.map(m => {
    const e = m === curMonth ? asOf : monthEnd(m);
    const list = firstTrials.filter(t => monthOf(t.day) === m);
    return { month: m, partial: m === curMonth, ageDays: daysDiff(new Date(`${m}-01T12:00:00Z`).getTime(), new Date(`${asOf}T12:00:00Z`).getTime()), ...conv(list), ...newBuyersIn(`${m}-01`, e) };
  });
  const allCohorts = { ...conv(firstTrials), ...newBuyersIn(DATA_START, asOf) };
  const byPack = new Map<string, Trial[]>();
  for (const t of firstTrials) { const a = byPack.get(t.pack) ?? []; a.push(t); byPack.set(t.pack, a); }
  const packConversion = [...byPack.entries()].filter(([, l]) => l.length >= 300).map(([pack, l]) => ({ pack, ...conv(l) })).sort((a, b) => b.trialCustomers - a.trialCustomers).slice(0, 6);
  const gaps: number[] = [];
  for (const t of firstTrials) { const p = (ix.purchasesByUid.get(t.uid) ?? []).find(at => at >= t.at); if (p !== undefined) gaps.push(daysDiff(t.at, p)); }
  gaps.sort((a, b) => a - b);
  const sameDay = (g: number) => g < 1;
  const timeToBuy = gaps.length ? {
    converters: gaps.length, medianDays: Math.round(gaps[Math.floor(gaps.length / 2)]!), meanDays: Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length),
    buckets: { sameDay: gaps.filter(sameDay).length / gaps.length, d1to7: gaps.filter(g => g >= 1 && g <= 7).length / gaps.length, d8to30: gaps.filter(g => g > 7 && g <= 30).length / gaps.length, d31to90: gaps.filter(g => g > 30 && g <= 90).length / gaps.length, d90plus: gaps.filter(g => g > 90).length / gaps.length },
  } : null;
  const onlineBuyersTrialledFirst = allCohorts.trialledPct;

  // --- customer base: active for 12 months after each paid online purchase
  const events: { uid: string; kind: 'new' | 'lapse'; day: string }[] = [];
  const activeUntil = new Map<string, string>(); // lapse day of the current spell
  for (const [uid, ats] of ix.purchasesByUid) {
    let spellEnd: string | null = null;
    for (const at of ats) {
      const d = sydDay.format(new Date(at));
      if (spellEnd === null || d >= spellEnd) { if (spellEnd !== null) events.push({ uid, kind: 'lapse', day: spellEnd }); events.push({ uid, kind: 'new', day: d }); }
      const e = addMonths(d, 12); if (spellEnd === null || e > spellEnd) spellEnd = e;
    }
    if (spellEnd) { events.push({ uid, kind: 'lapse', day: spellEnd }); activeUntil.set(uid, spellEnd); }
  }
  const lapseHistoryStart = addMonths(DATA_START, 12); // lapses are only complete a year after the data starts
  const activeAt = (day: string) => { let n = 0; for (const [uid, ats] of ix.purchasesByUid) { const prior = ats.filter(at => sydDay.format(new Date(at)) <= day); if (!prior.length) continue; const last = sydDay.format(new Date(prior[prior.length - 1]!)); if (addMonths(last, 12) > day) n += 1; void uid; } return n; };
  const baseMonths = monthsBetween(monthOf(lapseHistoryStart > fy ? lapseHistoryStart : fy), curMonth).map(m => {
    const s = `${m}-01`, e = m === curMonth ? asOf : monthEnd(m);
    const newC = events.filter(x => x.kind === 'new' && x.day >= s && x.day <= e).length;
    const lapsed = events.filter(x => x.kind === 'lapse' && x.day >= s && x.day <= e).length;
    return { month: m, partial: m === curMonth, newCustomers: newC, lapsed, net: newC - lapsed, activeAtEnd: activeAt(e) };
  });
  const activeNow = activeAt(asOf);
  const futureLapses = events.filter(x => x.kind === 'lapse' && x.day > asOf);
  const scheduled = monthsBetween(nextMonth(curMonth), monthOf(addMonths(asOf, 12))).map(m => ({ month: m, lapsing: futureLapses.filter(x => monthOf(x.day) === m).length }));
  let left = activeNow - futureLapses.filter(x => monthOf(x.day) === curMonth).length;
  const scheduledWithLeft = scheduled.map(s => { left -= s.lapsing; return { ...s, activeLeft: left }; });
  const lapseRestOfMonth = futureLapses.filter(x => monthOf(x.day) === curMonth).length;
  const lapseNext = (days: number) => futureLapses.filter(x => x.day <= addDays(asOf, days)).length;
  let biggestPair = { months: [] as string[], lapsing: 0 };
  for (let i = 0; i + 1 < scheduled.length; i++) { const n = scheduled[i]!.lapsing + scheduled[i + 1]!.lapsing; if (n > biggestPair.lapsing) biggestPair = { months: [scheduled[i]!.month, scheduled[i + 1]!.month], lapsing: n }; }

  // --- current positions (as at the report date)
  const last30 = W(addDays(asOf, -29), asOf);
  const last30Uids = new Set(ds.trials.filter(t => t.day >= addDays(asOf, -29) && t.day <= asOf).map(t => t.uid));
  let notYetPaying = 0;
  for (const uid of last30Uids) { const ft = ds.trials.filter(t => t.uid === uid && t.day >= addDays(asOf, -29)).reduce((m, t) => Math.min(m, t.at), Infinity); if (!(ix.purchasesByUid.get(uid) ?? []).some(at => at >= ft)) notYetPaying += 1; }
  const last30Ly = W(addDays(lyAsOf, -29), lyAsOf);
  const schools12 = W(r12Start, asOf);

  // --- ad spend by month, live from the planner's Google Ads and Meta connections (the source of the advertising sheet)
  const adMonths = monthsBetween(AD_START_MONTH, curMonth);
  const ads: AdMonth[] = await Promise.all(adMonths.map(async m => {
    const partial = m === curMonth;
    const live = adLive ? await adLive(m, `${m}-01`, partial ? asOf : monthEnd(m)).catch(() => null) : null;
    return live ? { month: m, google: Math.round(live.google), meta: Math.round(live.meta), total: Math.round(live.google + live.meta), partial, source: 'live' as const }
                : { month: m, google: null, meta: null, total: null, partial, source: 'none' as const };
  }));
  const adRows = ads.map(a => {
    const w = monthly.find(x => x.month === a.month) ?? W(`${a.month}-01`, a.month === curMonth ? asOf : monthEnd(a.month));
    const nb = newBuyersIn(`${a.month}-01`, a.month === curMonth ? asOf : monthEnd(a.month));
    const t = a.total;
    return { ...a, sales: w.online, pctOfSales: t != null && w.online ? t / w.online : null, salesPerDollar: t ? w.online / t : null, salesLessAds: t != null ? w.online - t : null,
      paying: w.customers, costPerPaying: t != null && w.customers ? t / w.customers : null, newBuyers: nb.newBuyers, costPerNew: t != null && nb.newBuyers ? t / nb.newBuyers : null,
      trialCustomers: w.trialCustomers, costPerTrial: t != null && w.trialCustomers ? t / w.trialCustomers : null };
  });

  // --- rolling 12 months measured at each month end (first full window ends Jul 2025)
  const r12Trend = monthsBetween(monthOf(addMonths(DATA_START, 12)), curMonth).map(m => {
    const e = m === curMonth ? asOf : monthEnd(m); const w = W(addDays(addMonths(e, -12), 1), e);
    return { month: m, end: e, online: w.online, schools: w.schools, paying: w.customers, trials: w.trialCustomers };
  });

  // --- cumulative curves through the financial year, by day (this year to date, last year in full)
  const fyCurve = (start: string, end: string) => {
    const out: { day: string; trials: number; onlineCustomers: number; online: number; payingSchools: number; schools: number }[] = [];
    const tU = new Set<string>(), oU = new Set<string>(), sU = new Set<string>(); let on = 0, sc = 0;
    const byDayO = new Map<string, Order[]>(), byDayT = new Map<string, Trial[]>(), byDayS = new Map<string, SchoolTx[]>();
    for (const o of ds.orders) if (o.day >= start && o.day <= end) { const a = byDayO.get(o.day) ?? []; a.push(o); byDayO.set(o.day, a); }
    for (const t of ds.trials) if (t.day >= start && t.day <= end) { const a = byDayT.get(t.day) ?? []; a.push(t); byDayT.set(t.day, a); }
    for (const x of ds.schools) if (x.day >= start && x.day <= end) { const a = byDayS.get(x.day) ?? []; a.push(x); byDayS.set(x.day, a); }
    for (let d = start; d <= end; d = addDays(d, 1)) {
      for (const o of byDayO.get(d) ?? []) { oU.add(o.uid); on += o.total; }
      for (const t of byDayT.get(d) ?? []) tU.add(t.uid);
      for (const x of byDayS.get(d) ?? []) { if (x.total > 0) { sc += x.total; if (x.uid) sU.add(x.uid); } }
      out.push({ day: d, trials: tU.size, onlineCustomers: oU.size, online: on, payingSchools: sU.size, schools: sc });
    }
    return out;
  };
  const fyCurves = { ty: fyCurve(fy, asOf), ly: fyCurve(lyFy, addDays(fy, -1)) };

  return {
    asOf, preparedOn: addDays(asOf, 1), dataStart: DATA_START,
    periods: { mtd: [mtdStart, asOf], mtdLy: [lyMonthStart, lyAsOf], fy: [fy, asOf], fyLy: [lyFy, lyAsOf], r12: [r12Start, asOf], p12: [p12Start, p12End] },
    mtd, mtdLy, lyFullMonth, lyRest, fytd, fytdLy, lyFullFy, r12, p12,
    boughtAgain: { count: boughtAgain, of: p12Uids.size, rate: p12Uids.size ? boughtAgain / p12Uids.size : null, prevRate: boughtAgainPrev },
    monthly, daily, cumulativePaying, weekBuckets, promo,
    fyPositions, lyFyCurve, fyMonthlyBars, r12Months,
    cohorts, allCohorts, packConversion, timeToBuy, onlineBuyersTrialledFirst,
    base: { months: baseMonths, activeNow, scheduled: scheduledWithLeft, lapseRestOfMonth, lapseNext30: lapseNext(30), lapseNext90: lapseNext(90), biggestPair },
    current: { trialists30: last30.trialCustomers, notYetPaying, trialists30Ly: last30Ly.trialCustomers, paying12: r12.customers, payingPrev12: p12.customers, schools12: schools12.allSchools, payingSchools12: schools12.payingSchools },
    ads: adRows,
    r12Trend, fyCurves,
    schoolCountsAvailable: ds.schools.some(x => !!x.uid),
    dataNotes: ds.notes,
  };

  function pickFy(w: Window) { return { trials: w.trialCustomers, online: w.online, onlineCustomers: w.customers, payingSchools: w.payingSchools, schools: w.schools }; }
}

export type EtzExecData = Awaited<ReturnType<typeof buildEtzExecData>>;

