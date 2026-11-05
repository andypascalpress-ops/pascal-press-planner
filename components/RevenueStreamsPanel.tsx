'use client';

import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

interface Stream { revenue: number; orders: number }
interface Schools extends Stream { paidOrders: number; allocations: number }
interface Side { online: Stream; schools: Schools; total: number }
interface Resp {
  connected: boolean; error?: string;
  current: Side; prior: Side;
  months: { month: string; online: number; schools: number }[];
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-AU');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SCHOOL_COLOR = '#F47920';

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m! - 1]} ${String(y).slice(2)}`;
}
function axisMoney(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;
}

function Change({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) return <span className="text-gray-300">–</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <span className={`font-semibold ${p >= 0 ? 'text-green-600' : 'text-red-500'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</span>;
}

function StreamCard({ label, value, prev, detail, color }: { label: string; value: number; prev: number; detail: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} aria-hidden="true" />{label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{AUD.format(value)} <span className="ml-1 text-xs"><Change cur={value} prev={prev} /></span></p>
      <p className="mt-0.5 text-[11px] text-gray-400">prev {AUD.format(prev)}</p>
      <p className="mt-1 text-[11px] text-gray-500">{detail}</p>
    </div>
  );
}

export default function RevenueStreamsPanel({
  start, end, compStart, compEnd, accent,
}: { start: string; end: string; compStart: string; compEnd: string; accent: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/etz-revenue-streams?start=${start}&end=${end}&compStart=${compStart}&compEnd=${compEnd}`)
      .then(async res => {
        const json = await res.json() as Resp;
        if (!res.ok || !json.connected) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      })
      .catch(e => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : 'Failed to load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [start, end, compStart, compEnd]);

  const c = data?.current, p = data?.prior;
  const schoolShare = c && c.total > 0 ? Math.round((c.schools.revenue / c.total) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Revenue: parents vs schools</p>
        <p className="text-[11px] text-gray-400">From the Excel Test Zone user system (UMS). Parents match Stripe card orders.</p>
      </div>

      {loading && <div className="h-[300px] animate-pulse rounded-lg bg-gray-50" />}
      {!loading && error && <p className="py-8 text-center text-sm text-gray-400">Could not load school and parent revenue ({error}).</p>}

      {!loading && data && c && p && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StreamCard label="Parent revenue (online)" value={c.online.revenue} prev={p.online.revenue} color={accent}
              detail={`${NUM.format(c.online.orders)} orders (${NUM.format(p.online.orders)} last time)`} />
            <StreamCard label="School revenue (invoiced)" value={c.schools.revenue} prev={p.schools.revenue} color={SCHOOL_COLOR}
              detail={`${NUM.format(c.schools.paidOrders)} paid invoices${c.schools.allocations > 0 ? `, ${NUM.format(c.schools.allocations)} free allocations` : ''} (${NUM.format(p.schools.paidOrders)} paid last time)`} />
            <StreamCard label="Total ETZ revenue" value={c.total} prev={p.total} color="#6b7280"
              detail={`Schools are ${schoolShare}% of the total`} />
          </div>

          <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Last 12 months</p>
          <div role="img" aria-label="Monthly ETZ revenue for the last 12 months, parents and schools stacked.">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={axisMoney} width={44} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number, name: string) => [AUD.format(v), name]}
                  labelFormatter={(l: string) => monthLabel(l)}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="online" name="Parents (online)" stackId="r" fill={accent} isAnimationActive={false} />
                <Bar dataKey="schools" name="Schools (invoiced)" stackId="r" fill={SCHOOL_COLOR} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            Schools are invoice orders, so this is the amount invoiced; it does not show when the school paid. The latest month is the month so far. Existing revenue cards above stay Stripe (parents) only.
          </p>
        </>
      )}
    </div>
  );
}
