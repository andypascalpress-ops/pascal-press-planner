'use client';

import { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Point { date: string; revenue: number; orders: number; ma7: number | null; partial: boolean }
interface Summary {
  last30Avg: number; prior30Avg: number; last30Change: number | null;
  last7Avg: number; prior7Avg: number; last7Change: number | null;
  hasPrior30: boolean; total: number;
}
interface DailyResponse { connected: boolean; series: Point[]; summary: Summary; error?: string }

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function axisMoney(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

type Verdict = { label: string; arrow: string; cls: string };
function verdictFor(change: number | null): Verdict {
  if (change === null) return { label: 'Not enough history', arrow: '–', cls: 'bg-gray-100 text-gray-600' };
  if (change >= 5) return { label: 'Rising', arrow: '▲', cls: 'bg-emerald-50 text-emerald-700' };
  if (change <= -5) return { label: 'Falling', arrow: '▼', cls: 'bg-red-50 text-red-700' };
  return { label: 'Flat', arrow: '▶', cls: 'bg-gray-100 text-gray-600' };
}

function signed(n: number | null): string {
  if (n === null) return 'n/a';
  return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(1)}%`;
}

function DailyTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload: Point }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-gray-900">{longDate(p.date)}{p.partial ? ' (so far today)' : ''}</p>
      <p className="mt-1 text-gray-600">Revenue <span className="font-semibold text-gray-900">{AUD.format(p.revenue)}</span></p>
      <p className="text-gray-600">Orders <span className="font-semibold text-gray-900">{p.orders}</span></p>
      {p.ma7 !== null && <p className="text-gray-600">7-day average <span className="font-semibold text-gray-900">{AUD.format(p.ma7)}</span></p>}
    </div>
  );
}

export default function DailyRevenueTrend({ brand, color }: { brand: string; color: string }) {
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    fetch(`/api/business-unit-daily?brand=${brand}&days=90`)
      .then(async res => {
        const json = await res.json() as DailyResponse;
        if (!res.ok || !json.connected) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brand]);

  const ticks = useMemo(() => {
    if (!data) return [];
    const n = data.series.length;
    return data.series.filter((_, i) => (n - 1 - i) % 14 === 0).map(p => p.date);
  }, [data]);

  const verdict = verdictFor(data?.summary.hasPrior30 ? data.summary.last30Change : null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Daily revenue — last 90 days</p>
          {data && (
            <p className="mt-1 text-xs text-gray-500">
              Last 30 days <span className="font-semibold text-gray-900">{AUD.format(data.summary.last30Avg)}/day</span>
              {data.summary.hasPrior30 && <> vs {AUD.format(data.summary.prior30Avg)}/day in the 30 before ({signed(data.summary.last30Change)})</>}
              <span className="mx-2 text-gray-300">|</span>
              Last 7 days <span className="font-semibold text-gray-900">{AUD.format(data.summary.last7Avg)}/day</span>
              {data.summary.prior7Avg > 0 && <> vs {AUD.format(data.summary.prior7Avg)}/day ({signed(data.summary.last7Change)})</>}
            </p>
          )}
        </div>
        {data && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${verdict.cls}`}>
            <span aria-hidden="true">{verdict.arrow}</span>{verdict.label}
          </span>
        )}
      </div>

      {loading && <div className="h-[260px] animate-pulse rounded-lg bg-gray-50" />}
      {!loading && error && <p className="py-10 text-center text-sm text-gray-400">Could not load daily revenue ({error}).</p>}

      {data && (
        <>
          <div className="mb-2 flex items-center gap-4 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color, opacity: 0.3 }} />Daily revenue</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />7-day average</span>
            <span className="text-gray-400">Last bar is today so far and is not in the averages</span>
          </div>
          <div
            role="img"
            aria-label={`Daily revenue for the last 90 days. Last 30 days average ${AUD.format(data.summary.last30Avg)} per day, ${verdict.label.toLowerCase()} compared with the previous 30 days.`}
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={axisMoney} width={44} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip content={<DailyTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
                <Bar dataKey="revenue" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {data.series.map(p => <Cell key={p.date} fill={color} fillOpacity={p.partial ? 0.12 : 0.3} />)}
                </Bar>
                <Line type="monotone" dataKey="ma7" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-xs text-gray-500">
            <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">Show the numbers</summary>
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-left tabular-nums">
                <thead className="sticky top-0 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                  <tr><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5 text-right">Revenue</th><th className="px-3 py-1.5 text-right">Orders</th><th className="px-3 py-1.5 text-right">7-day avg</th></tr>
                </thead>
                <tbody>
                  {[...data.series].reverse().map(p => (
                    <tr key={p.date} className="border-t border-gray-50">
                      <td className="px-3 py-1">{longDate(p.date)}{p.partial ? ' (so far)' : ''}</td>
                      <td className="px-3 py-1 text-right text-gray-900">{AUD.format(p.revenue)}</td>
                      <td className="px-3 py-1 text-right">{p.orders}</td>
                      <td className="px-3 py-1 text-right">{p.ma7 === null ? '–' : AUD.format(p.ma7)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
