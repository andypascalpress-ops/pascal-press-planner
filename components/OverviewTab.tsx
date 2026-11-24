'use client';

import { useState, useEffect, useCallback } from 'react';
import SalesTrendCard from './SalesTrendCard';
import { BLAKE_MONTHLY_MARKETING_BUDGET, MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';

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
  spend:               number;   // Google Ads only
  metaSpend?:          number;   // Meta / Facebook Ads
  metaError?:          string | null;   // set when the Meta ad account could not be read
  chatgptSpend?:       number;   // ChatGPT Ads (manual)
  bingSpend?:          number;   // Bing Ads (Microsoft Advertising), Pascal Press only
  bingRevenue?:        number;   // revenue Google Analytics credits to Bing traffic (includes organic Bing)
  bingError?:          string | null;
  totalSpend?:         number;   // sum of all tracked channels
  budget:              number;
  revenue:             number;
  revenueTarget?:      number;
  totalMarketingBudget?: number;
  aov?:                number | null;
  aovPrev?:            number | null;
  roas:                number;
  orders:              number;
  revConnected:        boolean;
  adsConnected:        boolean;
  adsError?:           string | null;
  conversion?:         ConversionSnapshot | null;
  trials?:             TrialsBlock | null;   // Excel Test Zone free trials
}

interface TrialsBlock {
  started: number; prevStarted: number | null; startedChangePct: number | null;
  families: number | null; prevFamilies: number | null; familiesChangePct: number | null;
  prevRange: { start: string; end: string };
  window?: { start: string; end: string };   // the complete days the figures cover
}

interface OverviewData {
  startDate?:   string;
  endDate?:     string;
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


// ─── Sub-components ───────────────────────────────────────────────────────────

/** Short money for pace lines: $53.3k, $8,422 below $10k. */
const fmtK = (n: number) => (Math.abs(n) >= 10_000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k` : AUD.format(n));

const BRAND_COLOR: Record<string, string> = {
  'Pascal Press': '#2563eb', 'Excel Test Zone': '#059669', 'Excel HSC Copilot': '#0d9488', 'Excel Study Guides': '#0891b2', 'Blake Education': '#7c3aed',
};

/** A progress bar with an optional tick for where an even pace through the month would be. */
function PaceBar({ share, color, marker }: { share: number; color: string; marker?: number | null }) {
  return (
    <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(share, 1)) * 100}%` }} />
      {marker != null && marker > 0 && marker < 1 && (
        <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-gray-500/70" style={{ left: `${marker * 100}%` }} title="Even pace through the month" />
      )}
    </div>
  );
}

/**
 * Sales target in plain words: how much is left (or by how much it was beaten) and where the month is heading.
 * Never shows "105% of target": above the target it says by how much.
 */
function TargetStatus({ revenue, target, dayPct, isMonthly, compact = false }: { revenue: number; target: number; dayPct: number; isMonthly: boolean; compact?: boolean }) {
  const reached = revenue >= target;
  const projected = isMonthly && dayPct > 0.02 && dayPct < 1 ? revenue / dayPct : null;
  const onPace = projected != null ? projected >= target : null;
  const bar = reached ? 'bg-emerald-500' : onPace === false ? (revenue / target < dayPct * 0.85 ? 'bg-red-400' : 'bg-amber-400') : 'bg-blue-500';
  return (
    <div className="space-y-1.5">
      {!compact && <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sales target {isMonthly ? 'this month' : 'for this period'}</p>}
      <div className="flex items-baseline justify-between gap-2 text-sm">
        {reached
          ? <span className="font-semibold text-emerald-700">✓ Target met · {AUD.format(revenue - target)} above</span>
          : <span className="font-semibold text-gray-800">{AUD.format(target - revenue)} to go</span>}
        <span className="text-xs text-gray-400 shrink-0">target {AUD.format(target)}</span>
      </div>
      <PaceBar share={revenue / target} color={bar} marker={isMonthly && !reached ? dayPct : null} />
      {projected != null && !reached && (
        <p className={`text-xs ${onPace ? 'text-emerald-700' : 'text-red-600'}`}>
          {onPace ? '↗' : '↘'} On pace for {fmtK(projected)} · {onPace ? `about ${fmtK(projected - target)} over target` : `${fmtK(target - projected)} short`}
        </p>
      )}
      {reached && projected != null && <p className="text-xs text-gray-500">On pace for {fmtK(projected)} by month end</p>}
    </div>
  );
}

/** Ad budget in plain words: money left (or over), and where spend is heading by month end. */
function BudgetPace({ spend, budget, dayPct, isMonthly, label = 'Ad budget this month', note }: { spend: number; budget: number; dayPct: number; isMonthly: boolean; label?: string; note?: string }) {
  if (!budget || budget <= 0) return null;
  const over = spend > budget;
  const projected = isMonthly && dayPct > 0.05 && dayPct < 1 && spend > 0 ? spend / dayPct : null;
  const pace = projected == null ? null : projected > budget * 1.02 ? 'over' : projected < budget * 0.85 ? 'under' : 'on';
  const bar = over || pace === 'over' ? 'bg-red-400' : pace === 'under' ? 'bg-amber-400' : 'bg-blue-500';
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        {note
          ? <span className="text-gray-500">{note}</span>
          : over
            ? <span className="font-semibold text-red-600">{AUD.format(spend - budget)} over budget</span>
            : <span className="font-semibold text-gray-800">{AUD.format(budget - spend)} left</span>}
        <span className="text-xs text-gray-400 shrink-0">{AUD.format(spend)} of {AUD.format(budget)}</span>
      </div>
      <PaceBar share={spend / budget} color={bar} marker={isMonthly ? dayPct : null} />
      {projected != null && !note && (
        <p className={`text-xs ${pace === 'over' ? 'text-red-600' : pace === 'under' ? 'text-amber-700' : 'text-emerald-700'}`}>
          On pace to spend {fmtK(projected)} · {pace === 'over' ? `${fmtK(projected - budget)} over budget` : pace === 'under' ? `${fmtK(budget - projected)} under budget` : 'about on budget'}
        </p>
      )}
      {!isMonthly && <p className="text-xs text-gray-400">Monthly budget shown; this range is not a full month.</p>}
    </div>
  );
}

/** Ad spend split by channel as one stacked bar with a legend. */
function SpendSplit({ data }: { data: BrandData }) {
  const total = data.totalSpend ?? data.spend;
  const parts = [
    { name: 'Google', value: data.spend, color: '#2563eb' },
    { name: 'Meta', value: data.metaSpend ?? 0, color: '#8b5cf6' },
    { name: 'Bing', value: data.bingSpend ?? 0, color: '#0ea5e9' },
    { name: 'ChatGPT', value: data.chatgptSpend ?? 0, color: '#64748b' },
  ].filter(p => p.value > 0);
  if (total <= 0) return <p className="text-xs text-gray-400">No ad spend in this period.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Ad spend</p>
        <span className="text-sm font-semibold text-gray-800">{AUD.format(total)}</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
        {parts.map(p => <div key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name} ${AUD.format(p.value)}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
        {parts.map(p => (
          <span key={p.name} className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />{p.name} <span className="tabular-nums text-gray-900">{AUD.format(p.value)}</span></span>
        ))}
      </div>
      {(data.bingRevenue ?? 0) > 0 && <p className="text-[11px] text-gray-400">Bing revenue (Google Analytics, incl. organic Bing): {AUD.format(data.bingRevenue!)}</p>}
    </div>
  );
}

/** Top-of-page summary tile. */
function SummaryTile({ label, value, valueClass = 'text-gray-900', sub, children }: { label: string; value: string; valueClass?: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      <span className={`text-[26px] leading-tight font-bold tabular-nums ${valueClass}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
      {children && <div className="mt-2">{children}</div>}
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

// ─── Pascal Press — Abandoned Cart Rate (GA4) ────────────────────────────────

interface CartPeriod {
  addToCarts:  number;
  checkouts:   number;
  purchases:   number;
  abandonRate: number;
  method:      'addToCarts' | 'checkouts' | 'none';
  startDate:   string;
  endDate:     string;
}

interface CartAbandonmentData {
  connected:   boolean;
  days:        number;
  current:     CartPeriod | null;
  previous:    CartPeriod | null;
  deltaRatePp: number | null;
}

function PPAbandonedCartCard() {
  const [data, setData] = useState<CartAbandonmentData | null>(null);

  useEffect(() => {
    fetch('/api/cart-abandonment?days=30')
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
  if (!data.connected || !data.current || data.current.method === 'none') return null;

  const method     = data.current.method;
  const rate       = data.current.abandonRate;
  const prevRate   = data.previous?.abandonRate ?? null;
  const delta      = data.deltaRatePp ?? 0;
  const direction  = delta < -1 ? 'down' : delta > 1 ? 'up' : 'flat';
  const deltaColor = direction === 'down' ? 'bg-emerald-100 text-emerald-700'
                   : direction === 'up'   ? 'bg-red-100 text-red-700'
                   : 'bg-gray-100 text-gray-600';
  const deltaArrow = direction === 'down' ? '↓' : direction === 'up' ? '↑' : '→';
  const deltaLabel = direction === 'down' ? 'lower' : direction === 'up' ? 'higher' : 'unchanged';

  const benchmark =
    rate < 60 ? { label: 'Well below average — great',      color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' } :
    rate < 65 ? { label: 'Below average — good',             color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' } :
    rate < 75 ? { label: 'Industry average',                 color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200'   } :
    rate < 82 ? { label: 'Above average — room to improve',  color: 'text-orange-600',  bg: 'bg-orange-50 border-orange-200' } :
              { label: 'High — action needed',               color: 'text-red-600',     bg: 'bg-red-50 border-red-200'       };

  const markerPct     = Math.min(rate, 100);
  const purchaseRate  = data.current.checkouts > 0
    ? Math.round(data.current.purchases / data.current.checkouts * 100) : 0;

  // Sub-label under the big number depends on which denominator was used
  const metricLabel = method === 'checkouts'
    ? `${data.current.checkouts.toLocaleString()} checkouts · ${data.current.purchases.toLocaleString()} purchases`
    : `${data.current.addToCarts.toLocaleString()} add-to-carts · ${data.current.purchases.toLocaleString()} purchases`;

  const prevMetricLabel = method === 'checkouts'
    ? `${data.previous?.checkouts.toLocaleString()} checkouts`
    : `${data.previous?.addToCarts.toLocaleString()} add-to-carts`;

  const calcExplanation = method === 'checkouts'
    ? '(Checkouts − purchases) ÷ checkouts × 100, sourced from GA4. Used because GA4\'s add_to_cart event isn\'t firing on pascalpress.com.au — this measures people who started checkout but didn\'t complete payment. The Baymard ~70% benchmark covers the full funnel, so a direct comparison slightly understates true abandonment, but this is still a reliable trend metric.'
    : '(Add-to-cart events − purchases) ÷ add-to-cart events × 100, sourced from GA4. Captures everyone who added to cart and didn\'t buy. Same methodology as Baymard\'s ~70% industry benchmark.';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Pascal Press</span>
          <span className="text-sm font-semibold text-gray-700">
            {method === 'checkouts' ? 'Checkout Abandonment Rate' : 'Cart Abandonment Rate'}
          </span>
          {method === 'checkouts' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">checkout-only · add_to_cart not tracked</span>
          )}
        </div>
        <span className="text-xs text-gray-400">Last {data.days} days vs prior {data.days} days · GA4</span>
      </div>

      {/* Rate + delta */}
      <div className="flex items-end gap-8">
        <div>
          <p className="text-3xl font-bold text-gray-900">{rate.toFixed(1)}%</p>
          <p className="text-xs text-gray-400 mt-0.5">{metricLabel}</p>
        </div>
        {prevRate !== null && (
          <div className="flex flex-col gap-1 pb-0.5">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${deltaColor}`}>
              {deltaArrow} {Math.abs(delta).toFixed(1)}pp {deltaLabel} than prior period
            </span>
            <span className="text-xs text-gray-400">
              Prior: {prevRate.toFixed(1)}% · {prevMetricLabel}
            </span>
          </div>
        )}
      </div>

      {/* Checkout funnel (always available since checkouts > 0) */}
      {data.current.checkouts > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-lg p-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-400 mb-1.5" />
            <p className="text-sm font-bold text-gray-900">{data.current.checkouts.toLocaleString()}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Reached checkout</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 mb-1.5" />
            <p className="text-sm font-bold text-gray-900">{data.current.purchases.toLocaleString()}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Completed purchase</p>
            <p className="text-[10px] font-semibold text-gray-400">{purchaseRate}% of checkouts</p>
          </div>
        </div>
      )}

      {/* Industry benchmark bar */}
      <div>
        <div className="relative h-3 rounded-full overflow-hidden mb-1.5"
          style={{ background: 'linear-gradient(to right, #10b981 0%, #10b981 60%, #f59e0b 60%, #f59e0b 75%, #f97316 75%, #f97316 82%, #ef4444 82%, #ef4444 100%)' }}>
          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900" style={{ left: `${markerPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mb-1.5">
          <span>0%</span><span>65%</span><span>75%</span><span>100%</span>
        </div>
        <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${benchmark.bg}`}>
          <span className={`text-xs font-semibold ${benchmark.color}`}>{benchmark.label}</span>
          <span className="text-[11px] text-gray-500">Industry avg ~70% (Baymard Institute)</span>
        </div>
      </div>

      {/* How it's calculated */}
      <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed">
        <span className="font-semibold text-gray-600">How it's calculated: </span>
        {calcExplanation}
      </div>
    </div>
  );
}

interface HubSpotSubscriberData {
  connected: boolean;
  total:     number;
  pp:        number;
  etz:       number;
  hsc:       number;
  blake:     number;
}

function BrandCard({ name, data, dayPct, isMonthly, onNavigate, subscribers, linkLabel = 'View Finance →', budgetOverride }: {
  name: string;
  data: BrandData;
  dayPct: number;
  isMonthly: boolean;
  onNavigate: () => void;
  subscribers?: number | null;
  linkLabel?: string;
  budgetOverride?: { budget: number; note: string };
}) {
  const totalSpend = data.totalSpend ?? data.spend;
  const after = data.revenue - totalSpend;
  const budget = data.totalMarketingBudget && data.totalMarketingBudget > 0 ? data.totalMarketingBudget : data.budget;
  const color = BRAND_COLOR[name] ?? '#2563eb';
  const aovDelta = data.aov != null && data.aovPrev != null && data.aovPrev > 0 ? (data.aov - data.aovPrev) / data.aovPrev : null;
  const fmtWin = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
      <div className="h-1" style={{ background: color }} />
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />{name}</span>
        <button onClick={onNavigate} className="text-xs font-medium text-blue-600 hover:underline">{linkLabel}</button>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-4 px-5 pt-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.revConnected ? AUD.format(data.revenue) : <span className="text-sm font-medium text-gray-400">Not connected</span>}</p>
          <p className="text-xs text-gray-500">
            {data.orders > 0 ? `${data.orders.toLocaleString()} orders` : ''}{data.aov != null ? ` · ${AUD.format(data.aov)} AOV` : ''}
          </p>
          {aovDelta != null && (
            <p className={`text-xs mt-0.5 ${aovDelta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>AOV {aovDelta >= 0 ? '↑' : '↓'} {Math.abs(Math.round(aovDelta * 100))}% vs last month ({AUD.format(data.aovPrev!)})</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">After ad spend</p>
          <p className={`text-2xl font-bold tabular-nums ${totalSpend > 0 ? (after >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-300'}`}>{totalSpend > 0 ? AUD.format(after) : '—'}</p>
          <p className="text-xs text-gray-500">{totalSpend > 0 ? `${AUD.format(totalSpend)} ad spend${data.revenue > 0 ? ` · ${(data.revenue / totalSpend).toFixed(1)}x return` : ''}` : 'No ad spend tracked'}</p>
        </div>
      </div>

      <div className="px-5 pt-4 pb-4 flex flex-col gap-4 flex-1">
        {data.revConnected && data.revenueTarget != null && data.revenueTarget > 0 && (
          <TargetStatus revenue={data.revenue} target={data.revenueTarget} dayPct={dayPct} isMonthly={isMonthly} />
        )}

        {(data.adsConnected || totalSpend > 0) && <SpendSplit data={data} />}

        {budgetOverride
          ? <BudgetPace spend={totalSpend} budget={budgetOverride.budget} dayPct={dayPct} isMonthly={isMonthly} note={budgetOverride.note} />
          : (data.adsConnected && budget > 0) && <BudgetPace spend={totalSpend} budget={budget} dayPct={dayPct} isMonthly={isMonthly} />}

        {/* Free trials (Excel Test Zone) */}
        {data.trials && (
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">Free trials vs same dates last year</p>
            {data.trials.window && <p className="text-[11px] text-emerald-700/80">{data.trials.window.start === data.trials.window.end ? `${fmtWin(data.trials.window.start)} (complete day)` : `${fmtWin(data.trials.window.start)} – ${fmtWin(data.trials.window.end)} (complete days)`}</p>}
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              {([
                { label: 'Trials started', v: data.trials.started, p: data.trials.prevStarted, d: data.trials.startedChangePct, note: 'one per pack' },
                { label: 'Families trialling', v: data.trials.families, p: data.trials.prevFamilies, d: data.trials.familiesChangePct, note: 'parent accounts' },
              ]).map(t => (
                <div key={t.label}>
                  <p className="text-xs text-gray-600">{t.label}</p>
                  <p className="flex items-baseline gap-1.5"><span className="text-lg font-bold text-gray-900 tabular-nums">{t.v != null ? t.v.toLocaleString() : '–'}</span>
                    {t.d != null && <span className={`text-xs font-semibold ${t.d >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{t.d >= 0 ? '↑' : '↓'} {Math.abs(t.d)}%</span>}</p>
                  <p className="text-[11px] text-gray-500">{t.p != null ? `Last year ${t.p.toLocaleString()}` : t.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Small facts: site conversion and new subscribers */}
        {(data.conversion?.rate != null || subscribers != null) && (
          <div className="mt-auto pt-3 border-t border-gray-100 space-y-2">
            {data.conversion?.rate != null && (
              <div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-gray-500">Site conversion (GA4)</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-gray-900 tabular-nums">{data.conversion.rate.toFixed(2)}%</span>
                    {data.conversion.deltaPp != null && data.conversion.direction && (
                      <span className={data.conversion.direction === 'up' ? 'text-emerald-700' : data.conversion.direction === 'down' ? 'text-red-600' : 'text-gray-500'}>
                        {data.conversion.direction === 'up' ? '↑' : data.conversion.direction === 'down' ? '↓' : '→'} {data.conversion.deltaPp > 0 ? '+' : ''}{data.conversion.deltaPp.toFixed(2)}pp
                      </span>
                    )}
                  </span>
                </div>
                {data.conversion.reason && <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{data.conversion.reason}</p>}
              </div>
            )}
            {subscribers != null && (
              <div className="flex items-baseline justify-between text-xs"><span className="text-gray-500">New HubSpot subscribers</span><span className="font-semibold text-emerald-700 tabular-nums">+{subscribers.toLocaleString()}</span></div>
            )}
          </div>
        )}

        {data.metaError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700">Meta ads not connected</p>
            <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">{data.metaError}</p>
          </div>
        )}
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
      </div>
    </div>
  );
}


// ─── Main component ───────────────────────────────────────────────────────────

interface OverviewTabProps {
  onNavigate: (view: 'finance' | 'email' | 'business-units') => void;
}

export default function OverviewTab({ onNavigate }: OverviewTabProps) {
  const [data,        setData]        = useState<OverviewData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [hsData, setHsData] = useState<HubSpotSubscriberData | null>(null);

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
  // Excel Study Guides is loaded separately (it needs the planner login and is never cached)
  const [esg, setEsg] = useState<BrandData | null>(null);
  const [esgState, setEsgState] = useState<'loading' | 'ok' | 'error' | 'hidden'>('loading');
  const [esgNote, setEsgNote] = useState('');

  const loadEsg = useCallback((start?: string, end?: string) => {
    if (!start || !end) { setEsgState('hidden'); return; }
    setEsgState('loading'); setEsgNote('');
    fetch(`/api/overview-esg?start=${start}&end=${end}`)
      .then(async r => {
        if (r.status === 401) { setEsg(null); setEsgState('hidden'); return; }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.esg) { setEsg(null); setEsgNote(j.error ?? `HTTP ${r.status}`); setEsgState('error'); return; }
        setEsg(j.esg as BrandData); setEsgState('ok');
      })
      .catch(e => { setEsg(null); setEsgNote(e instanceof Error ? e.message : 'failed'); setEsgState('error'); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/overview?range=${dateRange}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const overview = await res.json();
      setData(overview);
      loadEsg(overview.startDate, overview.endDate);

      // Fetch HubSpot subscriber data for the same month (fire-and-forget, non-blocking)
      const subMonth = overview?.month ?? new Date().toISOString().slice(0, 7);
      fetch(`/api/hubspot-subscribers?month=${subMonth}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: HubSpotSubscriberData | null) => { if (d?.connected) setHsData(d); })  // eslint-disable-line @typescript-eslint/no-explicit-any
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [dateRange, loadEsg]);

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

  const totalBudget = [pp, etz, hsc].reduce((s, b) => s + (b.totalMarketingBudget && b.totalMarketingBudget > 0 ? b.totalMarketingBudget : b.budget), 0) + (blake?.adsConnected ? blake.budget : 0);
  const afterAds = combined.revenue - combined.spend;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 space-y-6">

        {/* ── Header: period, range picker, refresh ── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Executive overview</p>
            <h2 className="text-2xl font-bold text-gray-900">{rangeLabel ?? monthLabel(month)}</h2>
            {isMonthly && currentDay < daysInMonth && (
              <p className="text-sm text-gray-500">Day {currentDay} of {daysInMonth} · {Math.round(dayPct * 100)}% of the month gone</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {RANGE_OPTIONS.map(({ key, label }) => (
                <button key={key} onClick={() => setDateRange(key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${dateRange === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 6.5a4.5 4.5 0 1 1-.9-2.7"/><polyline points="11 2 11 5 8 5"/></svg>
              Refresh
            </button>
          </div>
        </div>

        {/* ── Group summary ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <SummaryTile label="Total revenue" value={AUD.format(combined.revenue)} sub="Pascal Press, Excel Test Zone, Excel HSC Copilot and Blake">
            {combined.revenueTarget != null && combined.revenueTarget > 0 && <TargetStatus revenue={combined.revenue} target={combined.revenueTarget} dayPct={dayPct} isMonthly={isMonthly} compact />}
          </SummaryTile>
          <SummaryTile label="Total ad spend" value={AUD.format(combined.spend)} sub={totalBudget > 0 ? `Budget ${AUD.format(totalBudget)} a month` : undefined}>
            {totalBudget > 0 && isMonthly && (() => {
              const projected = dayPct > 0.05 && dayPct < 1 ? combined.spend / dayPct : null;
              const over = combined.spend > totalBudget;
              return (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-sm">{over ? <span className="font-semibold text-red-600">{AUD.format(combined.spend - totalBudget)} over budget</span> : <span className="font-semibold text-gray-800">{AUD.format(totalBudget - combined.spend)} left</span>}</div>
                  <PaceBar share={combined.spend / totalBudget} color={over || (projected != null && projected > totalBudget * 1.02) ? 'bg-red-400' : 'bg-blue-500'} marker={dayPct} />
                  {projected != null && <p className={`text-xs ${projected > totalBudget * 1.02 ? 'text-red-600' : 'text-emerald-700'}`}>On pace to spend {fmtK(projected)}{projected > totalBudget * 1.02 ? ` · ${fmtK(projected - totalBudget)} over` : ''}</p>}
                </div>
              );
            })()}
          </SummaryTile>
          <SummaryTile label="Revenue after ad spend" value={combined.spend > 0 ? AUD.format(afterAds) : '—'} valueClass={afterAds >= 0 ? 'text-emerald-600' : 'text-red-600'}
            sub={combined.spend > 0 && combined.revenue > 0 ? <>Ads took <b className="text-gray-700">{Math.round((combined.spend / combined.revenue) * 100)}%</b> of revenue · {(combined.revenue / combined.spend).toFixed(1)}x return on ad spend</> : 'Revenue less ad spend'} />
          <SummaryTile label="Email open rate" value={email?.connected && email.totalSends > 0 ? PCT(email.avgOpenRate) : '—'}
            valueClass={email?.avgOpenRate && email.avgOpenRate > 0.20 ? 'text-emerald-600' : email?.avgOpenRate && email.avgOpenRate < 0.15 ? 'text-red-600' : 'text-gray-900'}
            sub={email?.totalSends ? <>{email.totalSends.toLocaleString()} sends · {email.campaignCount} campaigns · click rate {PCT(email.avgClickRate)}<br /><span className="text-gray-400">Benchmark: opens 15–25%, clicks 2–5%</span></> : 'No emails this period'} />
        </div>

        {/* ── Brands ── */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By brand</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
            <BrandCard name="Pascal Press" data={pp} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} subscribers={hsData?.pp ?? null} />
            <BrandCard name="Excel Test Zone" data={etz} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} subscribers={hsData?.etz ?? null} />
            <BrandCard name="Excel HSC Copilot" data={hsc} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} subscribers={hsData?.hsc ?? null} />
            {esgState === 'loading' && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 animate-pulse">
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: BRAND_COLOR['Excel Study Guides'] }} />Excel Study Guides</span>
                <div className="mt-4 h-7 w-32 rounded bg-gray-100" /><div className="mt-2 h-4 w-24 rounded bg-gray-100" /><div className="mt-6 h-2 w-full rounded bg-gray-100" />
              </div>
            )}
            {esgState === 'error' && (
              <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: BRAND_COLOR['Excel Study Guides'] }} />Excel Study Guides</span>
                <p className="mt-3 text-sm font-semibold text-amber-700">Could not load this card</p>
                <p className="mt-1 text-xs text-amber-600 leading-relaxed">{esgNote}</p>
                <button onClick={() => loadEsg(data.startDate, data.endDate)} className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200">Retry</button>
              </div>
            )}
            {esgState === 'ok' && esg && (
              <BrandCard name="Excel Study Guides" data={esg} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('business-units')} linkLabel="View Business Units →" />
            )}
            {blake && (
              <BrandCard name="Blake Education" data={blake} dayPct={dayPct} isMonthly={isMonthly} onNavigate={() => onNavigate('finance')} subscribers={hsData?.blake ?? null}
                budgetOverride={!blake.adsConnected ? { budget: BLAKE_MONTHLY_MARKETING_BUDGET, note: 'Meta not connected yet' } : undefined} />
            )}
          </div>
        </div>

        {blake && <BlakeExtraCard />}

        {/* ── Pascal Press — All-Time Sales Trend ── */}
        <SalesTrendCard />

        {/* ── Pascal Press — Abandoned Cart Rate ── */}
        <PPAbandonedCartCard />

        <p className="text-xs text-gray-400 text-center pb-2">
          Figures refresh every few minutes. On each bar, the small grey tick marks where an even pace through the month would be.
        </p>

      </div>
    </div>
  );
}
