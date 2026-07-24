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
    spend:   number;
    revenue: number;
    roas:    number;
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
interface Band6Data {
  connected:    boolean;
  error?:       string;
  products:     Band6Product[];
  productBreakdown?: Band6ProductRow[];
  revenue:      number;
  orders:       number;
  units:        number;
  target:       number;
  startDate:    string;
  endDate:      string;
  daysRemaining: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueClass = '' }: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold text-gray-900 ${valueClass}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
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

function Band6TrackerCard({ data }: { data: Band6Data }) {
  const pct           = data.target > 0 ? Math.min(data.revenue / data.target, 1) : 0;
  const remaining     = Math.max(0, data.target - data.revenue);
  const dailyNeeded   = data.daysRemaining > 0 ? remaining / data.daysRemaining : null;
  const barColor      = pct >= 1 ? 'bg-emerald-500' : pct >= 0.7 ? 'bg-blue-500' : pct >= 0.4 ? 'bg-amber-500' : 'bg-orange-400';
  const needColor     = !dailyNeeded ? 'text-gray-400' : dailyNeeded < 300 ? 'text-emerald-600' : dailyNeeded < 700 ? 'text-amber-600' : 'text-red-600';
  const rows          = data.productBreakdown ?? [];
  const productCount  = rows.length > 0 ? rows.length : data.products.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
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

      {/* Progress bar */}
      <div className="space-y-1 mb-4">
        <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span className="font-medium text-gray-700">{Math.round(pct * 100)}% to goal</span>
          <span>{data.daysRemaining} days left</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-base font-bold text-gray-900">{data.orders}</p>
          <p className="text-xs text-gray-500">Orders</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-base font-bold text-gray-900">{data.units}</p>
          <p className="text-xs text-gray-500">Units sold</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className={`text-base font-bold ${needColor}`}>
            {dailyNeeded != null ? AUD.format(Math.ceil(dailyNeeded)) : '—'}
          </p>
          <p className="text-xs text-gray-500">Needed/day</p>
        </div>
      </div>

      {/* Product revenue breakdown */}
      {rows.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">By product</p>
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
  const [band6,      setBand6]      = useState<Band6Data | null>(null);
  const [band6Loading, setBand6Loading] = useState(true);

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

  useEffect(() => {
    fetch('/api/band6-tracker')
      .then(r => r.json())
      .then((d: Band6Data) => setBand6(d))
      .catch(() => setBand6(null))
      .finally(() => setBand6Loading(false));
  }, []);

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
            sub="PP + ETZ + HSC + Blake this month"
            valueClass="text-emerald-700"
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
        </div>

        {/* ── Band 6 Tracker ── */}
        {(band6Loading || (band6 && band6.connected)) && (
          band6Loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
              <p className="text-sm text-gray-400">Loading Band 6 tracker…</p>
            </div>
          ) : band6 && band6.connected ? (
            <Band6TrackerCard data={band6} />
          ) : null
        )}

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
