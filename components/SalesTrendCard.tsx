'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Line, ComposedChart,
} from 'recharts';

interface MonthData { month: string; revenue: number; orders: number; }
interface SalesData  { connected: boolean; months: MonthData[]; currentMonth: string; }

const AUD  = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const AUDk = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtMonth = (ym: string) => { const [y,m]=ym.split('-'); const mi=parseInt(m!,10)-1; return `${MON[mi]} ${y}`; };
const shortMon = (ym: string) => { const [y,m]=ym.split('-'); const mi=parseInt(m!,10); return mi===1?`Jan ${y}`:MON[mi-1]!; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MonthTooltip({ active, payload, label, currentMonth }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[140px]">
      <p className="font-semibold text-gray-700 mb-1.5">
        {fmtMonth(label)}{d.month === currentMonth ? ' (partial)' : ''}
      </p>
      {payload.map((p: any) => p.name === 'rolling12' ? null : (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-gray-400 capitalize">{p.name === 'value' ? 'Revenue' : p.name === 'orders' ? 'Orders' : '12-mo avg'}</span>
          <span className="font-semibold text-gray-800">{p.name === 'orders' ? p.value?.toLocaleString('en-AU') : AUD.format(p.value ?? 0)}</span>
        </div>
      ))}
      {payload.find((p: any) => p.name === 'rolling12') && (
        <div className="flex justify-between gap-4 mt-1 border-t border-gray-100 pt-1">
          <span className="text-gray-400">12-mo rolling avg</span>
          <span className="font-semibold text-orange-500">{AUD.format(payload.find((p: any) => p.name === 'rolling12')?.value ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function YearTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1.5">{label}{d.partial ? ' (partial)' : ''}</p>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Revenue</span><span className="font-semibold">{AUD.format(d.revenue)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Orders</span><span className="font-semibold">{d.orders.toLocaleString('en-AU')}</span></div>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Monthly avg</span><span className="font-semibold">{AUD.format(Math.round(d.revenue / d.count))}</span></div>
    </div>
  );
}

type ViewMode = 'monthly' | 'yearly';
type Metric   = 'revenue' | 'orders';

export default function SalesTrendCard() {
  const [data,    setData]    = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<ViewMode>('yearly');
  const [metric,  setMetric]  = useState<Metric>('revenue');

  useEffect(() => {
    fetch('/api/bc-sales-monthly')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-4" />
      <div className="h-56 bg-gray-50 rounded-lg animate-pulse" />
    </div>
  );

  if (!data?.connected || !data.months.length) return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-400">Sales trend data unavailable.</p>
    </div>
  );

  const { months, currentMonth } = data;
  const completed = months.filter(m => m.month < currentMonth);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const last12    = completed.slice(-12);
  const prev12    = completed.slice(-24, -12);
  const last12Rev = last12.reduce((s, m) => s + m.revenue, 0);
  const prev12Rev = prev12.reduce((s, m) => s + m.revenue, 0);
  const yoy       = prev12Rev > 0 ? ((last12Rev - prev12Rev) / prev12Rev) * 100 : null;
  const bestMonth = [...completed].sort((a, b) => b.revenue - a.revenue)[0];

  const totalRev        = completed.reduce((s, m) => s + m.revenue, 0);
  const totalDays       = completed.length * 30.44; // approx
  const allTimeMonthAvg = completed.length > 0 ? totalRev / completed.length : 0;
  const allTimeDayAvg   = totalDays > 0 ? totalRev / totalDays : 0;

  // ── Monthly chart data with 12-month rolling average ──────────────────────
  const monthChartData = months.map((m, i) => {
    const window = completed.slice(Math.max(0, i - 11), i + 1);
    const rolling12 = metric === 'revenue' && window.length === 12
      ? Math.round(window.reduce((s, x) => s + x.revenue, 0) / 12)
      : null;
    return {
      ...m,
      value:     metric === 'revenue' ? m.revenue : m.orders,
      rolling12,
    };
  });

  const yearBoundaries = months
    .filter(m => m.month.endsWith('-01') && m.month !== months[0]?.month)
    .map(m => m.month);

  // ── Yearly chart data ──────────────────────────────────────────────────────
  const yearMap = new Map<string, { revenue: number; orders: number; count: number; partial: boolean }>();
  const curYear = currentMonth.slice(0, 4);
  for (const m of months) {
    const yr = m.month.slice(0, 4);
    const entry = yearMap.get(yr);
    if (!entry) yearMap.set(yr, { revenue: m.revenue, orders: m.orders, count: 1, partial: yr === curYear });
    else { entry.revenue += m.revenue; entry.orders += m.orders; entry.count++; }
  }
  const yearChartData = [...yearMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, d]) => ({ year, ...d, value: metric === 'revenue' ? d.revenue : d.orders }));

  const maxMonthVal = Math.max(...monthChartData.map(d => d.value), 1);
  const maxYearVal  = Math.max(...yearChartData.map(d => d.value), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">

      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Pascal Press — Sales Trend</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {fmtMonth(months[0]!.month)} → present · {completed.length} complete months · BC completed orders
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['yearly','monthly'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 capitalize transition-colors ${view===v?'bg-gray-900 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                {v==='yearly'?'By Year':'By Month'}
              </button>
            ))}
          </div>
          {/* Metric toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['revenue','orders'] as Metric[]).map(v => (
              <button key={v} onClick={() => setMetric(v)}
                className={`px-3 py-1.5 capitalize transition-colors ${metric===v?'bg-blue-600 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Last 12 months</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(last12Rev)}</p>
          {yoy !== null && (
            <p className={`text-[11px] font-semibold mt-0.5 ${yoy>=0?'text-emerald-600':'text-red-500'}`}>
              {yoy>=0?'▲':'▼'} {Math.abs(yoy).toFixed(1)}% vs prior year
            </p>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">All-time monthly avg</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(Math.round(allTimeMonthAvg))}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">across {completed.length} months</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">All-time daily avg</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(Math.round(allTimeDayAvg))}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">per calendar day</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Best month ever</p>
          {bestMonth && (
            <>
              <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(bestMonth.revenue)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{fmtMonth(bestMonth.month)}</p>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="h-60">
        {view === 'yearly' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => AUDk(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46}
                domain={[0, Math.ceil(maxYearVal * 1.1 / 10000) * 10000]} />
              <Tooltip content={<YearTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="value" radius={[4,4,0,0]}
                fill="#3b82f6"
                // Partial year gets lighter colour
                label={false}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ppGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              {yearBoundaries.map(ym => (
                <ReferenceLine key={ym} x={ym} stroke="#e2e8f0" strokeDasharray="4 2"
                  label={{ value: ym.slice(0,4), position:'top', fontSize:9, fill:'#94a3b8' }} />
              ))}
              <XAxis dataKey="month" tickFormatter={shortMon} tick={{ fontSize: 10, fill: '#94a3b8' }}
                interval={Math.floor(months.length / 10)} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => AUDk(v)} tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false} tickLine={false} width={46}
                domain={[0, Math.ceil(maxMonthVal * 1.1 / 1000) * 1000]} />
              <Tooltip content={<MonthTooltip currentMonth={currentMonth} />} />
              <Area  type="monotone" dataKey="value"     stroke="#3b82f6" strokeWidth={1.5} fill="url(#ppGrad)" dot={false} activeDot={{ r:3 }} />
              {metric === 'revenue' && (
                <Line type="monotone" dataKey="rolling12" stroke="#f97316" strokeWidth={2} dot={false}
                  activeDot={{ r:3 }} strokeDasharray="0" connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
        {view === 'monthly' && metric === 'revenue' && (
          <>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-3 h-0.5 bg-blue-500 rounded" />Monthly revenue
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-3 h-0.5 bg-orange-400 rounded" />12-month rolling avg
            </div>
          </>
        )}
        {view === 'yearly' && (
          <p className="text-[10px] text-gray-400">
            {curYear} bar is partial (year in progress)
          </p>
        )}
        <p className="text-[10px] text-gray-400">AEST · completed orders only</p>
      </div>
    </div>
  );
}
