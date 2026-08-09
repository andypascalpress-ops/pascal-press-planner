'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface MonthData {
  month: string;       // YYYY-MM
  revenue: number;
  orders: number;
}

interface SalesData {
  connected: boolean;
  months: MonthData[];
  currentMonth: string;
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const AUDk = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : AUD.format(n);

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTH_LABELS[parseInt(m!) - 1]} ${y}`;
}

function shortMonth(ym: string) {
  const [y, m] = ym.split('-');
  return parseInt(m!) === 1 ? `Jan ${y}` : MONTH_LABELS[parseInt(m!) - 1]!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, currentMonth }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as MonthData;
  const isPartial = d.month === currentMonth;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{formatMonth(label)}{isPartial ? ' (partial)' : ''}</p>
      <p className="text-gray-800"><span className="text-gray-400">Revenue </span>{AUD.format(d.revenue)}</p>
      <p className="text-gray-800"><span className="text-gray-400">Orders  </span>{d.orders.toLocaleString('en-AU')}</p>
    </div>
  );
}

export default function SalesTrendCard() {
  const [data,    setData]    = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<'revenue' | 'orders'>('revenue');

  useEffect(() => {
    fetch('/api/bc-sales-monthly')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-4" />
        <div className="h-48 bg-gray-50 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!data?.connected || !data.months.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-400">Sales trend data unavailable.</p>
      </div>
    );
  }

  const months = data.months;
  const currentMonth = data.currentMonth;

  // Summary stats
  const completed = months.filter(m => m.month < currentMonth);
  const last12    = completed.slice(-12);
  const prev12    = completed.slice(-24, -12);
  const last12Rev = last12.reduce((s, m) => s + m.revenue, 0);
  const prev12Rev = prev12.reduce((s, m) => s + m.revenue, 0);
  const yoy       = prev12Rev > 0 ? ((last12Rev - prev12Rev) / prev12Rev) * 100 : null;
  const bestMonth = [...completed].sort((a, b) => b.revenue - a.revenue)[0];

  // Year boundary reference lines (Jan of each year)
  const yearBoundaries = months
    .filter(m => m.month.endsWith('-01') && m.month !== months[0]?.month)
    .map(m => m.month);

  // Chart data — mark current month
  const chartData = months.map(m => ({
    ...m,
    value:   view === 'revenue' ? m.revenue : m.orders,
    partial: m.month === currentMonth,
  }));

  const maxVal = Math.max(...chartData.map(d => d.value));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Pascal Press — All-Time Sales Trend</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatMonth(months[0]!.month)} → {formatMonth(months[months.length - 1]!.month)}
            {' · '}{months.length} months · completed orders only
          </p>
        </div>
        {/* Toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          {(['revenue', 'orders'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 capitalize transition-colors ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Last 12 months</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(last12Rev)}</p>
          {yoy !== null && (
            <p className={`text-[11px] font-semibold mt-0.5 ${yoy >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}% vs prior year
            </p>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Best month ever</p>
          {bestMonth && (
            <>
              <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(bestMonth.revenue)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{formatMonth(bestMonth.month)}</p>
            </>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Monthly avg (LY)</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">
            {last12.length > 0 ? AUD.format(Math.round(last12Rev / last12.length)) : '—'}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">{last12.length} months</p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ppSalesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            {yearBoundaries.map(ym => (
              <ReferenceLine key={ym} x={ym} stroke="#e2e8f0" strokeDasharray="4 2"
                label={{ value: ym.slice(0, 4), position: 'top', fontSize: 9, fill: '#94a3b8' }} />
            ))}
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 10, fill: '#94a3b8' }}
              interval={Math.floor(months.length / 10)} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => AUDk(v)} tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false} tickLine={false} width={42}
              domain={[0, Math.ceil(maxVal * 1.1 / 1000) * 1000]} />
            <Tooltip content={<CustomTooltip currentMonth={currentMonth} />} />
            <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2}
              fill="url(#ppSalesGrad)" dot={false}
              activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-gray-400 mt-2 text-center">
        Current month ({formatMonth(currentMonth)}) is partial · AEST · BigCommerce completed orders
      </p>
    </div>
  );
}
