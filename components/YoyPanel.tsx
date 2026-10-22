'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

interface Metrics {
  revenue: number; spend: number; roas: number; orders: number; aov: number;
  newCustomers: number; returningCustomers: number; cac: number | null;
}
interface BU { period: { label: string; start: string; end: string }; comparison: { start: string; end: string }; current: Metrics; prev: Metrics }
interface TrendPt { month: string; revenue: number; orders: number }

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-AU');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

function Change({ cur, prev, goodWhenUp = true }: { cur: number | null; prev: number | null; goodWhenUp?: boolean }) {
  if (cur == null || prev == null || prev <= 0) return <span className="text-gray-300">–</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  const up = p >= 0;
  const good = goodWhenUp ? up : !up;
  return <span className={`font-semibold ${good ? 'text-green-600' : 'text-red-500'}`}>{up ? '▲' : '▼'} {Math.abs(p)}%</span>;
}

export default function YoyPanel({
  brand, range, customStart, customEnd, mainYoyData, trend, trendLastYear, accent,
}: {
  brand: string; range: string; customStart?: string; customEnd?: string;
  /** The page's own data when its YoY toggle is already on, so it is not fetched twice. */
  mainYoyData: BU | null;
  trend: TrendPt[] | null; trendLastYear: TrendPt[] | null; accent: string;
}) {
  const [data, setData] = useState<BU | null>(mainYoyData);
  const [loading, setLoading] = useState(!mainYoyData);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mainYoyData) { setData(mainYoyData); setLoading(false); setError(''); return; }
    let cancelled = false;
    setLoading(true); setError('');
    const qs = range === 'custom' && customStart && customEnd ? `&start=${customStart}&end=${customEnd}` : '';
    fetch(`/api/business-unit?brand=${brand}&range=${range}&yoy=true${qs}`)
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json() as BU; })
      .then(j => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : 'Failed to load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brand, range, customStart, customEnd, mainYoyData]);

  const rows = useMemo(() => {
    if (!data) return [];
    const c = data.current, p = data.prev;
    return [
      { label: 'Revenue', cur: c.revenue, prev: p.revenue, fmt: (v: number) => AUD.format(v), goodWhenUp: true },
      { label: 'Orders', cur: c.orders, prev: p.orders, fmt: (v: number) => NUM.format(v), goodWhenUp: true },
      { label: 'Average order value', cur: c.aov, prev: p.aov, fmt: (v: number) => AUD.format(v), goodWhenUp: true },
      { label: 'New customers', cur: c.newCustomers, prev: p.newCustomers, fmt: (v: number) => NUM.format(v), goodWhenUp: true },
      { label: 'Returning customers', cur: c.returningCustomers, prev: p.returningCustomers, fmt: (v: number) => NUM.format(v), goodWhenUp: true },
      { label: 'Ad spend', cur: c.spend, prev: p.spend, fmt: (v: number) => AUD.format(v), goodWhenUp: false },
      { label: 'Return on ad spend', cur: c.roas, prev: p.roas, fmt: (v: number) => `${v}x`, goodWhenUp: true },
    ].filter(r => !(r.cur === 0 && r.prev === 0));
  }, [data]);

  const chart = useMemo(() => {
    if (!trend || !trendLastYear || trend.length === 0) return [];
    return trend.map((t, i) => ({
      month: `${MONTHS[Number(t.month.slice(5, 7)) - 1]}${i === trend.length - 1 ? ' (so far)' : ''}`,
      thisYear: Math.round(t.revenue),
      lastYear: Math.round(trendLastYear[i]?.revenue ?? 0),
    }));
  }, [trend, trendLastYear]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="mb-3">
        <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Year over year</p>
        <p className="text-[11px] text-gray-400">
          {data ? <>{fmtDay(data.period.start)} to {fmtDay(data.period.end)} compared with {fmtDay(data.comparison.start)} to {fmtDay(data.comparison.end)} (same dates last year)</> : 'This period compared with the same dates last year'}
        </p>
      </div>

      {loading && <p className="text-xs text-gray-400 py-4">Loading last year&apos;s figures…</p>}
      {!loading && error && <p className="text-xs text-red-600 py-2">{error}</p>}
      {!loading && data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="py-1.5 pr-3">&nbsp;</th>
                <th className="py-1.5 pr-3 text-right">This year</th>
                <th className="py-1.5 pr-3 text-right">Last year</th>
                <th className="py-1.5 pr-3 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 font-medium text-gray-700">{r.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-bold" style={{ color: r.label === 'Revenue' ? accent : undefined }}>{r.fmt(r.cur)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{r.fmt(r.prev)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums"><Change cur={r.cur} prev={r.prev} goodWhenUp={r.goodWhenUp} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chart.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Revenue by month, last 12 months against the same months a year earlier</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F6" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} width={44} />
              <Tooltip formatter={(v) => AUD.format(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="lastYear" name="Same month last year" fill="#CBD5E1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="thisYear" name="This year" fill={accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-gray-400 mt-1">The latest month is compared with the same days last year, so it is a fair comparison while the month is still in progress.</p>
        </div>
      )}
    </div>
  );
}
