'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Line, ComposedChart,
  Area, Cell,
} from 'recharts';

interface MonthData { month: string; revenue: number; orders: number; }
interface SalesData  { connected: boolean; months: MonthData[]; currentMonth: string; }

const AUD  = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const AUDk = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtMonth = (ym: string) => { const [y,m]=ym.split('-'); const mi=parseInt(m!,10)-1; return `${MON[mi]} ${y}`; };
const shortMon = (ym: string) => { const [y,m]=ym.split('-'); const mi=parseInt(m!,10); return mi===1?`Jan ${y}`:MON[mi-1]!; };

type Tier = 'high' | 'shoulder' | 'low';
const TIER_FILL:   Record<Tier,string> = { high: '#3b82f6', shoulder: '#94a3b8', low: '#e2e8f0' };
const TIER_STROKE: Record<Tier,string> = { high: '#2563eb', shoulder: '#64748b', low: '#cbd5e1' };
const TIER_TEXT:   Record<Tier,string> = { high: 'text-blue-600', shoulder: 'text-slate-500', low: 'text-slate-400' };
const TIER_BG:     Record<Tier,string> = { high: 'bg-blue-50 border-blue-100', shoulder: 'bg-slate-50 border-slate-100', low: 'bg-gray-50 border-gray-100' };
const TIER_LABEL:  Record<Tier,string> = { high: 'High season', shoulder: 'Shoulder', low: 'Low season' };

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SeasonTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { avgRev: number; dailyAvg: number; tier: Tier; count: number; pctOfAvg: number };
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[170px]">
      <p className="font-semibold text-gray-700 mb-1.5">
        {label}
        <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          d.tier === 'high' ? 'bg-blue-100 text-blue-700' :
          d.tier === 'low'  ? 'bg-gray-100 text-gray-500' : 'bg-slate-100 text-slate-600'
        }`}>{TIER_LABEL[d.tier]}</span>
      </p>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Avg monthly rev</span><span className="font-semibold">{AUD.format(d.avgRev)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Avg daily rev</span><span className="font-semibold">{AUD.format(d.dailyAvg)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-gray-400">vs overall avg</span>
        <span className={`font-semibold ${d.pctOfAvg >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {d.pctOfAvg >= 0 ? '+' : ''}{d.pctOfAvg}%
        </span>
      </div>
      <div className="flex justify-between gap-4"><span className="text-gray-400">Years of data</span><span className="font-semibold">{d.count}</span></div>
    </div>
  );
}

type ViewMode = 'monthly' | 'yearly' | 'seasonality';
type Metric   = 'revenue' | 'orders';
type YearType = 'calendar' | 'financial';

export default function SalesTrendCard() {
  const [data,     setData]     = useState<SalesData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [view,     setView]     = useState<ViewMode>('yearly');
  const [metric,   setMetric]   = useState<Metric>('revenue');
  const [yearType, setYearType] = useState<YearType>('financial');

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
  const totalDays       = completed.length * 30.44;
  const allTimeMonthAvg = completed.length > 0 ? totalRev / completed.length : 0;
  const allTimeDayAvg   = totalDays > 0 ? totalRev / totalDays : 0;

  const last24       = completed.slice(-24);
  const last24Rev    = last24.reduce((s, m) => s + m.revenue, 0);
  const last24DayAvg = last24.length > 0 ? last24Rev / (last24.length * 30.44) : 0;

  // ── Seasonality data ───────────────────────────────────────────────────────
  // Accumulate revenue + exact days per calendar-month-of-year (0 = Jan, 11 = Dec)
  const byMOY = Array.from({ length: 12 }, () => ({ totalRev: 0, totalDays: 0, count: 0 }));
  for (const m of completed) {
    const parts = m.month.split('-');
    const y  = parseInt(parts[0]!, 10);
    const mo = parseInt(parts[1]!, 10); // 1-indexed
    const mi = mo - 1;                  // 0-indexed
    const days = new Date(y, mo, 0).getDate(); // actual days in that month
    byMOY[mi]!.totalRev  += m.revenue;
    byMOY[mi]!.totalDays += days;
    byMOY[mi]!.count++;
  }

  // Tier thresholds: ±15% of all-time monthly average
  const HIGH_THRESH = allTimeMonthAvg * 1.15;
  const LOW_THRESH  = allTimeMonthAvg * 0.85;

  const seasonData = byMOY.map((d, i) => {
    const avgRev   = d.count > 0 ? d.totalRev / d.count : 0;
    const dailyAvg = d.totalDays > 0 ? d.totalRev / d.totalDays : 0;
    const tier: Tier = avgRev > HIGH_THRESH ? 'high' : avgRev < LOW_THRESH ? 'low' : 'shoulder';
    const pctOfAvg = allTimeMonthAvg > 0 ? Math.round(((avgRev - allTimeMonthAvg) / allTimeMonthAvg) * 100) : 0;
    return { label: MON[i]!, avgRev: Math.round(avgRev), dailyAvg: Math.round(dailyAvg), tier, count: d.count, pctOfAvg };
  });

  // Season-level KPIs: sum actual revenue & days per tier across all years
  const tierStats = (t: Tier) => byMOY.reduce(
    (acc, d, i) => seasonData[i]!.tier === t
      ? { rev: acc.rev + d.totalRev, days: acc.days + d.totalDays, months: acc.months + d.count }
      : acc,
    { rev: 0, days: 0, months: 0 }
  );
  const highStats    = tierStats('high');
  const shoulderStats = tierStats('shoulder');
  const lowStats     = tierStats('low');

  const highDailyAvg     = highStats.days    > 0 ? highStats.rev    / highStats.days    : 0;
  const shoulderDailyAvg = shoulderStats.days > 0 ? shoulderStats.rev / shoulderStats.days : 0;
  const lowDailyAvg      = lowStats.days     > 0 ? lowStats.rev     / lowStats.days     : 0;
  const highLowRatio     = lowDailyAvg > 0 ? highDailyAvg / lowDailyAvg : null;

  const highMonths     = seasonData.filter(d => d.tier === 'high').map(d => d.label);
  const shoulderMonths = seasonData.filter(d => d.tier === 'shoulder').map(d => d.label);
  const lowMonths      = seasonData.filter(d => d.tier === 'low').map(d => d.label);
  const maxSeasonVal   = Math.max(...seasonData.map(d => d.avgRev), 1);

  // ── Monthly chart data ─────────────────────────────────────────────────────
  const monthChartData = months.map((m, i) => {
    const window = completed.slice(Math.max(0, i - 11), i + 1);
    const rolling12 = metric === 'revenue' && window.length === 12
      ? Math.round(window.reduce((s, x) => s + x.revenue, 0) / 12)
      : null;
    return { ...m, value: metric === 'revenue' ? m.revenue : m.orders, rolling12 };
  });

  const yearBoundaries = months
    .filter(m => m.month.endsWith('-01') && m.month !== months[0]?.month)
    .map(m => m.month);

  // ── Yearly chart data ──────────────────────────────────────────────────────
  const curYear = currentMonth.slice(0, 4);
  const [cyStr, cmStr] = currentMonth.split('-');
  const curCM = parseInt(cmStr!, 10);
  const curCY = parseInt(cyStr!, 10);
  const curFYStartYear = curCM >= 7 ? curCY : curCY - 1;

  function getFYLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const fy = parseInt(m!, 10) >= 7 ? parseInt(y!, 10) + 1 : parseInt(y!, 10);
    return `FY${fy}`;
  }
  const curFY = getFYLabel(currentMonth);

  const firstMonth = months[0]?.month ?? currentMonth;
  const firstFY    = getFYLabel(firstMonth);
  const firstFYStartsAt = `${parseInt(firstFY.slice(2)) - 1}-07`;
  const firstFYIsPartial = firstMonth > firstFYStartsAt;

  const yearMap = new Map<string, { revenue: number; orders: number; count: number; partial: boolean }>();
  for (const m of months) {
    const label = yearType === 'financial' ? getFYLabel(m.month) : m.month.slice(0, 4);
    const isCurrentPartial = yearType === 'financial' ? label === curFY : label === curYear;
    const isFirstPartial   = yearType === 'financial'
      ? (label === firstFY && firstFYIsPartial)
      : (label === months[0]?.month.slice(0,4) && months[0]?.month.slice(5) !== '01');
    const entry = yearMap.get(label);
    if (!entry) yearMap.set(label, { revenue: m.revenue, orders: m.orders, count: 1, partial: isCurrentPartial || isFirstPartial });
    else { entry.revenue += m.revenue; entry.orders += m.orders; entry.count++; }
  }
  const yearChartData = [...yearMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, d]) => ({ year, ...d, value: metric === 'revenue' ? d.revenue : d.orders }));
  const partialLabel = yearType === 'financial' ? curFY : curYear;

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
            {(['yearly','monthly','seasonality'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors ${view===v?'bg-gray-900 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                {v === 'yearly' ? 'By Year' : v === 'monthly' ? 'By Month' : 'Seasonality'}
              </button>
            ))}
          </div>
          {/* FY / CY toggle — yearly view only */}
          {view === 'yearly' && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {(['financial','calendar'] as YearType[]).map(v => (
                <button key={v} onClick={() => setYearType(v)}
                  className={`px-3 py-1.5 transition-colors ${yearType===v?'bg-emerald-600 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {v === 'financial' ? 'AU Fin. Year' : 'Calendar Year'}
                </button>
              ))}
            </div>
          )}
          {/* Metric toggle — yearly / monthly only */}
          {view !== 'seasonality' && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {(['revenue','orders'] as Metric[]).map(v => (
                <button key={v} onClick={() => setMetric(v)}
                  className={`px-3 py-1.5 capitalize transition-colors ${metric===v?'bg-blue-600 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI row — swaps in seasonality mode */}
      {view !== 'seasonality' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
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
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Daily avg (24 months)</p>
            <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(Math.round(last24DayAvg))}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">last {last24.length} months</p>
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
      ) : (
        /* Seasonality KPI tiles */
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {([ ['high', highDailyAvg, highMonths], ['shoulder', shoulderDailyAvg, shoulderMonths], ['low', lowDailyAvg, lowMonths] ] as [Tier, number, string[]][]).map(
            ([tier, avg, mons]) => (
              <div key={tier} className={`rounded-lg p-3 border ${TIER_BG[tier]}`}>
                <p className={`text-[10px] uppercase tracking-wide font-semibold ${TIER_TEXT[tier]}`}>{TIER_LABEL[tier]}</p>
                <p className="text-base font-bold text-gray-900 mt-0.5">{AUD.format(Math.round(avg))} <span className="text-xs font-normal text-gray-400">/ day</span></p>
                <p className="text-[10px] text-gray-400 mt-0.5 truncate">{mons.join(', ') || '—'}</p>
              </div>
            )
          )}
          <div className="rounded-lg p-3 border border-gray-100 bg-gray-50">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Peak vs off-peak</p>
            {highLowRatio !== null ? (
              <>
                <p className="text-base font-bold text-gray-900 mt-0.5">{highLowRatio.toFixed(1)}×</p>
                <p className="text-[10px] text-gray-400 mt-0.5">more revenue per day</p>
              </>
            ) : (
              <p className="text-base font-bold text-gray-400 mt-0.5">—</p>
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="h-60">
        {view === 'yearly' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => metric==='revenue' ? AUDk(v) : v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}
                tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46}
                domain={[0, Math.ceil(maxYearVal * 1.1 / 10000) * 10000]} />
              <Tooltip content={<YearTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="value" radius={[4,4,0,0]}
                label={{ position: 'top', fontSize: 9, fill: '#94a3b8',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter: (v: any) => metric==='revenue' ? AUDk(v) : v>=1000?`${(v/1000).toFixed(0)}k`:String(v) }}
                fill="#3b82f6"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shape={(props: any) => {
                  const { x, y, width, height, partial } = props;
                  return <rect x={x} y={y} width={width} height={height} rx={4} ry={4}
                    fill={partial ? '#93c5fd' : '#3b82f6'} opacity={partial ? 0.7 : 1} />;
                }}
              />
            </BarChart>
          </ResponsiveContainer>

        ) : view === 'monthly' ? (
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

        ) : (
          /* Seasonality chart — average monthly revenue by month of year */
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={seasonData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => AUDk(v)} tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false} tickLine={false} width={46}
                domain={[0, Math.ceil(maxSeasonVal * 1.15 / 1000) * 1000]} />
              {/* Reference line at overall monthly average */}
              <ReferenceLine y={Math.round(allTimeMonthAvg)} stroke="#f97316" strokeDasharray="4 2"
                label={{ value: `avg ${AUDk(Math.round(allTimeMonthAvg))}`, position: 'right', fontSize: 9, fill: '#f97316' }} />
              <Tooltip content={<SeasonTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="avgRev" radius={[4,4,0,0]}>
                {seasonData.map((entry, i) => (
                  <Cell key={i} fill={TIER_FILL[entry.tier]} stroke={TIER_STROKE[entry.tier]} strokeWidth={0} />
                ))}
              </Bar>
            </BarChart>
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
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-3 h-3 rounded-sm bg-blue-300 opacity-70" />
              {yearType === 'financial'
                ? `${partialLabel} = Jul ${curFYStartYear}–${new Date().toLocaleString('en-AU',{month:'short'})} ${curCY} (in progress)`
                : `${partialLabel} = Jan–${new Date().toLocaleString('en-AU',{month:'short'})} only (in progress)`
              }
            </div>
            {yearType === 'financial' && firstFYIsPartial && (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <div className="w-3 h-3 rounded-sm bg-blue-300 opacity-70" />
                {firstFY} starts from {fmtMonth(firstMonth)} (data begins Jan 2019)
              </div>
            )}
          </div>
        )}
        {view === 'seasonality' && (
          <div className="flex items-center gap-3 flex-wrap">
            {(['high','shoulder','low'] as Tier[]).map(t => (
              <div key={t} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TIER_FILL[t] }} />
                {TIER_LABEL[t]} (±15% of avg)
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-4 h-0 border-t border-dashed border-orange-400" />avg monthly rev
            </div>
          </div>
        )}
        <p className="text-[10px] text-gray-400">AEST · completed orders only</p>
      </div>
    </div>
  );
}
