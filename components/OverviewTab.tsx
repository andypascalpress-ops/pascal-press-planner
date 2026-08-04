'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversionSnapshot {
  rate:      number | null;
  deltaPp:   number | null;
  direction: 'up' | 'down' | 'flat' | null;
  sessions:  number | null;
  purchases: number | null;
  reason:    string | null;
  source?:   'ga4' | 'bigcommerce_hybrid' | null;
}

interface BrandData {
  spend:          number;
  budget:         number;
  revenue:        number;
  revenueTarget?: number;
  aov?:           number | null;
  aovPrev?:       number | null;
  roas:           number;
  orders:         number;
  revConnected:   boolean;
  adsConnected:   boolean;
  adsError?:      string | null;
  conversion?:    ConversionSnapshot | null;
}

interface OverviewData {
  month:        string;
  daysInMonth:  number;
  currentDay:   number;
  pp:           BrandData;
  etz:          BrandData;
  hsc:          BrandData;
  blake:        BrandData;
  combined: {
    spend:          number;
    revenue:        number;
    roas:           number;
    revenueTarget?: number;
  };
  email: {
    connected:     boolean;
    avgOpenRate:   number;
    avgClickRate:  number;
    totalSends:    number;
    campaignCount: number;
  } | null;
  alerts:     OverviewAlert[];
  rangeLabel:  string;
  isMonthly:   boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const PCT = (v: number) => `${Math.round(v * 100)}%`;

function roasColor(roas: number): string {
  if (roas >= 5)  return 'text-emerald-600';
  if (roas >= 3)  return 'text-amber-600';
  if (roas > 0)   return 'text-red-600';
  return 'text-gray-400';
}

function budgetBarColor(pct: number): string {
  if (pct > 1.0)  return 'bg-red-500';
  if (pct > 0.85) return 'bg-amber-500';
  return 'bg-blue-500';
}


function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y!), parseInt(m!) - 1, 1);
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

// ─── Band 6 Tracker types ────────────────────────────────────────────────────

interface Band6Product { id: number; name: string; sku: string; }
interface Band6ProductRow {
  productId: number;
  name: string;
  shortName: string;
  units: number;
  orders: number;
  revenue: number;
}
interface Band6WeekPoint { date: string; revenue: number; }

interface Band6Data {
  connected:      boolean;
  error?:         string;
  products:       Band6Product[];
  productBreakdown?: Band6ProductRow[];
  dailySeries?:   Band6WeekPoint[];
  revenue:        number;   // full campaign window
  orders:         number;
  units:          number;
  periodRevenue?: number;   // filtered by range
  periodOrders?:  number;
  periodUnits?:   number;
  rangeLabel?:    string;
  range?:         string;
  target:         number;
  startDate:      string;
  endDate:        string;
  daysRemaining:  number;
}

function Band6Chart({ series }: { series: Band6WeekPoint[] }) {
  if (series.length < 1) return null;

  const W = 600; const H = 140; const PAD = { t: 12, r: 16, b: 28, l: 52 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const maxRev = Math.max(...series.map(p => p.revenue), 1);
  // Round up to a nice Y ceiling
  const rawStep = maxRev / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / mag) * mag;
  const yMax = niceStep * 3;

  const barW = Math.max(4, (chartW / series.length) * 0.6);
  const gap  = chartW / series.length;

  const xOf  = (i: number) => i * gap + gap / 2;
  const yOf  = (v: number) => chartH - (v / yMax) * chartH;
  const hOf  = (v: number) => (v / yMax) * chartH;

  const yTicks = [0, niceStep, niceStep * 2, yMax];

  // Determine trend colour: compare last half avg vs first half avg
  const half = Math.max(1, Math.floor(series.length / 2));
  const firstAvg = series.slice(0, half).reduce((s, p) => s + p.revenue, 0) / half;
  const lastAvg  = series.slice(-half).reduce((s, p) => s + p.revenue, 0) / half;
  const barColor = lastAvg >= firstAvg * 1.1 ? '#10b981' : lastAvg <= firstAvg * 0.85 ? '#ef4444' : '#8b5cf6';

  // Smooth trend line through bar midpoints
  const trendPts = series.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.revenue).toFixed(1)}`).join(' ');

  const fmt = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
      <g transform={`translate(${PAD.l},${PAD.t})`}>
        {/* Grid + Y labels */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={0} y1={yOf(v)} x2={chartW} y2={yOf(v)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={-6} y={yOf(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{fmt(v)}</text>
          </g>
        ))}

        {/* Weekly revenue bars */}
        {series.map((p, i) => (
          <rect
            key={p.date}
            x={xOf(i) - barW / 2}
            y={yOf(p.revenue)}
            width={barW}
            height={hOf(p.revenue)}
            rx={2}
            fill={barColor}
            opacity={0.75}
          />
        ))}

        {/* Trend polyline */}
        {series.length >= 3 && (
          <polyline
            points={trendPts}
            fill="none"
            stroke={barColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.9}
          />
        )}

        {/* X axis: week labels (show Mon day for each bar) */}
        {series.map((p, i) => {
          if (series.length > 8 && i % 2 !== 0) return null;
          const d = new Date(p.date + 'T12:00:00Z');
          const label = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
          return (
            <text key={p.date} x={xOf(i)} y={chartH + 18} textAnchor="middle" fontSize={9} fill="#9ca3af">
              {label}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueClass = '', target }: {
  label: string; value: string; sub?: string; valueClass?: string; target?: number;
}) {
  const numericValue = parseFloat(value.replace(/[^0-9.]/g, ''));
  const pct   = target && target > 0 ? Math.min(numericValue / target, 1) : 0;
  const over  = target ? numericValue > target : false;
  const color = pct >= 1 ? 'bg-emerald-500' : pct >= 0.7 ? 'bg-blue-500' : pct >= 0.4 ? 'bg-amber-500' : 'bg-orange-400';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold text-gray-900 ${valueClass}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
      {target && target > 0 && (
        <div className="mt-1.5 space-y-1">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>{over ? '✓ ' : ''}{Math.round(pct * 100)}% of {AUD.format(target)} target</span>
            {!over && <span>{AUD.format(target - numericValue)} to go</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetBar({ spend, budget, dayPct, isMonthly = true }: {
  spend: number; budget: number; dayPct: number; isMonthly?: boolean;
}) {
  const spendPct = budget > 0 ? Math.min(spend / budget, 1.05) : 0;
  const barColor = budgetBarColor(spend / (budget || 1));

  // Projected end-of-month spend — only meaningful for monthly views after day 2
  const projected = isMonthly && dayPct > 0.05 && spend > 0 ? spend / dayPct : null;
  const projPct   = projected && budget > 0 ? projected / budget : null;
  const projClass = projPct == null ? ''
    : projPct > 1.1  ? 'text-red-600 font-medium'
    : projPct > 1.0  ? 'text-amber-600 font-medium'
    : projPct >= 0.85 ? 'text-emerald-600'
    : 'text-amber-600';
  const projStatus = projPct == null ? ''
    : projPct > 1.1  ? `${Math.round((projPct - 1) * 100)}% over budget`
    : projPct > 1.0  ? 'slightly over budget'
    : projPct >= 0.85 ? 'on track'
    : `${Math.round((1 - projPct) * 100)}% underpacing`;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{AUD.format(spend)} spent</span>
        <span>{AUD.format(budget)} monthly budget</span>
      </div>
      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        {/* Ghost bar — projected month-end spend (monthly view only) */}
        {projPct != null && (
          <div
            className="absolute h-full rounded-full bg-gray-300 opacity-40"
            style={{ width: `${Math.min(projPct * 100, 100)}%` }}
          />
        )}
        {/* Actual spend bar */}
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(spendPct * 100, 100)}%` }}
        />
        {/* Day marker — only for monthly view */}
        {isMonthly && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-60"
            style={{ left: `${dayPct * 100}%` }}
            title={`${Math.round(dayPct * 100)}% through month`}
          />
        )}
      </div>
      <div className="flex justify-between text-xs">
        <span className={budget > 0 && spend / budget > 1.0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
          {budget > 0 ? PCT(spend / budget) : '—'} of monthly budget
        </span>
        {isMonthly
          ? <span className="text-gray-400">{Math.round(dayPct * 100)}% of month elapsed</span>
          : <span className="text-gray-400">monthly budget {AUD.format(budget)}</span>
        }
      </div>
      {projected != null && (
        <div className="flex items-center gap-1.5 text-xs pt-0.5">
          <span className="text-gray-400">Projected month-end:</span>
          <span className={projClass}>{AUD.format(Math.round(projected))} · {projStatus}</span>
        </div>
      )}
    </div>
  );
}

// ─── Blake Education — extra data (subscriptions + downloads) ────────────────

interface BlakeSubMonth  { month: string; count: number; revenue: number; }
interface BlakeSubData   { months: BlakeSubMonth[]; totalCount: number; totalRevenue: number; connected: boolean; }
interface BlakeDlProduct { productId: number; name: string; downloads: number; }
interface BlakeDlMonth   { month: string; count: number; }
interface BlakeDlData    { topProducts: BlakeDlProduct[]; months: BlakeDlMonth[]; totalPurchases: number; connected: boolean; }

function BlakeExtraCard() {
  const [subs, setSubs] = useState<BlakeSubData  | null>(null);
  const [dls,  setDls]  = useState<BlakeDlData   | null>(null);

  useEffect(() => {
    fetch('/api/blake-subscriptions').then(r => r.ok ? r.json() : null).then(setSubs).catch(() => {});
    fetch('/api/blake-downloads').then(r => r.ok ? r.json() : null).then(setDls).catch(() => {});
  }, []);

  const monthLabel = (ym: string) =>
    new Date(Number(ym.slice(0,4)), Number(ym.slice(5,7)) - 1, 1)
      .toLocaleString('en-AU', { month: 'short', year: '2-digit' });

  const maxCount   = Math.max(...(subs?.months.map(m => m.count) ?? [1]), 1);
  const maxDl      = dls?.topProducts[0]?.downloads ?? 1;

  return (
    <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-5 space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Blake Education</span>
        <span className="text-sm font-semibold text-gray-700">Subscriptions &amp; Downloads</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── Subscriptions (product #1072) ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Subscriptions — Product #1072</p>
            {subs?.connected && (
              <span className="text-xs text-gray-400">{subs.totalCount} orders · {AUD.format(subs.totalRevenue)}</span>
            )}
          </div>
          {!subs ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="w-8 h-3 bg-gray-100 rounded" />
                  <div className="flex-1 h-4 bg-gray-100 rounded-full" />
                  <div className="w-4 h-3 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : !subs.connected ? (
            <p className="text-xs text-red-500">Could not connect to Blake BigCommerce.</p>
          ) : (
            <div className="space-y-1.5">
              {subs.months.slice().reverse().slice(0, 12).map(m => (
                <div key={m.month} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 w-10 shrink-0 text-right">{monthLabel(m.month)}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-400 rounded-full transition-all"
                      style={{ width: m.count > 0 ? `${(m.count / maxCount) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 w-5 text-right tabular-nums">{m.count}</span>
                  <span className="text-[11px] text-gray-400 w-16 text-right tabular-nums">{m.revenue > 0 ? AUD.format(m.revenue) : '—'}</span>
                </div>
              ))}
              {subs.totalCount === 0 && (
                <p className="text-xs text-gray-400">No subscription orders in the last 12 months.</p>
              )}
            </div>
          )}
        </div>

        {/* ── File Downloads (cumulative leaderboard) ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">PDF Purchases (last 12 months)</p>
            {dls?.connected && dls.totalPurchases > 0 && (
              <span className="text-xs text-gray-400">
                {dls.totalPurchases.toLocaleString()} orders
              </span>
            )}
          </div>
          {!dls ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="flex-1 h-3 bg-gray-100 rounded" />
                  <div className="w-8 h-3 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : !dls.connected ? (
            <p className="text-xs text-red-500">Could not fetch download data from Blake BigCommerce.</p>
          ) : dls.topProducts.length === 0 ? (
            <p className="text-xs text-gray-400">No digital products found.</p>
          ) : (
            <div className="space-y-1.5">
              {dls.topProducts.slice(0, 12).map((p, i) => (
                <div key={p.productId} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-300 w-4 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-700 truncate leading-tight">{p.name}</p>
                    <div className="mt-0.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-300 rounded-full"
                        style={{ width: `${(p.downloads / maxDl) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 w-12 text-right tabular-nums shrink-0">
                    {p.downloads.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pascal Press — Abandoned Cart Rate ──────────────────────────────────────

interface PPAbandonedCartsData {
  connected:         boolean;
  days:              number;
  currentRate:       number;
  previousRate:      number;
  deltaRatePp:       number;
  currentAbandoned:  number;
  currentCompleted:  number;
  previousAbandoned: number;
  previousCompleted: number;
}

function PPAbandonedCartCard() {
  const [data, setData] = useState<PPAbandonedCartsData | null>(null);

  useEffect(() => {
    fetch('/api/bc-abandoned-carts?days=30')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
        <div className="h-4 w-48 bg-gray-100 rounded mb-4" />
        <div className="h-8 w-24 bg-gray-100 rounded mb-2" />
        <div className="h-3 w-64 bg-gray-100 rounded" />
      </div>
    );
  }
  if (!data.connected) return null;

  const direction  = data.deltaRatePp < -1 ? 'down' : data.deltaRatePp > 1 ? 'up' : 'flat';
  const deltaColor = direction === 'down' ? 'bg-emerald-100 text-emerald-700'
                   : direction === 'up'   ? 'bg-red-100 text-red-700'
                   : 'bg-gray-100 text-gray-600';
  const deltaArrow = direction === 'down' ? '↓' : direction === 'up' ? '↑' : '→';
  const deltaLabel = direction === 'down' ? 'lower' : direction === 'up' ? 'higher' : 'unchanged';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Pascal Press</span>
          <span className="text-sm font-semibold text-gray-700">Abandoned Cart Rate</span>
        </div>
        <span className="text-xs text-gray-400">Last {data.days} days vs prior {data.days} days</span>
      </div>

      <div className="flex items-end gap-8">
        {/* Current rate */}
        <div>
          <p className="text-3xl font-bold text-gray-900">{data.currentRate.toFixed(1)}%</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.currentAbandoned} abandoned · {data.currentCompleted} completed
          </p>
        </div>

        {/* Comparison */}
        <div className="flex flex-col gap-1 pb-0.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${deltaColor}`}>
            {deltaArrow} {Math.abs(data.deltaRatePp).toFixed(1)}pp {deltaLabel} than prior period
          </span>
          <span className="text-xs text-gray-400">
            Prior: {data.previousRate.toFixed(1)}% · {data.previousAbandoned} abandoned / {data.previousAbandoned + data.previousCompleted} initiated
          </span>
        </div>
      </div>
    </div>
  );
}

function BrandCard({ name, data, dayPct, isMonthly, onNavigate }: {
  name: string;
  data: BrandData;
  dayPct: number;
  isMonthly: boolean;
  onNavigate: () => void;
}) {
  const tagColor =
    name === 'Pascal Press' ? 'bg-blue-100 text-blue-700'
    : name === 'Blake Education' ? 'bg-violet-100 text-violet-700'
    : 'bg-emerald-100 text-emerald-700';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>{name}</span>
        <button onClick={onNavigate} className="text-xs text-blue-600 hover:underline">
          View Finance →
        </button>
      </div>

      {/* Revenue (+ ROAS only when Google Ads is connected) */}
      <div className={`grid gap-3 ${data.adsConnected ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Revenue</p>
          <p className="text-lg font-bold text-gray-900">
            {data.revConnected ? AUD.format(data.revenue) : <span className="text-gray-400 text-sm">Not connected</span>}
          </p>
          {data.orders > 0 && <p className="text-xs text-gray-400">{data.orders.toLocaleString()} orders</p>}
          {/* AOV with MoM comparison */}
          {data.revConnected && data.aov != null && (
            <div className="mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">{AUD.format(data.aov)} AOV</span>
                {data.aovPrev != null && (() => {
                  const delta = data.aov! - data.aovPrev!;
                  const pct   = Math.round(Math.abs(delta) / data.aovPrev! * 100);
                  const up    = delta >= 0;
                  return (
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {up ? '↑' : '↓'} {up ? '+' : '-'}{AUD.format(Math.abs(delta))} ({pct}%) vs last month
                    </span>
                  );
                })()}
              </div>
              {data.aovPrev != null && (
                <p className="text-xs text-gray-400 mt-0.5">Last month: {AUD.format(data.aovPrev)}</p>
              )}
            </div>
          )}
          {/* Sales target bar — Pascal Press only */}
          {data.revConnected && data.revenueTarget && data.revenueTarget > 0 && (() => {
            const pct     = Math.min(data.revenue / data.revenueTarget, 1.05);
            const over    = data.revenue > data.revenueTarget;
            const barColor = over ? 'bg-emerald-500' : pct >= 0.75 ? 'bg-blue-500' : pct >= 0.5 ? 'bg-amber-500' : 'bg-red-400';
            const textColor = over ? 'text-emerald-600 font-medium' : pct >= 0.75 ? 'text-blue-600' : pct >= 0.5 ? 'text-amber-600' : 'text-red-600 font-medium';
            return (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs">
                  <span className={textColor}>
                    {over ? '✓ ' : ''}{Math.round(pct * 100)}% of {AUD.format(data.revenueTarget)} target
                  </span>
                  {!over && (
                    <span className="text-gray-400">{AUD.format(data.revenueTarget - data.revenue)} to go</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        {data.adsConnected && (
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Google Ads ROAS</p>
            <p className={`text-lg font-bold ${roasColor(data.roas)}`}>
              {data.roas > 0 ? `${data.roas}x` : <span className="text-gray-400 text-sm">—</span>}
            </p>
            {data.spend > 0 && (
              <p className="text-xs text-gray-400">{AUD.format(data.spend)} spend</p>
            )}
          </div>
        )}
      </div>

      {/* Site conversion — PP: BC orders/visits; ETZ: GA purchases/sessions */}
      {data.conversion?.rate != null && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-xs text-indigo-600 font-medium mb-0.5">Site conversion · GA4 · this range</p>
              <p className="text-lg font-bold text-indigo-900">
                {data.conversion.rate.toFixed(2)}%
              </p>
            </div>
            {data.conversion.deltaPp != null && data.conversion.direction && (
              <span className={
                'text-xs font-semibold px-2 py-0.5 rounded-full ' +
                (data.conversion.direction === 'up'
                  ? 'bg-emerald-100 text-emerald-700'
                  : data.conversion.direction === 'down'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600')
              }>
                {data.conversion.direction === 'up' ? '↑' : data.conversion.direction === 'down' ? '↓' : '→'}{' '}
                {data.conversion.deltaPp > 0 ? '+' : ''}{data.conversion.deltaPp.toFixed(2)}pp
              </span>
            )}
          </div>
          {(data.conversion.sessions != null || data.conversion.purchases != null) && (
            <p className="text-xs text-indigo-500/80 mt-1">
              {(data.conversion.purchases ?? 0).toLocaleString()} purchases ·{' '}
              {(data.conversion.sessions ?? 0).toLocaleString()} sessions
            </p>
          )}
          {data.conversion.reason && (
            <p className="text-xs text-indigo-800/80 mt-1.5 leading-snug">{data.conversion.reason}</p>
          )}
        </div>
      )}

      {/* Google Ads token expired / disconnected notice */}
      {!data.adsConnected && data.adsError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-700">Google Ads disconnected</p>
          <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">
            {data.adsError.includes('invalid_grant') || data.adsError.includes('expired') || data.adsError.includes('revoked')
              ? 'Refresh token expired (Google resets it every 7 days for unpublished apps). Run scripts/get-google-refresh-token.mjs and update GOOGLE_ADS_REFRESH_TOKEN in Vercel — or publish the OAuth app in Google Cloud Console for a permanent token.'
              : 'Could not connect to Google Ads. Check GOOGLE_ADS_* env vars in Vercel.'}
          </p>
        </div>
      )}

      {/* Budget bar only when ads are connected */}
      {data.adsConnected && (
        <BudgetBar spend={data.spend} budget={data.budget} dayPct={dayPct} isMonthly={isMonthly} />
      )}
    </div>
  );
}

type Band6Range = 'all' | 'mtd' | 'last7' | 'yesterday' | 'today';
const BAND6_RANGES: { key: Band6Range; label: string }[] = [
  { key: 'all',       label: 'All time'   },
  { key: 'mtd',       label: 'This month' },
  { key: 'last7',     label: 'Last 7 days'},
  { key: 'yesterday', label: 'Yesterday'  },
  { key: 'today',     label: 'Today'      },
];

function Band6TrackerCard() {
  const [range,   setRange]   = useState<Band6Range>('all');
  const [data,    setData]    = useState<Band6Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/band6-tracker?range=${range}`)
      .then(r => r.json())
      .then((d: Band6Data) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [range]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
        <div className="w-4 h-4 rounded-full border-2 border-purple-600 border-t-transparent animate-spin" />
        <p className="text-sm text-gray-400">Loading Band 6 tracker…</p>
      </div>
    );
  }
  if (!data || !data.connected) return null;

  const pct         = data.target > 0 ? Math.min(data.revenue / data.target, 1) : 0;
  const remaining   = Math.max(0, data.target - data.revenue);
  const dailyNeeded = data.daysRemaining > 0 ? remaining / data.daysRemaining : null;
  const barColor    = pct >= 1 ? 'bg-emerald-500' : pct >= 0.7 ? 'bg-blue-500' : pct >= 0.4 ? 'bg-amber-500' : 'bg-orange-400';
  const needColor   = !dailyNeeded ? 'text-gray-400' : dailyNeeded < 300 ? 'text-emerald-600' : dailyNeeded < 700 ? 'text-amber-600' : 'text-red-600';
  const rows        = data.productBreakdown ?? [];
  const productCount = rows.length > 0 ? rows.length : data.products.length;

  const isFiltered  = range !== 'all';
  const dispRevenue = isFiltered ? (data.periodRevenue ?? 0) : data.revenue;
  const dispOrders  = isFiltered ? (data.periodOrders  ?? 0) : data.orders;
  const dispUnits   = isFiltered ? (data.periodUnits   ?? 0) : data.units;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800">60 Days to Band 6</h3>
            <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">Series Tracker</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {productCount > 0 ? `${productCount} titles selling` : 'No sales yet'} · target by Nov 2026
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-bold text-gray-900">{AUD.format(data.revenue)}</p>
          <p className="text-xs text-gray-400">of {AUD.format(data.target)} goal</p>
        </div>
      </div>

      {/* Progress bar — always full-period */}
      <div className="space-y-1 mb-4">
        <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span className="font-medium text-gray-700">{Math.round(pct * 100)}% to goal</span>
          <span>{data.daysRemaining} days left</span>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        {BAND6_RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              range === r.key
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Stats — filtered when a range is active */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-base font-bold text-gray-900">{dispOrders}</p>
          <p className="text-xs text-gray-500">Orders</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-base font-bold text-gray-900">{dispUnits}</p>
          <p className="text-xs text-gray-500">Units sold</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          {isFiltered ? (
            <>
              <p className="text-base font-bold text-purple-700">{AUD.format(dispRevenue)}</p>
              <p className="text-xs text-gray-500">Revenue</p>
            </>
          ) : (
            <>
              <p className={`text-base font-bold ${needColor}`}>
                {dailyNeeded != null ? AUD.format(Math.ceil(dailyNeeded)) : '—'}
              </p>
              <p className="text-xs text-gray-500">Needed/day</p>
            </>
          )}
        </div>
      </div>

      {/* Weekly sales trend chart */}
      {data.dailySeries && data.dailySeries.length >= 1 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Weekly sales — {data.rangeLabel ?? 'All time'}
            </p>
            <p className="text-xs text-gray-400">Each bar = one week</p>
          </div>
          <Band6Chart series={data.dailySeries} />
        </div>
      )}

      {/* Product revenue breakdown */}
      {rows.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">By product (all time)</p>
          <div className="space-y-2">
            {rows.map((row) => {
              const share = data.revenue > 0 ? row.revenue / data.revenue : 0;
              return (
                <div key={row.productId || row.name}>
                  <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
                    <span className="text-gray-700 font-medium truncate" title={row.name}>
                      {row.shortName || row.name}
                    </span>
                    <span className="text-gray-900 font-semibold tabular-nums shrink-0">
                      {AUD.format(row.revenue)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-400"
                        style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0 w-16 text-right">
                      {row.units}u · {row.orders}o
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface OverviewTabProps {
  onNavigate: (view: 'finance' | 'email') => void;
}

export default function OverviewTab({ onNavigate }: OverviewTabProps) {
  const [data,       setData]       = useState<OverviewData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  type DateRange = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';
  const RANGE_OPTIONS: { key: DateRange; label: string }[] = [
    { key: 'today',     label: 'Today'        },
    { key: 'yesterday', label: 'Yesterday'     },
    { key: 'last7',     label: 'Last 7 days'   },
    { key: 'last30',    label: 'Last 30 days'  },
    { key: 'mtd',       label: 'Month to date' },
    { key: 'lastmonth', label: 'Last month'    },
  ];
  const [dateRange, setDateRange] = useState<DateRange>('mtd');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/overview?range=${dateRange}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);


  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderWidth: 3, borderStyle: 'solid' }} />
          <p className="text-sm text-gray-500">Loading overview…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-sm text-center">
          <p className="text-sm text-red-700 mb-3">{error || 'No data'}</p>
          <button onClick={load} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Retry</button>
        </div>
      </div>
    );
  }

  const { month, daysInMonth, currentDay, pp, etz, hsc, blake, combined, email, rangeLabel, isMonthly } = data;
  const dayPct = currentDay / daysInMonth;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Executive Overview</h2>
            <p className="text-sm text-gray-500">{rangeLabel ?? monthLabel(month)}</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 6.5a4.5 4.5 0 1 1-.9-2.7"/>
              <polyline points="11 2 11 5 8 5"/>
            </svg>
            Refresh
          </button>
        </div>

        {/* ── Date range selector ── */}
        <div className="flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDateRange(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                dateRange === key
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>


        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Total Revenue"
            value={AUD.format(combined.revenue)}
            sub="PP + ETZ + HSC + Blake"
            valueClass="text-emerald-700"
            target={combined.revenueTarget}
          />
          <KpiCard
            label="Total Ad Spend"
            value={AUD.format(combined.spend)}
            sub={`of ${AUD.format(pp.budget + etz.budget + hsc.budget + (blake?.adsConnected ? blake.budget : 0))} budget`}
          />
          <KpiCard
            label="Combined ROAS"
            value={combined.roas > 0 ? `${combined.roas}x` : '—'}
            sub="Revenue ÷ ad spend"
            valueClass={roasColor(combined.roas)}
          />
          <KpiCard
            label="Email Open Rate"
            value={email?.connected && email.totalSends > 0 ? PCT(email.avgOpenRate) : '—'}
            sub={email?.totalSends ? `${email.totalSends.toLocaleString()} sends · ${email.campaignCount} campaigns` : 'No emails this month'}
            valueClass={email?.avgOpenRate && email.avgOpenRate > 0.20 ? 'text-emerald-700' : email?.avgOpenRate && email.avgOpenRate < 0.15 ? 'text-red-600' : ''}
          />
        </div>

        {/* ── Brand cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BrandCard name="Pascal Press"      data={pp}  dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} />
          <BrandCard name="Excel Test Zone"   data={etz} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} />
          <BrandCard name="Excel HSC Copilot" data={hsc} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} />
          {blake && (
            <BrandCard name="Blake Education" data={blake} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} />
          )}
          {blake && <BlakeExtraCard />}
        </div>

        {/* ── Pascal Press — Abandoned Cart Rate ── */}
        <PPAbandonedCartCard />

        {/* ── Band 6 Tracker ── */}
        <Band6TrackerCard />

        {/* ── Email snapshot ── */}
        {email && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Email Performance</h3>
              <button onClick={() => onNavigate('email')} className="text-xs text-blue-600 hover:underline">
                View Email tab →
              </button>
            </div>
            {email.connected && email.totalSends > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Open Rate</p>
                  <p className={`text-xl font-bold ${email.avgOpenRate > 0.20 ? 'text-emerald-600' : email.avgOpenRate < 0.15 ? 'text-red-600' : 'text-amber-600'}`}>
                    {PCT(email.avgOpenRate)}
                  </p>
                  <p className="text-xs text-gray-400">Benchmark: 15–25%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Click Rate</p>
                  <p className={`text-xl font-bold ${email.avgClickRate > 0.025 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {PCT(email.avgClickRate)}
                  </p>
                  <p className="text-xs text-gray-400">Benchmark: 2–5%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Total Sends</p>
                  <p className="text-xl font-bold text-gray-900">{email.totalSends.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Campaigns Sent</p>
                  <p className="text-xl font-bold text-gray-900">{email.campaignCount}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                {email.connected ? 'No emails sent this month yet.' : 'HubSpot not connected.'}
              </p>
            )}
          </div>
        )}

        {/* ── Legend ── */}
        <p className="text-xs text-gray-400 text-center pb-2">
          Data refreshes every 5 minutes · Budget pacing line (|) marks today's position in the month
        </p>

      </div>
    </div>
  );
}
