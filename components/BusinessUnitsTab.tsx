'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Bar,
} from 'recharts';

type BrandKey = 'pp' | 'etz' | 'ehc' | 'blake';
type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';

interface BUMetrics {
  revenue: number;
  spend: number;
  roas: number;
  orders: number;
  aov: number;
  newCustomers: number;
  returningCustomers: number;
  cac: number | null;
  trialsStarted: number | null;
}

interface BUProduct {
  name: string;
  revenue: number;
  orders: number;
  pct: number;
  prevRevenue: number;
  changePct: number | null;
}

interface BUSubscriptions {
  active: number;
  trialing: number;
  mrr: number;
}

interface BUData {
  current: BUMetrics;
  prev: BUMetrics;
  products: BUProduct[];
  subscriptions: BUSubscriptions | null;
  sparkline: { date: string; revenue: number }[];
  period: { label: string };
  comparison: { label: string };
}

const BRANDS: { key: BrandKey; label: string }[] = [
  { key: 'pp',    label: 'Pascal Press'    },
  { key: 'etz',   label: 'Excel Test Zone' },
  { key: 'ehc',   label: 'EHC'             },
  { key: 'blake', label: 'Blake Education' },
];

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today',     label: 'Today'      },
  { key: 'yesterday', label: 'Yesterday'  },
  { key: 'last7',     label: 'Last 7d'    },
  { key: 'last30',    label: 'Last 30d'   },
  { key: 'mtd',       label: 'MTD'        },
  { key: 'lastmonth', label: 'Last month' },
];

const BRAND_COLOR: Record<BrandKey, string> = {
  pp:    '#2563eb',
  etz:   '#7c3aed',
  ehc:   '#059669',
  blake: '#d97706',
};

const BRAND_ACTIVE: Record<BrandKey, string> = {
  pp:    'bg-blue-600 text-white border-blue-600',
  etz:   'bg-violet-600 text-white border-violet-600',
  ehc:   'bg-emerald-600 text-white border-emerald-600',
  blake: 'bg-amber-600 text-white border-amber-600',
};

const BRAND_IDLE: Record<BrandKey, string> = {
  pp:    'text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700',
  etz:   'text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-700',
  ehc:   'text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-emerald-700',
  blake: 'text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-700',
};

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-AU');

function pctDelta(cur: number, prev: number): string | null {
  if (prev === 0) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return (p >= 0 ? '+' : '') + p + '%';
}

function DeltaBadge({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null || prev === 0) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const up = cur >= prev;
  return (
    <span className={`ml-1 text-[11px] font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}{Math.abs(p)}%
    </span>
  );
}

function MetricCard({
  label, value, prevValue, fmt = 'currency',
}: {
  label: string;
  value: number | null;
  prevValue?: number | null;
  fmt?: 'currency' | 'number' | 'roas';
}) {
  const fmt$ = (v: number | null) =>
    v == null ? '—' :
    fmt === 'currency' ? AUD.format(v) :
    fmt === 'roas'     ? `${v}x`       :
    NUM.format(v);

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
      <p className="text-xl font-bold text-gray-900 leading-tight">
        {fmt$(value)}
        <DeltaBadge cur={value} prev={prevValue ?? null} />
      </p>
      {prevValue != null && (
        <p className="text-[11px] text-gray-400 mt-0.5">prev {fmt$(prevValue)}</p>
      )}
    </div>
  );
}

interface PPSegment {
  key: string;
  label: string;
  active: number | null;
  joinersThisWeek: number;
  joinersLastWeek: number;
  listName: string;
}

interface PPSegmentData {
  connected: boolean;
  segments: PPSegment[];
}

interface PPContactData {
  connected: boolean;
  totalActive: number;
  joinersThisWeek: number;
  joinersLastWeek: number;
  unsubsThisWeek: number;
  unsubsLastWeek: number;
  net: number;
  netLastWeek: number;
  weekEndingLabel: string;
}

interface TrendPoint {
  month: string;
  revenue: number;
  orders: number;
  trials: number | null;
  newCustomers: number;
  newRevenue: number;
  returningCustomers: number;
  returningRevenue: number;
}

interface MonthlyMetric {
  current: number;
  prior: number;
  pctChange: number | null;
}

interface MonthlyConversionSide {
  converted: number;
  totalEverStarted: number;
  pct: number | null;
}

interface MonthlyChannel {
  channel: string;
  revenue: number;
  transactions: number;
  pct: number;
}

interface MonthlyUpdateData {
  connected: boolean;
  month: { key: string; start: string; end: string; label: string; isPartial: boolean };
  comparisonMonth: { key: string; start: string; end: string; label: string };
  revenue: MonthlyMetric;
  orders: MonthlyMetric;
  trials: MonthlyMetric;
  trialToPaid: { current: MonthlyConversionSide | null; prior: MonthlyConversionSide | null };
  bestChannel: { name: string; revenue: number; pct: number } | null;
  channels: MonthlyChannel[];
}

function todayYmdSydney(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addMonthsToKey(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  let nm = m! + n, ny = y!;
  while (nm > 12) { nm -= 12; ny++; }
  while (nm < 1)  { nm += 12; ny--; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export default function BusinessUnitsTab() {
  const [brand, setBrand] = useState<BrandKey>('pp');
  const [range, setRange] = useState<RangeKey>('last7');
  const [yoy,   setYoy]   = useState(false);
  const [data,  setData]  = useState<BUData | null>(null);

  const [showMonthly,    setShowMonthly]    = useState(false);
  const [monthAnchor,    setMonthAnchor]    = useState<string>(() => todayYmdSydney().slice(0, 7));
  const [monthlyData,    setMonthlyData]    = useState<MonthlyUpdateData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError,   setMonthlyError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const [trend,        setTrend]        = useState<TrendPoint[] | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  const [ppContacts,        setPPContacts]        = useState<PPContactData | null>(null);
  const [ppContactsLoading, setPPContactsLoading] = useState(true);

  const [ppSegments,        setPPSegments]        = useState<PPSegmentData | null>(null);
  const [ppSegmentsLoading, setPPSegmentsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/business-unit?brand=${brand}&range=${range}&yoy=${yoy}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [brand, range, yoy]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrend(null);
    try {
      const res = await fetch(`/api/business-unit-trend?brand=${brand}`);
      if (!res.ok) return;
      const json = await res.json();
      setTrend(json.months ?? []);
    } catch { /* silent */ } finally {
      setTrendLoading(false);
    }
  }, [brand]);

  const loadPPContacts = useCallback(async () => {
    if (brand !== 'pp') return;
    setPPContactsLoading(true);
    try {
      const res = await fetch(`/api/pp-marketing-contacts?range=${range}`);
      if (res.ok) setPPContacts(await res.json());
    } catch { /* silent */ } finally {
      setPPContactsLoading(false);
    }
  }, [brand, range]);

  const loadPPSegments = useCallback(async () => {
    if (brand !== 'pp') return;
    setPPSegmentsLoading(true);
    try {
      const res = await fetch(`/api/pp-contacts-segments?range=${range}`);
      if (res.ok) setPPSegments(await res.json());
    } catch { /* silent */ } finally {
      setPPSegmentsLoading(false);
    }
  }, [brand, range]);

  const loadMonthly = useCallback(async () => {
    if (!showMonthly) return;
    setMonthlyLoading(true);
    setMonthlyError('');
    try {
      const res = await fetch(`/api/etz-monthly-update?month=${monthAnchor}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMonthlyData(await res.json());
    } catch (e) {
      setMonthlyError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setMonthlyLoading(false);
    }
  }, [showMonthly, monthAnchor]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTrend(); }, [loadTrend]);
  useEffect(() => { loadPPContacts(); }, [loadPPContacts]);
  useEffect(() => { loadPPSegments(); }, [loadPPSegments]);
  useEffect(() => { loadMonthly(); }, [loadMonthly]);

  const color = BRAND_COLOR[brand];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 space-y-4">

        {/* Brand tabs + YoY toggle */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {BRANDS.map(b => (
              <button
                key={b.key}
                onClick={() => setBrand(b.key)}
                className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  brand === b.key ? BRAND_ACTIVE[b.key] : BRAND_IDLE[b.key]
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {brand === 'etz' && (
              <button
                onClick={() => setShowMonthly(v => !v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  showMonthly
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'text-indigo-600 border-indigo-300 hover:bg-indigo-50'
                }`}
              >
                {showMonthly ? '✓ Monthly Update' : '📅 Monthly Update'}
              </button>
            )}
            <button
              onClick={() => setYoy(v => !v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                yoy
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {yoy ? '↕ YoY ON' : '↕ YoY'} · year-over-year
            </button>
          </div>
        </div>

        {showMonthly && brand === 'etz' ? (
          <MonthlyUpdateSection
            data={monthlyData}
            loading={monthlyLoading}
            error={monthlyError}
            onPrevMonth={() => setMonthAnchor(k => addMonthsToKey(k, -1))}
            onNextMonth={() => setMonthAnchor(k => addMonthsToKey(k, 1))}
            onThisMonth={() => setMonthAnchor(todayYmdSydney().slice(0, 7))}
          />
        ) : (
          <>
        {/* Date range selector */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit flex-wrap">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                range === r.key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
                style={{ borderColor: color, borderTopColor: 'transparent' }} />
              <p className="text-sm text-gray-500">Loading {BRANDS.find(b => b.key === brand)?.label}…</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        ) : data ? (
          <>
            {/* Period context */}
            <p className="text-xs text-gray-400">
              <span className="font-medium text-gray-600">{data.period.label}</span>
              {' · '}
              <span className="italic">{data.comparison.label}</span>
            </p>

            {/* Primary metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Revenue" value={data.current.revenue} prevValue={data.prev.revenue} fmt="currency" />
              <MetricCard label="Spend"   value={data.current.spend}   prevValue={data.prev.spend}   fmt="currency" />
              <MetricCard label="ROAS"    value={data.current.roas}    prevValue={data.prev.roas}    fmt="roas"    />
              <MetricCard label="Orders"  value={data.current.orders}  prevValue={data.prev.orders}  fmt="number"  />
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Avg Order Value" value={data.current.aov}              prevValue={data.prev.aov}              fmt="currency" />
              <MetricCard label="New Customers"   value={data.current.newCustomers}     prevValue={data.prev.newCustomers}     fmt="number"   />
              <MetricCard label="Returning"       value={data.current.returningCustomers} prevValue={data.prev.returningCustomers} fmt="number" />
              <MetricCard label="CAC"             value={data.current.cac}              prevValue={data.prev.cac}              fmt="currency" />
            </div>

            {(brand === 'etz' || brand === 'ehc') && data.current.trialsStarted !== null && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label="Trials Started" value={data.current.trialsStarted} prevValue={data.prev.trialsStarted} fmt="number" />
              </div>
            )}

            {/* Sparkline */}
            {data.sparkline.some(d => d.revenue > 0) && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Revenue — last 7 days</p>
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={data.sparkline} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id={`buGrad-${brand}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={color} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickFormatter={d => d.slice(5)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip
                      formatter={(v) => [AUD.format(Number(v ?? 0)), 'Revenue']}
                      contentStyle={{
                        fontSize: 12,
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        boxShadow: '0 1px 4px rgba(0,0,0,.08)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={color}
                      strokeWidth={2}
                      fill={`url(#buGrad-${brand})`}
                      dot={false}
                      activeDot={{ r: 4, fill: color }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Subscription metrics (ETZ / EHC) */}
            {data.subscriptions && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Subscriptions</p>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="text-[11px] text-gray-400 mb-0.5">Active</p>
                    <p className="text-2xl font-bold text-gray-900">{NUM.format(data.subscriptions.active)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400 mb-0.5">On Trial</p>
                    <p className="text-2xl font-bold text-gray-900">{NUM.format(data.subscriptions.trialing)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400 mb-0.5">MRR</p>
                    <p className="text-2xl font-bold text-gray-900">{AUD.format(data.subscriptions.mrr)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Product breakdown */}
            {data.products.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Product Breakdown</p>
                  {data.comparison?.label && (
                    <p className="text-[11px] text-gray-400">{data.comparison.label}</p>
                  )}
                </div>
                <div className="space-y-3">
                  {data.products.map((p, i) => {
                    const isNew = p.prevRevenue === 0 && p.revenue > 0;
                    const changeUp = (p.changePct ?? 0) >= 0;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-[11px] text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-800 truncate">{p.name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-400">{p.orders} orders</span>
                              <span className="text-sm font-semibold text-gray-900">{AUD.format(p.revenue)}</span>
                              {p.changePct !== null ? (
                                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${changeUp ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50'}`}>
                                  {changeUp ? '↑' : '↓'} {Math.abs(p.changePct)}%
                                </span>
                              ) : isNew ? (
                                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded text-blue-600 bg-blue-50">new</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-all"
                              style={{ width: `${p.pct}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-gray-400 w-8 text-right shrink-0">{p.pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty state when no products and no subscriptions */}
            {data.products.length === 0 && !data.subscriptions && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
                No product data available for this period.
              </div>
            )}
          </>
        ) : null}

        {/* ── Marketing contacts ── PP only, always visible ── */}
        {brand === 'pp' && (
          <PPContactsSection
            data={ppContacts}
            loading={ppContactsLoading}
            segments={ppSegments}
            segmentsLoading={ppSegmentsLoading}
          />
        )}

        {/* ── Month-on-month trend ── always visible, loads independently ── */}
        <TrendSection brand={brand} color={color} trend={trend} loading={trendLoading} />
          </>
        )}
      </div>
    </div>
  );
}

function MonthlyUpdateSection({
  data, loading, error, onPrevMonth, onNextMonth, onThisMonth,
}: {
  data: MonthlyUpdateData | null;
  loading: boolean;
  error: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onThisMonth: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 p-3">
        <button onClick={onPrevMonth} className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100">
          ← Prev month
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">{data?.month.label ?? 'Loading…'}</p>
          {data?.month.isPartial && <p className="text-[10px] text-amber-600 mt-0.5">Month in progress — figures will keep changing</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onThisMonth} className="px-3 py-1.5 text-xs font-medium rounded-lg text-indigo-600 hover:bg-indigo-50">
            This month
          </button>
          <button onClick={onNextMonth} className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100">
            Next month →
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading…</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      ) : data ? (
        <>
          <p className="text-xs text-gray-400">
            <span className="font-medium text-gray-600">{data.month.label}</span>
            {' · '}
            <span className="italic">vs {data.comparisonMonth.label}</span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricCard label="Revenue"        value={data.revenue.current} prevValue={data.revenue.prior} fmt="currency" />
            <MetricCard label="Trials Started" value={data.trials.current}  prevValue={data.trials.prior}  fmt="number"   />
            <MetricCard label="Orders"         value={data.orders.current}  prevValue={data.orders.prior}  fmt="number"   />
          </div>

          {/* Trial to paid */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Trial → Paid</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {data.trialToPaid.current?.pct != null ? `${data.trialToPaid.current.pct}%` : '—'}
                </p>
                {data.trialToPaid.current && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {NUM.format(data.trialToPaid.current.converted)} converted to paid,{' '}
                    {NUM.format(data.trials.current)} still trialing or unconverted
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">{data.month.label}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-400">
                  {data.trialToPaid.prior?.pct != null ? `${data.trialToPaid.prior.pct}%` : '—'}
                </p>
                {data.trialToPaid.prior && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {NUM.format(data.trialToPaid.prior.converted)} converted to paid,{' '}
                    {NUM.format(data.trials.prior)} still trialing or unconverted
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">{data.comparisonMonth.label}</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              % = converted ÷ (converted + Trials Started above) — e.g. this month: {data.trialToPaid.current ? NUM.format(data.trialToPaid.current.converted) : '—'} converted ÷ ({data.trialToPaid.current ? NUM.format(data.trialToPaid.current.converted) : '—'} + {NUM.format(data.trials.current)} still trialing) = {data.trialToPaid.current?.pct ?? '—'}%. It&apos;s a live snapshot, not final — the still-trialing count keeps shrinking (and converted keeps rising) as this month&apos;s trials resolve, so this % will keep changing. Last year&apos;s had a full year to settle.
            </p>
          </div>

          {/* Revenue by channel */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Revenue by Channel</p>
            {data.bestChannel && (
              <p className="text-sm text-gray-700 mb-3">
                Best channel: <span className="font-semibold">{data.bestChannel.name}</span>
                {' '}({data.bestChannel.pct}%, {AUD.format(data.bestChannel.revenue)})
              </p>
            )}
            {data.channels.length > 0 ? (
              <div className="space-y-2">
                {data.channels.map(c => (
                  <div key={c.channel} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-32 shrink-0 truncate">{c.channel}</span>
                    <div className="flex-1 relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{c.pct}%</span>
                    <span className="text-xs font-medium text-gray-900 w-20 text-right">{AUD.format(c.revenue)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No channel data for this month.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PPContactsSection({
  data, loading, segments, segmentsLoading,
}: {
  data: PPContactData | null;
  loading: boolean;
  segments: PPSegmentData | null;
  segmentsLoading: boolean;
}) {
  const header = (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Marketing Contacts</p>
        {data?.weekEndingLabel && (
          <p className="text-[11px] text-gray-400 mt-0.5">{data.weekEndingLabel}</p>
        )}
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {header}
        <div className="h-16 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!data || !data.connected) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {header}
        <p className="text-sm text-gray-400">Could not load contact data — check HubSpot connection.</p>
      </div>
    );
  }

  const netPos = data.net >= 0;
  const vsLastWeek = data.joinersThisWeek - data.joinersLastWeek;
  const vsLastWeekPos = vsLastWeek >= 0;
  const unsubsDelta = data.unsubsThisWeek - data.unsubsLastWeek;
  const unsubsImproved = unsubsDelta <= 0; // fewer unsubs than last week is good

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Marketing Contacts</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{data.weekEndingLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">{NUM.format(data.totalActive)}</p>
          <p className="text-[11px] text-gray-400">total active</p>
        </div>
      </div>

      {/* Weekly metrics table */}
      <div className="rounded-lg border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-2/5">Metric</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">This period</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prior period</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            <tr>
              <td className="px-3 py-2.5 text-sm text-gray-700 font-medium">
                Joiners
                <span className="ml-1 text-[10px] text-gray-400 font-normal">new contacts</span>
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{NUM.format(data.joinersThisWeek)}</td>
              <td className="px-3 py-2.5 text-right text-gray-500">{NUM.format(data.joinersLastWeek)}</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`text-xs font-semibold ${vsLastWeekPos ? 'text-emerald-600' : 'text-red-500'}`}>
                  {vsLastWeekPos ? '+' : ''}{NUM.format(vsLastWeek)}
                </span>
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2.5 text-sm text-gray-700 font-medium">
                Unsubscribes
                <span className="ml-1 text-[10px] text-gray-400 font-normal">from PP sends</span>
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{NUM.format(data.unsubsThisWeek)}</td>
              <td className="px-3 py-2.5 text-right text-gray-500">{NUM.format(data.unsubsLastWeek)}</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`text-xs font-semibold ${unsubsImproved ? 'text-emerald-600' : 'text-red-500'}`}>
                  {unsubsDelta > 0 ? '+' : ''}{NUM.format(unsubsDelta)}
                </span>
              </td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-3 py-2.5 text-sm text-gray-700 font-semibold">Net</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`font-bold text-base ${netPos ? 'text-emerald-600' : 'text-red-500'}`}>
                  {netPos ? '+' : ''}{NUM.format(data.net)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-gray-400">—</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`text-lg ${netPos ? '🟢' : '🔴'}`}>{netPos ? '🟢' : '🔴'}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Segment breakdown */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Active contacts by segment</p>
        {segmentsLoading && !segments ? (
          <div className="h-10 flex items-center text-sm text-gray-400">Loading segments…</div>
        ) : segments?.connected && segments.segments.some(s => s.active !== null) ? (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Segment</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Active</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Joiners</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">vs prior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {segments.segments.map(seg => {
                  const delta = seg.joinersThisWeek - seg.joinersLastWeek;
                  const deltaPos = delta >= 0;
                  return (
                    <tr key={seg.key}>
                      <td className="px-3 py-2.5 text-sm text-gray-700 font-medium">{seg.label}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900 tabular-nums">
                        {seg.active !== null ? NUM.format(seg.active) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900 tabular-nums">
                        {NUM.format(seg.joinersThisWeek)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                        <span className={`font-semibold ${deltaPos ? 'text-emerald-600' : 'text-red-500'}`}>
                          {deltaPos ? '+' : ''}{NUM.format(delta)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            {segments && !segments.connected
              ? 'Could not load segments — check HubSpot connection.'
              : 'Could not load HubSpot segment lists.'}
          </p>
        )}
      </div>

      <p className="text-[10px] text-gray-400 mt-3">
        Top-line Joiners = new HubSpot contact records in the selected period (not opt-in date, which HubSpot doesn&apos;t expose). Unsubscribes = real unsubscribe counts from PP emails sent in the period. Segment Active/Joiners come from each segment&apos;s HubSpot list (K–2/3–6/7–10/11–12/Teacher = &quot;PP - Years... Purchase&quot; / &quot;PP - All Teachers&quot; lists, Parent = a differently-scoped list that includes non-marketable and purchase-only contacts). Segment Joiners are real per-contact join dates from HubSpot, but there&apos;s no equivalent per-segment unsubscribe feed, so that column isn&apos;t shown here.
      </p>
    </div>
  );
}

function TrendSection({
  brand, color, trend, loading,
}: {
  brand: BrandKey;
  color: string;
  trend: TrendPoint[] | null;
  loading: boolean;
}) {
  const hasTrials = brand === 'etz' || brand === 'ehc';

  // Compute MoM direction for the last 3 months vs previous 3
  const summary = (() => {
    if (!trend || trend.length < 6) return null;
    const recent = trend.slice(-3);
    const prior  = trend.slice(-6, -3);
    const sumOrders   = (pts: TrendPoint[]) => pts.reduce((s, p) => s + p.orders, 0);
    const sumTrials   = (pts: TrendPoint[]) => pts.reduce((s, p) => s + (p.trials ?? 0), 0);
    const sumRevenue  = (pts: TrendPoint[]) => pts.reduce((s, p) => s + p.revenue, 0);
    const sumNewCusts = (pts: TrendPoint[]) => pts.reduce((s, p) => s + p.newCustomers, 0);
    const recentTrials = sumTrials(recent);
    const priorTrials  = sumTrials(prior);
    const recentNewCusts = sumNewCusts(recent);
    const priorNewCusts  = sumNewCusts(prior);
    const ordersPct  = sumOrders(prior)  > 0 ? Math.round(((sumOrders(recent)  - sumOrders(prior))  / sumOrders(prior))  * 100) : null;
    const trialsPct  = priorTrials > 0       ? Math.round(((recentTrials - priorTrials) / priorTrials) * 100)                      : null;
    const revenuePct = sumRevenue(prior) > 0 ? Math.round(((sumRevenue(recent) - sumRevenue(prior)) / sumRevenue(prior)) * 100)    : null;
    const newCustsPct = priorNewCusts > 0    ? Math.round(((recentNewCusts - priorNewCusts) / priorNewCusts) * 100)                : null;
    return { ordersPct, trialsPct, revenuePct, recentTrials, priorTrials, newCustsPct, recentNewCusts, priorNewCusts };
  })();

  const arrow = (pct: number | null | undefined) => {
    if (pct == null) return null;
    const up   = pct >= 0;
    const icon = up ? '↑' : '↓';
    const cls  = up ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50';
    return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cls}`}>{icon} {Math.abs(pct)}%</span>;
  };

  const chartData = (trend ?? []).map(pt => ({
    ...pt,
    label: pt.month.slice(5), // "MM" label
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Month-on-month trend · last 12 months</p>
          {summary && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-gray-500">vs 3 months prior:</span>
              <span className="text-xs text-gray-500">Revenue {arrow(summary.revenuePct)}</span>
              <span className="text-xs text-gray-500">Orders {arrow(summary.ordersPct)}</span>
              <span className="text-xs text-gray-500">
                {'New customers '}
                {summary.newCustsPct != null
                  ? arrow(summary.newCustsPct)
                  : summary.recentNewCusts > 0
                    ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded text-blue-600 bg-blue-50">+{summary.recentNewCusts}</span>
                    : <span className="text-xs text-gray-400">no data</span>
                }
              </span>
              {hasTrials && (
                <span className="text-xs text-gray-500">
                  {'Trials '}
                  {summary.trialsPct != null
                    ? arrow(summary.trialsPct)
                    : summary.recentTrials > 0
                      ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded text-blue-600 bg-blue-50">+{summary.recentTrials} new</span>
                      : <span className="text-xs text-gray-400">no prior data</span>
                  }
                </span>
              )}
            </div>
          )}
        </div>
        {loading && (
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin shrink-0"
            style={{ borderColor: color, borderTopColor: 'transparent' }} />
        )}
      </div>

      {loading && !trend ? (
        <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : trend && trend.length > 0 ? (
        <>
          {/* Trials per month (ETZ/EHC only) */}
          {hasTrials && (
            <>
              <p className="text-[10px] text-gray-400 font-medium mb-1">Trials started per month</p>
              <ResponsiveContainer width="100%" height={120}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    formatter={(v) => [NUM.format(Number(v ?? 0)), 'Trials']}
                    contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
                  />
                  <Bar dataKey="trials" name="Trials" fill="#f59e0b" opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={32} />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          )}

          {/* New vs returning customers per month */}
          <p className="text-[10px] text-gray-400 font-medium mt-4 mb-1">Customers by type</p>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                formatter={(v, name) => [NUM.format(Number(v ?? 0)), name]}
                contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
              />
              <Bar dataKey="newCustomers"       name="New"        stackId="custs" fill={color}    opacity={0.9}  radius={[0, 0, 0, 0]} maxBarSize={32} />
              <Bar dataKey="returningCustomers" name="Returning"  stackId="custs" fill={color}    opacity={0.35} radius={[2, 2, 0, 0]} maxBarSize={32} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: color, opacity: 0.9 }} />New</span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: color, opacity: 0.35 }} />Returning</span>
          </div>

          {/* Revenue by customer type per month */}
          <p className="text-[10px] text-gray-400 font-medium mt-4 mb-1">Revenue by customer type</p>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40}
                tickFormatter={v => v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`} />
              <Tooltip
                formatter={(v, name) => [AUD.format(Number(v ?? 0)), name]}
                contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
              />
              <Bar dataKey="newRevenue"       name="New revenue"       stackId="rev" fill={color} opacity={0.9}  radius={[0, 0, 0, 0]} maxBarSize={32} />
              <Bar dataKey="returningRevenue" name="Returning revenue" stackId="rev" fill={color} opacity={0.35} radius={[2, 2, 0, 0]} maxBarSize={32} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: color, opacity: 0.9 }} />New</span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: color, opacity: 0.35 }} />Returning</span>
          </div>
        </>
      ) : !loading ? (
        <p className="text-sm text-gray-400 text-center py-8">No trend data available.</p>
      ) : null}
    </div>
  );
}
