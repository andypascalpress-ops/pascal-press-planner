'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Sales {
  orders: number; revenue: number; refunds: number; discounts: number; discountedOrders: number;
  byDay: Record<string, { revenue: number; orders: number }>;
  bySource: { source: string; orders: number; revenue: number }[];
  byDiscountCode: { code: string; orders: number; revenue: number }[];
}
interface Resp { configured?: boolean; error?: string; priorSource?: 'orders' | 'report' | null; priorError?: string | null; period?: { start: string; end: string }; comparison?: { start: string; end: string } | null; current?: Sales; prior?: Sales | null }

type RangeKey = 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7d' }, { key: 'last30', label: 'Last 30d' },
  { key: 'mtd', label: 'MTD' }, { key: 'lastmonth', label: 'Last month' },
];

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function addDays(ymd: string, n: number): string { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000) + 1;
const shortDay = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m! - 1]}`; };
const minusYear = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y! - 1, m! - 1, d!, 12)).toISOString().slice(0, 10); };

function rangeDates(key: RangeKey): { start: string; end: string } {
  const today = sydneyToday();
  switch (key) {
    case 'yesterday': { const y = addDays(today, -1); return { start: y, end: y }; }
    case 'last7': return { start: addDays(today, -6), end: today };
    case 'last30': return { start: addDays(today, -29), end: today };
    case 'mtd': return { start: `${today.slice(0, 7)}-01`, end: today };
    case 'lastmonth': {
      const [y, m] = today.split('-').map(Number);
      const first = new Date(Date.UTC(y!, m! - 2, 1, 12)), last = new Date(Date.UTC(y!, m! - 1, 0, 12));
      return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
    }
  }
}

function Delta({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev == null || prev <= 0) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p > 500) return <span className="ml-2 text-xs font-medium text-gray-400">no comparison (store was barely trading)</span>;
  return <span className={`ml-2 text-xs font-semibold ${p >= 0 ? 'text-green-600' : 'text-red-500'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</span>;
}

function Card({ label, value, prev, detail }: { label: string; value: string; prev?: string; detail?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <div className="mt-1 flex items-baseline"><span className="text-2xl font-bold text-gray-900 tabular-nums">{value}</span>{detail}</div>
      {prev && <p className="mt-0.5 text-[11px] text-gray-400">{prev}</p>}
    </div>
  );
}

export default function EsgPanel({ color }: { color: string }) {
  const [range, setRange] = useState<RangeKey>('mtd');
  const [yoy, setYoy] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const { start, end, compStart, compEnd } = useMemo(() => {
    const r = rangeDates(range);
    if (yoy) return { ...r, compStart: minusYear(r.start), compEnd: minusYear(r.end) };
    const len = daysBetween(r.start, r.end);
    return { ...r, compStart: addDays(r.start, -len), compEnd: addDays(r.start, -1) };
  }, [range, yoy]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/esg-sales?start=${start}&end=${end}&compStart=${compStart}&compEnd=${compEnd}`)
      .then(async res => {
        const json = (await res.json()) as Resp;
        if (!cancelled) setData(res.status === 401 ? { error: 'Please sign in to the planner again.' } : json);
      })
      .catch(e => { if (!cancelled) setData({ error: e instanceof Error ? e.message : 'Failed to load' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [start, end, compStart, compEnd]);

  const c = data?.current, p = data?.prior;
  const aov = c && c.orders > 0 ? c.revenue / c.orders : 0, aovPrev = p && p.orders > 0 ? p.revenue / p.orders : null;
  const chart = useMemo(() => {
    if (!c) return [];
    const out: { date: string; revenue: number; orders: number }[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, revenue: c.byDay[d]?.revenue ?? 0, orders: c.byDay[d]?.orders ?? 0 });
    return out;
  }, [c, start, end]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${range === r.key ? 'text-white' : 'text-gray-600 border-gray-200 hover:border-gray-300'}`}
              style={range === r.key ? { background: color, borderColor: color } : undefined}>{r.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={yoy} onChange={e => setYoy(e.target.checked)} /> Compare with the same dates last year
        </label>
      </div>

      <p className="text-xs text-gray-400">
        <span className="font-medium text-gray-600">{shortDay(start)} – {shortDay(end)}</span>
        {' · '}<span className="italic">{yoy ? 'vs same period last year' : 'vs the previous period of the same length'}</span>
        {' · '}Shopify, Excel Study Guides
      </p>

      {loading && <div className="h-40 animate-pulse rounded-xl bg-gray-100" />}
      {!loading && data?.configured === false && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Shopify is not connected yet: the store settings are missing in Vercel.</div>}
      {!loading && data?.error && data.configured !== false && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load Shopify sales: {data.error}</div>}

      {!loading && c && (
        <>
          {yoy && !p && <p className="text-xs text-amber-700">Last year&rsquo;s figures could not be loaded{data?.priorError ? `: ${data.priorError}` : '.'}</p>}
          {p && data?.priorSource === 'report' && <p className="text-xs text-gray-400">Last year&rsquo;s revenue, orders and discounts come from Shopify&rsquo;s sales report (no source or discount-code detail for last year).</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Revenue" value={AUD.format(c.revenue)} detail={<Delta cur={c.revenue} prev={p?.revenue} />} prev={p ? `prev ${AUD.format(p.revenue)}` : undefined} />
            <Card label="Orders" value={String(c.orders)} detail={<Delta cur={c.orders} prev={p?.orders} />} prev={p ? `prev ${p.orders}` : undefined} />
            <Card label="Average order" value={AUD.format(aov)} detail={<Delta cur={aov} prev={aovPrev} />} prev={aovPrev != null ? `prev ${AUD.format(aovPrev)}` : undefined} />
            <Card label="Discounts given" value={AUD.format(c.discounts)} prev={`${c.discountedOrders} of ${c.orders} orders used a discount${c.refunds > 0 ? ` · ${AUD.format(c.refunds)} refunded` : ''}`} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Revenue by day</p>
            <div role="img" aria-label="Daily revenue for the selected period">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis width={46} tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: unknown) => [AUD.format(Number(v)), 'Revenue']} labelFormatter={(l: unknown) => shortDay(String(l))} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="revenue" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Where sales came from</p>
              {c.bySource.length === 0 ? <p className="text-sm text-gray-400">No orders in this period.</p> : (
                <table className="w-full text-sm tabular-nums">
                  <thead><tr className="text-left text-[11px] text-gray-400"><th className="py-1 font-medium">Source</th><th className="py-1 text-right font-medium">Orders</th><th className="py-1 text-right font-medium">Revenue</th></tr></thead>
                  <tbody>{c.bySource.map(s => <tr key={s.source} className="border-t border-gray-50"><td className="py-1.5 text-gray-800">{s.source}</td><td className="py-1.5 text-right text-gray-600">{s.orders}</td><td className="py-1.5 text-right font-medium text-gray-900">{AUD.format(s.revenue)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Discount codes used</p>
              {c.byDiscountCode.length === 0 ? <p className="text-sm text-gray-400">No discount codes used in this period.</p> : (
                <table className="w-full text-sm tabular-nums">
                  <thead><tr className="text-left text-[11px] text-gray-400"><th className="py-1 font-medium">Code</th><th className="py-1 text-right font-medium">Orders</th><th className="py-1 text-right font-medium">Revenue</th></tr></thead>
                  <tbody>{c.byDiscountCode.map(s => <tr key={s.code} className="border-t border-gray-50"><td className="py-1.5 font-mono text-xs text-gray-800">{s.code}</td><td className="py-1.5 text-right text-gray-600">{s.orders}</td><td className="py-1.5 text-right font-medium text-gray-900">{AUD.format(s.revenue)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Revenue is each order&rsquo;s total including GST and shipping, less refunds; cancelled and test orders are left out. Source is the marketing source Shopify recorded for the visit that led to the order.
          </p>
        </>
      )}
    </div>
  );
}
