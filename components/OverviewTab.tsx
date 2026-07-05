'use client';

import { useState, useEffect, useCallback } from 'react';
import { OverviewAlert } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandData {
  spend:        number;
  budget:       number;
  revenue:      number;
  roas:         number;
  orders:       number;
  revConnected: boolean;
  adsConnected: boolean;
}

interface OverviewData {
  month:        string;
  daysInMonth:  number;
  currentDay:   number;
  pp:           BrandData;
  etz:          BrandData;
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
  alerts: OverviewAlert[];
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

function alertBg(severity: OverviewAlert['severity']): string {
  if (severity === 'danger')  return 'bg-red-50 border-red-200 text-red-800';
  if (severity === 'warning') return 'bg-amber-50 border-amber-200 text-amber-800';
  return 'bg-blue-50 border-blue-200 text-blue-800';
}

function alertIcon(severity: OverviewAlert['severity']): string {
  if (severity === 'danger')  return '🔴';
  if (severity === 'warning') return '🟡';
  return '🔵';
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y!), parseInt(m!) - 1, 1);
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

// ─── Band 6 Tracker types ────────────────────────────────────────────────────

interface Band6Product { id: number; name: string; sku: string; }
interface Band6Data {
  connected:    boolean;
  error?:       string;
  products:     Band6Product[];
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

function BudgetBar({ spend, budget, dayPct }: { spend: number; budget: number; dayPct: number }) {
  const spendPct = budget > 0 ? Math.min(spend / budget, 1.05) : 0;
  const barColor = budgetBarColor(spend / (budget || 1));

  // Projected end-of-month spend — only meaningful after day 2 (dayPct > ~0.05)
  const projected = dayPct > 0.05 && spend > 0 ? spend / dayPct : null;
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
        <span>{AUD.format(budget)} budget</span>
      </div>
      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        {/* Ghost bar — projected month-end spend */}
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
        {/* Day marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-60"
          style={{ left: `${dayPct * 100}%` }}
          title={`${Math.round(dayPct * 100)}% through month`}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className={budget > 0 && spend / budget > 1.0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
          {budget > 0 ? PCT(spend / budget) : '—'} used
        </span>
        <span className="text-gray-400">{Math.round(dayPct * 100)}% of month elapsed</span>
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

function BrandCard({ name, data, dayPct, onNavigate }: {
  name: string;
  data: BrandData;
  dayPct: number;
  onNavigate: () => void;
}) {
  const tagColor = name === 'Pascal Press' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>{name}</span>
        <button onClick={onNavigate} className="text-xs text-blue-600 hover:underline">
          View Finance →
        </button>
      </div>

      {/* Revenue + ROAS */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Revenue</p>
          <p className="text-lg font-bold text-gray-900">
            {data.revConnected ? AUD.format(data.revenue) : <span className="text-gray-400 text-sm">Not connected</span>}
          </p>
          {data.orders > 0 && <p className="text-xs text-gray-400">{data.orders.toLocaleString()} orders</p>}
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Google Ads ROAS</p>
          <p className={`text-lg font-bold ${roasColor(data.roas)}`}>
            {data.adsConnected && data.roas > 0 ? `${data.roas}x` : <span className="text-gray-400 text-sm">—</span>}
          </p>
          {data.adsConnected && data.spend > 0 && (
            <p className="text-xs text-gray-400">{AUD.format(data.spend)} spend</p>
          )}
        </div>
      </div>

      {/* Budget bar */}
      {data.adsConnected ? (
        <BudgetBar spend={data.spend} budget={data.budget} dayPct={dayPct} />
      ) : (
        <div className="text-xs text-gray-400 italic">Google Ads not connected</div>
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800">60 Days to Band 6</h3>
            <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">Series Tracker</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{data.products.length} products · target by Nov 2026</p>
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

      {/* Product list (collapsible) */}
      {data.products.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
            {data.products.length} products tracked — click to expand
          </summary>
          <ul className="mt-2 space-y-0.5 pl-1">
            {data.products.map(p => (
              <li key={p.id} className="text-xs text-gray-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                {p.name}
                {p.sku && <span className="text-gray-400">({p.sku})</span>}
              </li>
            ))}
          </ul>
        </details>
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
  const [dismissed,  setDismissed]  = useState<Set<string>>(new Set());
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [band6,      setBand6]      = useState<Band6Data | null>(null);
  const [band6Loading, setBand6Loading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const { month, daysInMonth, currentDay, pp, etz, combined, email, alerts } = data;
  const dayPct = currentDay / daysInMonth;
  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Executive Overview</h2>
            <p className="text-sm text-gray-500">{monthLabel(month)} · Day {currentDay} of {daysInMonth}</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 6.5a4.5 4.5 0 1 1-.9-2.7"/>
              <polyline points="11 2 11 5 8 5"/>
            </svg>
            Refresh
          </button>
        </div>

        {/* ── Alerts ── */}
        {visibleAlerts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              onClick={() => setAlertsOpen(o => !o)}
            >
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                  {visibleAlerts.length}
                </span>
                Alerts requiring attention
              </span>
              <svg
                width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                className={`transition-transform ${alertsOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="2,4.5 7,9.5 12,4.5"/>
              </svg>
            </button>
            {alertsOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                {visibleAlerts.map(alert => (
                  <div key={alert.id} className={`flex items-start gap-3 px-4 py-3 border-l-4 ${alertBg(alert.severity)}`}>
                    <span className="text-sm mt-0.5">{alertIcon(alert.severity)}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{alert.brand}</span>
                      <p className="text-sm mt-0.5">{alert.message}</p>
                    </div>
                    <button
                      onClick={() => setDismissed(d => new Set([...d, alert.id]))}
                      className="text-xs opacity-50 hover:opacity-100 shrink-0 mt-0.5"
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Total Revenue"
            value={AUD.format(combined.revenue)}
            sub="PP + ETZ this month"
            valueClass="text-emerald-700"
          />
          <KpiCard
            label="Total Ad Spend"
            value={AUD.format(combined.spend)}
            sub={`of ${AUD.format((pp.budget + etz.budget))} budget`}
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
          <BrandCard name="Pascal Press"    data={pp}  dayPct={dayPct} onNavigate={() => onNavigate('finance')} />
          <BrandCard name="Excel Test Zone" data={etz} dayPct={dayPct} onNavigate={() => onNavigate('finance')} />
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
