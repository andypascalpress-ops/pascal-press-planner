'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Point { date: string; trials: number; ma7: number | null; ly: number | null; lyMa7: number | null }
interface Summary {
  last30Avg: number; prior30Avg: number; last30Change: number | null;
  last7Avg: number; prior7Avg: number; last7Change: number | null;
  hasPrior30: boolean; total: number;
  lastYear30Avg: number | null; lastYear30Change: number | null; lastYearTotal: number | null;
}
interface TrialsResponse { connected: boolean; lastYearOk: boolean; series: Point[]; summary: Summary; days: number; start: string; end: string; error?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUM = new Intl.NumberFormat('en-AU');
const RANGES = [30, 90, 180, 365] as const;

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]}${y! !== new Date().getFullYear() ? ` ${String(y).slice(2)}` : ''}`;
}
function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function signed(n: number | null): string {
  if (n === null) return 'n/a';
  return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(1)}%`;
}
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-AU');

function verdictFor(change: number | null) {
  if (change === null) return { label: 'Not enough history', arrow: '–', cls: 'bg-gray-100 text-gray-600' };
  if (change >= 5) return { label: 'Growing', arrow: '▲', cls: 'bg-emerald-50 text-emerald-700' };
  if (change <= -5) return { label: 'Falling', arrow: '▼', cls: 'bg-red-50 text-red-700' };
  return { label: 'Flat', arrow: '▶', cls: 'bg-gray-100 text-gray-600' };
}

function TrialsTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload: Point }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-gray-900">{longDate(p.date)}</p>
      <p className="mt-1 text-gray-600">Free trials started <span className="font-semibold text-gray-900">{p.trials}</span></p>
      {p.ma7 !== null && <p className="text-gray-600">7-day average <span className="font-semibold text-gray-900">{one(p.ma7)}</span></p>}
      {p.lyMa7 !== null && (
        <p className="mt-1 border-t border-gray-100 pt-1 text-gray-500">
          Same day last year <span className="font-semibold text-gray-700">{p.ly}</span> (7-day average {one(p.lyMa7)})
        </p>
      )}
    </div>
  );
}

export default function TrialsTrend({ color }: { color: string }) {
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<TrialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/etz-trials-daily?days=${days}`)
      .then(async res => {
        const json = await res.json() as TrialsResponse;
        if (!res.ok || !json.connected) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      })
      .catch(e => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : 'Failed to load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const ticks = useMemo(() => {
    if (!data) return [];
    const n = data.series.length;
    const step = n <= 40 ? 7 : n <= 100 ? 14 : n <= 200 ? 28 : 56;
    return data.series.filter((_, i) => (n - 1 - i) % step === 0).map(p => p.date);
  }, [data]);

  const verdict = verdictFor(data?.summary.hasPrior30 ? data.summary.last30Change : null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Free trials started per day</p>
          {data && (
            <p className="mt-1 text-xs text-gray-500">
              Last 30 days <span className="font-semibold text-gray-900">{one(data.summary.last30Avg)}/day</span>
              {data.summary.hasPrior30 && <> vs {one(data.summary.prior30Avg)}/day in the 30 before ({signed(data.summary.last30Change)})</>}
              {data.summary.lastYear30Avg !== null && data.summary.lastYear30Avg > 0 && <> <span className="mx-2 text-gray-300">|</span>Same 30 days last year <span className="font-semibold text-gray-900">{one(data.summary.lastYear30Avg)}/day</span> ({signed(data.summary.lastYear30Change)})</>}
              <span className="mx-2 text-gray-300">|</span>
              Last 7 days <span className="font-semibold text-gray-900">{one(data.summary.last7Avg)}/day</span>
              {data.summary.prior7Avg > 0 && <> vs {one(data.summary.prior7Avg)}/day ({signed(data.summary.last7Change)})</>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${verdict.cls}`}>
              <span aria-hidden="true">{verdict.arrow}</span>{verdict.label}
            </span>
          )}
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs" role="group" aria-label="Time range">
            {RANGES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={`px-2.5 py-1 font-medium ${days === r ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {r === 365 ? '1 year' : `${r} days`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="h-[260px] animate-pulse rounded-lg bg-gray-50" />}
      {!loading && error && <p className="py-10 text-center text-sm text-gray-400">Could not load free trials ({error}).</p>}

      {!loading && data && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: color, opacity: 0.35 }} />Trials each day</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />7-day average</span>
            {data.lastYearOk && <span className="inline-flex items-center gap-1.5"><svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 3" /></svg>Same dates last year (7-day average)</span>}
            <span className="text-gray-400">{NUM.format(data.summary.total)} trials in {data.days} days{data.summary.lastYearTotal !== null && <> (last year {NUM.format(data.summary.lastYearTotal)})</>}. Complete days only, up to yesterday.</span>
          </div>
          <div
            role="img"
            aria-label={`Free trials started per day for the last ${data.days} days. Last 30 days average ${one(data.summary.last30Avg)} per day, ${verdict.label.toLowerCase()} compared with the previous 30 days.`}
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis width={32} allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip content={<TrialsTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
                <Line type="monotone" dataKey="trials" stroke={color} strokeOpacity={0.35} strokeWidth={1.25} dot={false} activeDot={false} isAnimationActive={false} />
                {data.lastYearOk && <Line type="monotone" dataKey="lyMa7" stroke="#6b7280" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 3, fill: '#6b7280', stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />}
                <Line type="monotone" dataKey="ma7" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            From the Excel Test Zone user system (UMS) transaction list: one trial per child or product. Includes a few internal test sign-ups. Bulk school sign-ups are not trials.
          </p>
        </>
      )}
    </div>
  );
}
