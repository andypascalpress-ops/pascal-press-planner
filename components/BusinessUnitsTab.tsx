'use client';
import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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
}

interface BUProduct {
  name: string;
  revenue: number;
  orders: number;
  pct: number;
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

export default function BusinessUnitsTab() {
  const [brand, setBrand] = useState<BrandKey>('pp');
  const [range, setRange] = useState<RangeKey>('last7');
  const [yoy,   setYoy]   = useState(false);
  const [data,  setData]  = useState<BUData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

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

  useEffect(() => { load(); }, [load]);

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
                    <p className="text-[11px] text-gray-400 mb-0.5">Trialing</p>
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
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Product Breakdown</p>
                <div className="space-y-3">
                  {data.products.map((p, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-800 truncate">{p.name}</span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-gray-400">{p.orders} orders</span>
                            <span className="text-sm font-semibold text-gray-900">{AUD.format(p.revenue)}</span>
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
                  ))}
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
      </div>
    </div>
  );
}
