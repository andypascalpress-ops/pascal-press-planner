'use client';

import { useState, useEffect } from 'react';
import { SpendRecord } from '@/lib/types';
import { ANNUAL_BUDGETS, MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';
import { RevenueData } from '@/lib/bigcommerce-revenue';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface RevenueResponse {
  pp: RevenueData;
  etz: RevenueData;
  ppPrev: RevenueData;
  month: string;
}

interface MonthRevHistory {
  month: string;
  pp: RevenueData;
  etz: RevenueData;
}

interface ChartPoint {
  label: string;
  spend: number;
  revenue: number;        // Total store revenue
  googlePaidRev?: number; // Google Ads attributed revenue (paid traffic only)
}

interface CustomerPoint {
  label: string;
  newCusts: number;
  retCusts: number;
}

interface GoogleAdsSpendResponse {
  month: string;
  pp:  { spend: number; connected: boolean };
  etz: { spend: number; connected: boolean };
}

interface GoogleAdsHistoryItem {
  month: string; // YYYY-MM
  pp: number;
  etz: number;
}

interface GA4RevenueResponse {
  month: string;
  pp: {
    paidSearchRevenue:    number;
    organicSearchRevenue: number;
    connected: boolean;
  };
  etz?: {
    paidSearchRevenue:    number;
    organicSearchRevenue: number;
    connected: boolean;
  };
}

interface GA4HistoryItem {
  month: string; // YYYY-MM
  pp: {
    paid:    number;
    organic: number;
  };
  etz?: {
    paid:    number;
    organic: number;
  };
}

interface ChannelRevenueItem {
  channel:      string;
  revenue:      number;
  transactions: number;
  pct:          number;
}

interface ChannelRevenueBrand {
  items:        ChannelRevenueItem[];
  totalRevenue: number;
  connected:    boolean;
}

interface ChannelRevenueResponse {
  month: string;
  pp:    ChannelRevenueBrand;
  etz:   ChannelRevenueBrand;
}

interface WebsiteConversionBrand {
  connected: boolean;
  source: 'ga4';
  current: {
    sessions: number;
    purchases: number;
    conversionRate: number;
    startDate: string;
    endDate: string;
  } | null;
  previous: {
    sessions: number;
    purchases: number;
    conversionRate: number;
    startDate: string;
    endDate: string;
  } | null;
  deltaPp: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  reason: string | null;
}

interface WebsiteConversionResponse {
  month: string;
  pp: WebsiteConversionBrand;
  etz: WebsiteConversionBrand;
}

interface Props {
  records: SpendRecord[];
  syncing: boolean;
  lastSynced?: string;
  onSyncGoogleAds: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
});

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search': '#10b981',
  'Paid Search':    '#2563eb',
  'Email':          '#7c3aed',
  'Direct':         '#6b7280',
  'Referral':       '#f59e0b',
  'Organic Social': '#ec4899',
  'Paid Social':    '#f97316',
  'Other':          '#9ca3af',
};

function buildChartYMs(): string[] {
  const start = new Date(2026, 0, 1); // Jan 2026
  const now   = new Date(); now.setDate(1);
  const result: string[] = [];
  const d = new Date(start);
  while (d <= now) {
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return result;
}
const CHART_YMS = buildChartYMs();
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CHART_LABELS = CHART_YMS.map(ym => MONTH_ABBR[parseInt(ym.split('-')[1]!) - 1] ?? ym);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Current calendar month in Australia/Sydney (YYYY-MM). */
function currentYearMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

const MONTH_STORAGE_KEY = 'pp_finance_selected_month';

/** Prefer last user choice; otherwise current Sydney month (MTD). */
function defaultYearMonth(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem(MONTH_STORAGE_KEY);
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    } catch { /* private mode */ }
  }
  return currentYearMonth();
}

function parseYM(ym: string): { year: number; mon: number } {
  const parts = ym.split('-');
  return { year: parseInt(parts[0] ?? '2026', 10), mon: parseInt(parts[1] ?? '1', 10) };
}

function monthLabel(ym: string): string {
  const { year, mon } = parseYM(ym);
  return (MONTH_NAMES[mon - 1] ?? '') + ' ' + year;
}

function monthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    opts.push({ value: val, label: monthLabel(val) });
  }
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextVal = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
  opts.push({ value: nextVal, label: monthLabel(nextVal) });
  return opts;
}

function spendForBrandMonth(records: SpendRecord[], brand: string, ym: string): SpendRecord[] {
  const { year, mon } = parseYM(ym);
  const monthName = MONTH_NAMES[mon - 1] ?? '';
  const fyYear = mon >= 7 ? year + 1 : year;
  const fy = 'FY' + String(fyYear).slice(-2);
  return records.filter(r => r.brand === brand && r.month === monthName && r.fy === fy);
}

function daysInMonth(ym: string): number {
  const { year, mon } = parseYM(ym);
  return new Date(year, mon, 0).getDate();
}

function elapsedDays(ym: string): number {
  const now = new Date();
  const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (ym === currentYM) return now.getDate();
  const { year, mon } = parseYM(ym);
  const first = new Date(year, mon - 1, 1);
  const nowStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return first < nowStart ? daysInMonth(ym) : 1;
}

// Monthly budget for a record — Google Ads uses the fixed constant; others use Monday.com value
function effectiveBudget(r: SpendRecord): number {
  if (r.channel === 'Google Ads') return MONTHLY_GOOGLE_BUDGETS[r.brand] ?? 0;
  return r.budget ?? 0;
}

// ─── Small UI components ─────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const over = max > 0 && value > max;
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div
        className={'h-1.5 rounded-full transition-all ' + (over ? 'bg-red-500' : color)}
        style={{ width: pct + '%' }}
      />
    </div>
  );
}

function Delta({ current, prev }: { current: number; prev: number }) {
  if (prev === 0) return null;
  const diff = current - prev;
  const pct  = Math.round(Math.abs(diff / prev) * 100);
  const up   = diff >= 0;
  return (
    <span className={'text-xs font-semibold ' + (up ? 'text-green-600' : 'text-red-500')}>
      {up ? '↑' : '↓'} {pct}%
    </span>
  );
}

function PacingBadge({ spend, budget, ym }: { spend: number; budget: number; ym: string }) {
  if (budget <= 0 || spend <= 0) return null;
  const elapsed  = elapsedDays(ym);
  const total    = daysInMonth(ym);
  const timePct  = Math.round((elapsed / total) * 100);
  const spendPct = Math.round((spend / budget) * 100);
  const diff     = spendPct - timePct;
  let label: string;
  let cls: string;
  if (diff > 15) {
    label = diff + 'pp ahead of pace';
    cls   = 'bg-red-50 text-red-600';
  } else if (diff < -15) {
    label = Math.abs(diff) + 'pp behind pace';
    cls   = 'bg-yellow-50 text-yellow-700';
  } else {
    label = 'On pace';
    cls   = 'bg-green-50 text-green-700';
  }
  return (
    <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + cls}>
      Day {elapsed}/{total} &middot; {label}
    </span>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delta?: { current: number; prev: number };
}

function MetricTile({ label, value, sub, color, delta }: MetricTileProps) {
  const colorClass = color ?? 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded-lg p-2.5">
      <div className="text-xs text-gray-500 mb-1 leading-tight">{label}</div>
      <div className={'text-base font-bold leading-tight ' + colorClass}>{value}</div>
      {(sub != null || delta != null) && (
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {sub != null && <span className="text-xs text-gray-400">{sub}</span>}
          {delta != null && delta.prev > 0 && (
            <Delta current={delta.current} prev={delta.prev} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bar + line chart ────────────────────────────────────────────────────────
// Spend = bars (independent scale, always visible)
// Google Paid Revenue = solid line   Total Revenue = dashed line  (left axis)

function SpendRevenueChart({
  data,
  spendColor,
  googlePaidColor = '#2563eb',
  totalRevColor   = '#10b981',
}: {
  data: ChartPoint[];
  spendColor: string;
  googlePaidColor?: string;
  totalRevColor?: string;
}) {
  const W   = 400;
  const H   = 210;
  const PAD = { t: 32, r: 16, b: 28, l: 52 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const n   = data.length;
  if (n < 2) return null;

  const hasGooglePaid = data.some(d => (d.googlePaidRev ?? 0) > 0);
  const hasTotal      = data.some(d => d.revenue > 0);

  // Left axis: max of total revenue (or google paid if no total)
  const maxRev   = Math.max(...data.map(d => Math.max(d.revenue, d.googlePaidRev ?? 0)), 1);
  const maxSpend = Math.max(...data.map(d => d.spend), 1);

  const ry = (v: number) => PAD.t + cH - (Math.max(0, v) / maxRev) * cH;
  const sy = (v: number) => PAD.t + cH - (Math.max(0, v) / maxSpend) * (cH * 0.75);

  const slotW = cW / n;
  const barW  = Math.max(slotW * 0.4, 8);
  const fmt   = (v: number) => v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v);

  const makePath = (vals: number[]) =>
    vals.map((v, i) => {
      const cx = PAD.l + slotW * i + slotW / 2;
      return (i === 0 ? 'M' : 'L') + cx.toFixed(1) + ' ' + ry(v).toFixed(1);
    }).join(' ');

  const totalPath  = makePath(data.map(d => d.revenue));
  const googlePath = makePath(data.map(d => d.googlePaidRev ?? 0));

  const revTicks = [0, 0.5, 1].map(f => ({ v: maxRev * f, y: ry(maxRev * f) }));

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ display: 'block' }}>
      {/* Gridlines + left axis */}
      {revTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y.toFixed(1)} x2={W - PAD.r} y2={t.y.toFixed(1)} stroke="#f3f4f6" strokeWidth="1" />
          <text x={PAD.l - 4} y={(t.y + 4).toFixed(1)} textAnchor="end" fontSize="9" fill="#9ca3af">{fmt(t.v)}</text>
        </g>
      ))}

      {/* Spend bars */}
      {data.map((d, i) => {
        const cx  = PAD.l + slotW * i + slotW / 2;
        const bx  = cx - barW / 2;
        const by  = sy(d.spend);
        const bh  = Math.max((PAD.t + cH) - by, 2);
        // ROAS uses Google paid revenue if available, else total
        const roasBase = hasGooglePaid ? (d.googlePaidRev ?? 0) : d.revenue;
        const roas = d.spend > 0 && roasBase > 0 ? (roasBase / d.spend).toFixed(1) : null;
        return (
          <g key={i}>
            {d.spend > 0 && (
              <>
                <rect x={bx.toFixed(1)} y={by.toFixed(1)} width={barW.toFixed(1)} height={bh.toFixed(1)}
                  fill={spendColor} opacity="0.8" rx="2" />
                <text x={cx.toFixed(1)} y={(by - 4).toFixed(1)} textAnchor="middle" fontSize="8" fill={spendColor} fontWeight="600">
                  {fmt(d.spend)}
                </text>
                {roas && (
                  <text x={cx.toFixed(1)} y={(by - 16).toFixed(1)} textAnchor="middle" fontSize="8" fill="#6b7280">
                    {roas}x
                  </text>
                )}
              </>
            )}
            <text x={cx.toFixed(1)} y={(H - 4).toFixed(1)} textAnchor="middle" fontSize="10" fill="#6b7280">{d.label}</text>
          </g>
        );
      })}

      {/* Total revenue — dashed line */}
      {hasTotal && (
        <>
          <path d={totalPath} fill="none" stroke={totalRevColor} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
          {data.map((d, i) => {
            const cx = PAD.l + slotW * i + slotW / 2;
            return d.revenue > 0 ? <circle key={i} cx={cx.toFixed(1)} cy={ry(d.revenue).toFixed(1)} r="3" fill={totalRevColor} /> : null;
          })}
        </>
      )}

      {/* Google paid revenue — solid line on top */}
      {hasGooglePaid && (
        <>
          <path d={googlePath} fill="none" stroke={googlePaidColor} strokeWidth="2.5" strokeLinejoin="round" />
          {data.map((d, i) => {
            const cx = PAD.l + slotW * i + slotW / 2;
            const v  = d.googlePaidRev ?? 0;
            return v > 0 ? <circle key={i} cx={cx.toFixed(1)} cy={ry(v).toFixed(1)} r="3.5" fill={googlePaidColor} /> : null;
          })}
        </>
      )}
    </svg>
  );
}

// ─── Customer trend chart ────────────────────────────────────────────────────

function CustomerTrendChart({
  data,
  newColor,
  retColor,
}: {
  data: CustomerPoint[];
  newColor: string;
  retColor: string;
}) {
  const W   = 400;
  const H   = 160;
  const PAD = { t: 12, r: 16, b: 28, l: 44 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const n   = data.length;
  if (n < 2) return null;

  const allVals = data.flatMap(d => [d.newCusts, d.retCusts]);
  const maxVal  = Math.max(...allVals, 1);
  const hasData = data.some(d => d.newCusts > 0 || d.retCusts > 0);
  if (!hasData) return (
    <div className="h-40 flex items-center justify-center text-sm text-gray-300 italic">No data yet</div>
  );

  const px = (i: number) => PAD.l + (i / (n - 1)) * cW;
  const py = (v: number) => PAD.t + cH - (Math.max(0, v) / maxVal) * cH;

  const toPath = (vals: number[]) =>
    vals.map((v, i) => (i === 0 ? 'M' : 'L') + ' ' + px(i).toFixed(1) + ' ' + py(v).toFixed(1)).join(' ');

  const newPath = toPath(data.map(d => d.newCusts));
  const retPath = toPath(data.map(d => d.retCusts));

  const ticks = Array.from({ length: 4 }, (_, i) => {
    const v = Math.round((maxVal / 3) * i);
    return { value: v, y: py(v) };
  });

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y.toFixed(1)} x2={W - PAD.r} y2={t.y.toFixed(1)}
            stroke="#f3f4f6" strokeWidth="1" />
          <text x={PAD.l - 4} y={t.y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
            {t.value}
          </text>
        </g>
      ))}
      <path d={retPath} fill="none" stroke={retColor} strokeWidth="2"
        strokeLinejoin="round" strokeDasharray="5 3" />
      <path d={newPath} fill="none" stroke={newColor} strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          {d.newCusts > 0 && (
            <circle cx={px(i).toFixed(1)} cy={py(d.newCusts).toFixed(1)} r="3" fill={newColor} />
          )}
          {d.retCusts > 0 && (
            <circle cx={px(i).toFixed(1)} cy={py(d.retCusts).toFixed(1)} r="3" fill={retColor} />
          )}
          <text x={px(i).toFixed(1)} y={H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Brand panel ─────────────────────────────────────────────────────────────

interface BrandPanelProps {
  brand: string;
  label: string;
  color: string;
  accentBg: string;
  accentText: string;
  records: SpendRecord[];
  selectedMonth: string;
  revenue: RevenueData | null;
  revenueLabel: string;
  prevRevenue: RevenueData | null;
  /** Live Google Ads spend from API — overrides Monday.com actualSpend when present */
  liveGoogleAdsSpend?: number | null;
  liveGoogleAdsConnected?: boolean;
  /** Site-wide conversion (GA4 sessions → purchases) */
  websiteConversion?: WebsiteConversionBrand | null;
  /** GA4 revenue split by channel (Organic Search, Paid Search, Email, Direct, …) */
  channelRevenue?: ChannelRevenueBrand | null;
}

function BrandPanel({
  brand, label, color, accentBg, accentText,
  records, selectedMonth, revenue, revenueLabel, prevRevenue,
  liveGoogleAdsSpend, liveGoogleAdsConnected,
  websiteConversion,
  channelRevenue,
}: BrandPanelProps) {
  const monthRecords = spendForBrandMonth(records, brand, selectedMonth);
  const annualBudget = (ANNUAL_BUDGETS as Record<string, number>)[brand] ?? 0;

  // Budget comes from Monday.com / constants; actual spend comes live from Google Ads API
  const totalBudget = monthRecords.reduce((s, r) => s + effectiveBudget(r), 0);

  // Build per-channel spend from Monday.com, then override Google Ads with live API data
  const byChannel: Record<string, number> = {};
  for (const r of monthRecords) {
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + (r.actualSpend ?? 0);
  }
  if (liveGoogleAdsSpend != null && liveGoogleAdsSpend > 0) {
    byChannel['Google Ads'] = liveGoogleAdsSpend;
  }

  const channelEntries = Object.entries(byChannel)
    .filter(([ch, v]) => v > 0 && ch !== 'Meta Ads')
    .sort(([, a], [, b]) => b - a);

  // Total spend = sum of live-corrected channel entries
  const totalSpend = channelEntries.reduce((s, [, v]) => s + v, 0);

  const googleSpend = byChannel['Google Ads'] ?? 0;

  // Revenue + metrics
  const rev        = revenue?.totalRevenue       ?? 0;
  const prevRev    = prevRevenue?.totalRevenue   ?? 0;
  const orders     = revenue?.totalOrders        ?? 0;
  const newCusts   = revenue?.newCustomers       ?? 0;
  const retCusts   = revenue?.returningCustomers ?? 0;
  const totalCusts = newCusts + retCusts;

  const prevNewCusts = prevRevenue?.newCustomers       ?? 0;
  const prevRetCusts = prevRevenue?.returningCustomers ?? 0;

  // Prefer channel breakdown totals (sessionDefaultChannelGroup) — captures Paid Search +
  // Cross-network + Paid Shopping, which sessionMedium=cpc misses for Shopping/PMax.
  const channelPaidRev    = channelRevenue?.connected
    ? channelRevenue.items.filter(i => i.channel === 'Paid Search').reduce((s, i) => s + i.revenue, 0)
    : null;
  const channelOrganicRev = channelRevenue?.connected
    ? channelRevenue.items.filter(i => i.channel === 'Organic Search').reduce((s, i) => s + i.revenue, 0)
    : null;
  const googlePaidRev    = channelPaidRev    ?? revenue?.googlePaidRevenue    ?? 0;
  const googleOrganicRev = channelOrganicRev ?? revenue?.googleOrganicRevenue ?? 0;

  const aov      = orders > 0 && rev > 0 ? rev / orders : null;
  const cac      = totalSpend > 0 && newCusts > 0 ? totalSpend / newCusts : null;
  const retRate  = totalCusts > 0 ? Math.round((retCusts / totalCusts) * 100) : null;
  const prevRoas = totalSpend > 0 && prevRev > 0 ? prevRev / totalSpend : null;

  // Google Ads ROAS: paid-traffic BC revenue ÷ Google Ads spend (most accurate)
  // Falls back to total revenue ÷ spend when no referral data available (e.g. Stripe)
  const paidRoas = googleSpend > 0 && googlePaidRev > 0
    ? googlePaidRev / googleSpend
    : googleSpend > 0 && rev > 0
      ? rev / googleSpend
      : null;
  const roas = totalSpend > 0 && rev > 0 ? rev / totalSpend : null;

  const isConnected = revenue?.connected === true;
  const source      = revenue?.source ?? 'bigcommerce';

  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className={accentBg + ' px-4 md:px-5 py-3 border-b border-gray-200'}>
        <h2 className={'text-base font-bold ' + accentText}>{label}</h2>
        <div className="text-xs text-gray-500 mt-0.5">Annual budget: {AUD.format(annualBudget)}</div>
      </div>

      <div className="divide-y divide-gray-100">

        {/* ── Ad Spend ── */}
        <div className="px-4 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Ad Spend</div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900">
              {totalSpend > 0 ? AUD.format(totalSpend) : '—'}
            </span>
            {totalBudget > 0 && (
              <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (totalSpend > totalBudget ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700')}>
                {totalSpend > totalBudget
                    ? Math.round((totalSpend / totalBudget - 1) * 100) + '% over budget'
                    : Math.round((totalSpend / totalBudget) * 100) + '% used'}
              </span>
            )}
          </div>
          {totalBudget > 0 && <ProgressBar value={totalSpend} max={totalBudget} color={color} />}
          {totalBudget > 0 && totalSpend > 0 && (
            <div className="mt-2">
              <PacingBadge spend={totalSpend} budget={totalBudget} ym={selectedMonth} />
            </div>
          )}

          {channelEntries.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {channelEntries.map(([ch, amt]) => {
                const chBudget = monthRecords
                  .filter(r => r.channel === ch)
                  .reduce((s, r) => s + effectiveBudget(r), 0);
                const isOver   = chBudget > 0 && amt > chBudget;
                const isLive   = ch === 'Google Ads' && liveGoogleAdsConnected === true;
                return (
                  <div key={ch} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      {ch}
                      {isLive && (
                        <span className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-medium">
                          live
                        </span>
                      )}
                      {isOver && (
                        <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-medium">
                          over budget
                        </span>
                      )}
                    </span>
                    <span className={'font-medium ' + (isOver ? 'text-red-600' : 'text-gray-900')}>
                      {AUD.format(amt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-400 italic">No spend recorded for this month</div>
          )}
        </div>

        {/* ── Google Ads Performance ── */}
        <div className="px-4 py-4">
          <div className="rounded-xl border border-blue-100 overflow-hidden">
            <div className="bg-blue-600 px-4 py-2.5 flex items-center justify-between">
              <span className="text-white font-bold text-sm tracking-wide">Google Ads Performance</span>
              {paidRoas !== null && (
                <span className={
                  'font-bold text-sm px-2.5 py-0.5 rounded-full ' +
                  (paidRoas >= 4 ? 'bg-green-100 text-green-800' : paidRoas >= 2 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800')
                }>
                  {paidRoas.toFixed(1)}x ROAS
                </span>
              )}
            </div>
            <div className="bg-blue-50 px-3 py-3 space-y-3">
              {isConnected ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white rounded-lg py-2 px-1 shadow-sm">
                      <div className="text-xs text-gray-500 mb-1 leading-tight">Ad Spend</div>
                      <div className="text-base font-bold text-gray-900">
                        {totalSpend > 0 ? AUD.format(totalSpend) : '—'}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg py-2 px-1 shadow-sm">
                      <div className="text-xs text-gray-500 mb-1 leading-tight">Paid Traffic Rev</div>
                      <div className="text-base font-bold text-blue-700">
                        {googlePaidRev > 0 ? AUD.format(googlePaidRev) : source === 'stripe' ? 'N/A' : '—'}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg py-2 px-1 shadow-sm">
                      <div className="text-xs text-gray-500 mb-1 leading-tight">Organic Rev</div>
                      <div className="text-base font-bold text-teal-700">
                        {googleOrganicRev > 0 ? AUD.format(googleOrganicRev) : source === 'stripe' ? 'N/A' : '—'}
                      </div>
                    </div>
                  </div>
                  {paidRoas !== null && (
                    <div className="text-center text-xs text-blue-700 bg-blue-100 rounded-lg py-2 px-3">
                      Every <span className="font-bold">$1</span> on Google Ads returned{' '}
                      <span className="font-bold text-blue-900">${paidRoas.toFixed(2)}</span>{' '}
                      {googlePaidRev > 0 ? 'in paid-traffic revenue' : 'in store revenue'}
                    </div>
                  )}
                  {source === 'stripe' && (
                    <div className="text-center text-xs text-gray-400 italic">
                      Paid vs organic breakdown not available via Stripe
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-gray-400 italic py-1">Connect {revenueLabel} to see revenue</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Revenue by Channel ── */}
        {channelRevenue?.connected && channelRevenue.items.length > 0 && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-white font-bold text-sm tracking-wide">Revenue by Channel</span>
                <span className="text-slate-300 text-xs font-medium">{AUD.format(channelRevenue.totalRevenue)} total</span>
              </div>
              <div className="bg-slate-50 px-4 py-3 space-y-3">
                {channelRevenue.items.map(({ channel, revenue: chRev, pct }) => {
                  const chColor = CHANNEL_COLORS[channel] ?? '#9ca3af';
                  return (
                    <div key={channel}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: chColor }} />
                          <span className="text-gray-700">{channel}</span>
                        </span>
                        <span className="flex items-center gap-2.5 tabular-nums">
                          <span className="font-semibold text-gray-900">{AUD.format(chRev)}</span>
                          <span className="text-xs text-slate-400 w-9 text-right">{pct}%</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: pct + '%', background: chColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Total Store Revenue ── */}
        {isConnected && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-green-100 overflow-hidden">
              <div className="bg-emerald-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-white font-bold text-sm tracking-wide">Total Store Revenue</span>
                <span className="text-emerald-100 text-xs font-medium">{revenueLabel}</span>
              </div>
              <div className="bg-emerald-50 px-4 py-3">
                <div className="flex items-baseline gap-3 mb-1.5">
                  <span className="text-3xl font-bold text-emerald-800">{AUD.format(rev)}</span>
                  {prevRev > 0 && (
                    <span className="flex items-center gap-1">
                      <Delta current={rev} prev={prevRev} />
                      <span className="text-xs text-gray-400">vs last month</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-emerald-700">
                  <span>{orders} orders</span>
                  {aov !== null && <span>· Avg {AUD.format(aov)} per order</span>}
                  {roas !== null && (
                    <span>· Overall ROAS <span className="font-semibold">{roas.toFixed(1)}x</span></span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Customers ── */}
        {isConnected && totalCusts > 0 && (
          <div className="px-4 pb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Customers This Month</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                <div className="text-xl font-bold text-blue-700">{newCusts}</div>
                {prevRevenue?.connected === true && prevNewCusts > 0 && (
                  <div className="flex justify-center mt-0.5"><Delta current={newCusts} prev={prevNewCusts} /></div>
                )}
                <div className="text-xs text-blue-500 mt-0.5">New</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                <div className="text-xl font-bold text-purple-700">{retCusts}</div>
                {prevRevenue?.connected === true && prevRetCusts > 0 && (
                  <div className="flex justify-center mt-0.5"><Delta current={retCusts} prev={prevRetCusts} /></div>
                )}
                <div className="text-xs text-purple-500 mt-0.5">Returning</div>
              </div>
              {cac !== null && (
                <div className="bg-orange-50 rounded-lg p-2.5 text-center">
                  <div className="text-base font-bold text-orange-700">{AUD.format(cac)}</div>
                  <div className="text-xs text-orange-500 mt-0.5">Cost/Acq.</div>
                </div>
              )}
              {retRate !== null && (
                <div className={
                  'rounded-lg p-2.5 text-center ' +
                  (retRate >= 40 ? 'bg-green-50' : 'bg-yellow-50')
                }>
                  <div className={'text-base font-bold ' + (retRate >= 40 ? 'text-green-700' : 'text-yellow-700')}>
                    {retRate}%
                  </div>
                  <div className={'text-xs mt-0.5 ' + (retRate >= 40 ? 'text-green-500' : 'text-yellow-500')}>
                    Retention
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Website conversion (site-wide, not Ads) ── */}
        {websiteConversion?.connected && websiteConversion.current && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-indigo-100 overflow-hidden">
              <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-white font-bold text-sm tracking-wide">Website Conversion</span>
                <span className="text-indigo-100 text-xs font-medium">GA4 · site-wide</span>
              </div>
              <div className="bg-indigo-50 px-4 py-3 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-indigo-900">
                      {websiteConversion.current.conversionRate.toFixed(2)}%
                    </span>
                    {websiteConversion.deltaPp != null && websiteConversion.direction && (
                      <span className={
                        'text-xs font-semibold px-2 py-0.5 rounded-full ' +
                        (websiteConversion.direction === 'up'
                          ? 'bg-emerald-100 text-emerald-700'
                          : websiteConversion.direction === 'down'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600')
                      }>
                        {websiteConversion.direction === 'up' ? '↑' : websiteConversion.direction === 'down' ? '↓' : '→'}{' '}
                        {websiteConversion.deltaPp > 0 ? '+' : ''}
                        {websiteConversion.deltaPp.toFixed(2)}pp
                      </span>
                    )}
                  </div>
                  {websiteConversion.previous && (
                    <span className="text-xs text-indigo-500">
                      prev {websiteConversion.previous.conversionRate.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-indigo-800">
                  <span>{websiteConversion.current.purchases.toLocaleString()} purchases</span>
                  <span>· {websiteConversion.current.sessions.toLocaleString()} sessions</span>
                </div>
                {websiteConversion.reason && (
                  <div className="text-xs text-indigo-900/80 bg-white/70 rounded-lg px-3 py-2 leading-snug">
                    {websiteConversion.reason}
                  </div>
                )}
                <div className="text-xs text-indigo-400">
                  vs prior period · not Google Ads conversion rate
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Monthly budget breakdown table ──────────────────────────────────────────

const FY26_YMS = CHART_YMS; // dynamic: Jan 2026 → current month

interface BudgetRow {
  channel: string;
  budget: number;
  spend: number;
}

function BudgetBreakdownTable({ brand, records, accentBg, accentText }: {
  brand: string;
  records: SpendRecord[];
  accentBg: string;
  accentText: string;
}) {
  // Build rows for every FY26 month that has data or a Google budget
  const months: { ym: string; label: string; rows: BudgetRow[]; totalBudget: number; totalSpend: number }[] = [];

  for (const ym of FY26_YMS) {
    const { mon } = parseYM(ym);
    const mLabel  = (MONTH_NAMES[mon - 1] ?? '') + ' ' + parseYM(ym).year;
    const recs    = spendForBrandMonth(records, brand, ym);

    // Aggregate by channel
    const byChannel: Record<string, { spend: number; budget: number }> = {};

    // Always seed Google Ads with the fixed monthly budget
    const gBudget = MONTHLY_GOOGLE_BUDGETS[brand] ?? 0;
    if (gBudget > 0) byChannel['Google Ads'] = { spend: 0, budget: gBudget };

    for (const r of recs) {
      if (!byChannel[r.channel]) byChannel[r.channel] = { spend: 0, budget: effectiveBudget(r) };
      byChannel[r.channel].spend  += r.actualSpend ?? 0;
      // For Google Ads budget is already set to fixed value; for others use the record
      if (r.channel !== 'Google Ads') byChannel[r.channel].budget = Math.max(byChannel[r.channel].budget, effectiveBudget(r));
    }

    const rows: BudgetRow[] = Object.entries(byChannel)
      .filter(([, v]) => v.spend > 0 || v.budget > 0)
      .sort(([a], [b]) => a === 'Google Ads' ? -1 : b === 'Google Ads' ? 1 : a.localeCompare(b))
      .map(([ch, v]) => ({ channel: ch, budget: v.budget, spend: v.spend }));

    if (rows.length === 0) continue;

    const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
    const totalSpend  = rows.reduce((s, r) => s + r.spend,  0);
    months.push({ ym, label: mLabel, rows, totalBudget, totalSpend });
  }

  if (months.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic px-4 py-3">No spend data for FY26</div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-0">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className={accentBg}>
            <th className={'text-left px-4 py-2 font-semibold ' + accentText}>Month / Channel</th>
            <th className={'text-right px-4 py-2 font-semibold ' + accentText}>Budget</th>
            <th className={'text-right px-4 py-2 font-semibold ' + accentText}>Actual</th>
            <th className={'text-right px-4 py-2 font-semibold ' + accentText}>Variance</th>
            <th className={'text-right px-4 py-2 font-semibold ' + accentText}>% Used</th>
          </tr>
        </thead>
        <tbody>
          {months.map(({ label, rows, totalBudget, totalSpend }, mi) => {
            const monthVar    = totalSpend - totalBudget;
            const monthIsOver = totalBudget > 0 && monthVar > 0;
            return (
              <>
                {/* Month summary row */}
                <tr key={label} className={mi % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-4 py-2 font-semibold text-gray-800">{label}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{totalBudget > 0 ? AUD.format(totalBudget) : '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-medium">{totalSpend > 0 ? AUD.format(totalSpend) : '—'}</td>
                  <td className={'px-4 py-2 text-right font-semibold ' + (totalBudget === 0 ? 'text-gray-400' : monthIsOver ? 'text-red-600' : 'text-green-600')}>
                    {totalBudget === 0 ? '—' : (monthVar > 0 ? '+' : '') + AUD.format(monthVar)}
                  </td>
                  <td className={'px-4 py-2 text-right font-medium ' + (totalBudget === 0 ? 'text-gray-400' : monthIsOver ? 'text-red-600' : 'text-green-600')}>
                    {totalBudget > 0
                      ? totalSpend > totalBudget
                        ? Math.round((totalSpend / totalBudget - 1) * 100) + '% over'
                        : Math.round((totalSpend / totalBudget) * 100) + '% used'
                      : '—'}
                  </td>
                </tr>
                {/* Per-channel rows */}
                {rows.map(row => {
                  const variance = row.spend - row.budget;
                  const isOver   = row.budget > 0 && variance > 0;
                  const pct      = row.budget > 0 ? Math.round((row.spend / row.budget) * 100) : null;
                  return (
                    <tr key={label + row.channel} className={mi % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="pl-8 pr-4 py-1.5 text-gray-500 flex items-center gap-1.5">
                        <span className="text-gray-300">└</span>
                        {row.channel}
                        {isOver && (
                          <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-medium">over</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-gray-500">{row.budget > 0 ? AUD.format(row.budget) : '—'}</td>
                      <td className={'px-4 py-1.5 text-right ' + (row.spend > 0 ? 'text-gray-800' : 'text-gray-400')}>{row.spend > 0 ? AUD.format(row.spend) : '—'}</td>
                      <td className={'px-4 py-1.5 text-right text-xs ' + (row.budget === 0 ? 'text-gray-400' : isOver ? 'text-red-600 font-semibold' : 'text-green-600')}>
                        {row.budget === 0 ? '—' : (variance > 0 ? '+' : '') + AUD.format(variance)}
                      </td>
                      <td className={'px-4 py-1.5 text-right text-xs ' + (pct === null ? 'text-gray-400' : isOver ? 'text-red-600' : 'text-green-600')}>
                        {pct !== null
                          ? isOver
                            ? Math.round((row.spend / row.budget - 1) * 100) + '% over'
                            : pct + '% used'
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Campaign breakdown (Ads spend + GA4 revenue) ─────────────────────────────

interface JoinedCampaign {
  name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number;
  avgCpc: number;
  gaRevenue: number;
  gaTransactions: number;
  gaRoas: number;
  gaMatched: boolean;
  adsConvValue: number;
}

interface CampaignBrandBlock {
  campaigns: JoinedCampaign[];
  totals: { spend: number; gaRevenue: number; gaTransactions: number; gaRoas: number; clicks: number };
  adsConnected: boolean;
  gaConnected: boolean;
  error: string | null;
}

interface CampaignsResponse {
  month: string;
  dateRange: { start: string; end: string };
  note?: string;
  pp: CampaignBrandBlock;
  etz: CampaignBrandBlock;
  hsc: CampaignBrandBlock;
}

interface MetaCampaignRow {
  id:          string;
  name:        string;
  spend:       number;
  impressions: number;
  clicks:      number;
  ctr:         number;
  cpm:         number;
  reach:       number;
  frequency:   number;
}

interface MetaCampaignBrandBlock {
  campaigns: MetaCampaignRow[];
  totals:    { spend: number; impressions: number; clicks: number; reach: number };
  connected: boolean;
  error:     string | null;
}

interface MetaCampaignsResponse {
  month:     string;
  dateRange: { start: string; end: string };
  pp:        MetaCampaignBrandBlock;
  etz:       MetaCampaignBrandBlock;
}

interface EtzTrialFunnelResponse {
  month:            string;
  trialsStarted:    number;
  currentlyOnTrial: number;
  error?:           string;
  _meta?:           { pipeline: string; trialStage: string; trialStageId: string };
}

interface EtzAppTrafficResponse {
  month:         string;
  totalSessions: number;
  totalNewUsers: number;
  fromMainSite:  number;   // sessions arriving via exceltestzone.com.au referral
  connected:     boolean;
  source:        'app-property' | 'hostname-filter' | 'none';
}

interface EtzFunnelChannelRow {
  channel:  string;
  sessions: number;
  newUsers: number;
  pct:      number;
}
interface EtzFunnelTrafficResponse {
  month:         string;
  totalSessions: number;
  totalNewUsers: number;
  byChannel:     EtzFunnelChannelRow[];
  connected:     boolean;
}

interface EtzTrendPoint {
  month:       string;
  label:       string;
  sessions:    number;
  trials:      number;
  orders:      number;
  revenue:     number;
  convRate:    number; // orders / trials * 100 (computed in component)
}
interface EtzTrendResponse {
  points:     EtzTrendPoint[];
  monthCount: number;
}

interface EtzSourceRow {
  source:  string;
  trials:  number;
  pct:     number;
}
interface EtzSourceResponse {
  month:   string;
  total:   number;
  rows:    EtzSourceRow[];
  _meta?:  { hasSourceData: boolean; note: string };
  error?:  string;
}

interface ClarityMetricRow {
  dimensionValue:  string;
  sessions:        number;
  activeTime:      number;   // seconds
  pagesPerSession: number;
  deadClickRate:   number;   // 0-100 (count / sessions * 100)
  rageClickRate:   number;   // 0-100 (count / sessions * 100)
  scrollDepth:     number;   // 0-100
}
interface EtzClarityResponse {
  connected:  boolean;
  dateRange:  { numOfDays: number };
  overall:    ClarityMetricRow | null;
  bySource:   ClarityMetricRow[];
  error?:     string;
}

// ─── ETZ 12-month trend chart ─────────────────────────────────────────────────
// Normalised/indexed chart: each metric shown as % of its own peak value.
// This puts sessions, trials and orders on the same 0–100 % scale so all
// three lines are clearly visible regardless of their absolute magnitudes.
// Session bars use the same normalised scale.

function EtzTrendChart({ points: rawPoints }: { points: EtzTrendPoint[] }) {
  if (rawPoints.length < 2) return null;

  // Compute conversion rate for each month
  const points = rawPoints.map(p => ({
    ...p,
    convRate: p.trials > 0 ? (p.orders / p.trials) * 100 : 0,
  }));

  const W   = 800;
  const H   = 460;
  const PAD = { t: 28, r: 24, b: 44, l: 44 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const n   = points.length;

  const maxSess   = Math.max(...points.map(p => p.sessions), 1);
  const maxTrials = Math.max(...points.map(p => p.trials),   1);
  const maxOrders = Math.max(...points.map(p => p.orders),   1);
  const maxConv   = Math.max(...points.map(p => p.convRate), 1);

  const hasOrders = points.some(p => p.orders > 0);
  const hasConv   = hasOrders && maxConv > 0;

  const ny = (norm: number) => PAD.t + cH - Math.max(0, Math.min(1, norm)) * cH;

  const slotW = cW / n;
  const barW  = Math.max(slotW * 0.48, 8);
  const cx    = (i: number) => PAD.l + slotW * i + slotW / 2;

  const makeLine = (norms: number[]) =>
    norms.map((v, i) => (i === 0 ? 'M' : 'L') + cx(i).toFixed(1) + ' ' + ny(v).toFixed(1)).join(' ');

  const trialPath = makeLine(points.map(p => p.trials  / maxTrials));
  const orderPath = hasOrders ? makeLine(points.map(p => p.orders  / maxOrders)) : '';
  const convPath  = hasConv   ? makeLine(points.map(p => p.convRate / maxConv))  : '';

  const fmt = (v: number) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
  const fmtPct = (v: number) => v.toFixed(1) + '%';

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const baseY = ny(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>

      {/* Gridlines + Y-axis labels */}
      {gridLines.map((f, i) => {
        const y = ny(f);
        return (
          <g key={i}>
            <line x1={PAD.l} y1={y.toFixed(1)} x2={W - PAD.r} y2={y.toFixed(1)}
              stroke={f === 0 ? '#d1d5db' : '#f3f4f6'}
              strokeWidth={f === 0 ? 1 : 1}
              strokeDasharray={f > 0 && f < 1 ? '4 3' : undefined} />
            <text x={PAD.l - 6} y={(y + 4).toFixed(1)} textAnchor="end"
              fontSize="10" fill="#9ca3af">{Math.round(f * 100)}%</text>
          </g>
        );
      })}

      {/* Session bars */}
      {points.map((p, i) => {
        const norm = p.sessions / maxSess;
        const bx   = cx(i) - barW / 2;
        const by   = ny(norm);
        const bh   = Math.max(baseY - by, 2);
        return (
          <rect key={i} x={bx.toFixed(1)} y={by.toFixed(1)}
            width={barW.toFixed(1)} height={bh.toFixed(1)}
            fill="#bfdbfe" rx="2" opacity="0.8" />
        );
      })}

      {/* Trial line + subtle fill (violet) */}
      <path
        d={trialPath + ` L${cx(n-1).toFixed(1)} ${baseY.toFixed(1)} L${cx(0).toFixed(1)} ${baseY.toFixed(1)} Z`}
        fill="#7c3aed" fillOpacity="0.05" />
      <path d={trialPath} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        if (p.trials === 0) return null;
        const y = ny(p.trials / maxTrials);
        const isTop = p.trials === maxTrials;
        const labelY = isTop ? y - 10 : y - 9;
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        return (
          <g key={i}>
            <circle cx={cx(i).toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#7c3aed" />
            <text x={cx(i).toFixed(1)} y={labelY.toFixed(1)} textAnchor={anchor}
              fontSize={isTop ? '10' : '9'} fill="#7c3aed" fontWeight={isTop ? '700' : '500'} opacity={isTop ? 1 : 0.7}>
              {fmt(p.trials)}
            </text>
          </g>
        );
      })}

      {/* Order line + subtle fill (emerald) */}
      {hasOrders && orderPath && (
        <>
          <path
            d={orderPath + ` L${cx(n-1).toFixed(1)} ${baseY.toFixed(1)} L${cx(0).toFixed(1)} ${baseY.toFixed(1)} Z`}
            fill="#10b981" fillOpacity="0.05" />
          <path d={orderPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => {
            if (p.orders === 0) return null;
            const y = ny(p.orders / maxOrders);
            const isTop = p.orders === maxOrders;
            const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
            return (
              <g key={i}>
                <circle cx={cx(i).toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#10b981" />
                <text x={cx(i).toFixed(1)} y={(y - 9).toFixed(1)} textAnchor={anchor}
                  fontSize={isTop ? '10' : '9'} fill="#059669" fontWeight={isTop ? '700' : '500'} opacity={isTop ? 1 : 0.7}>
                  {fmt(p.orders)}
                </text>
              </g>
            );
          })}
        </>
      )}

      {/* Conversion rate line (amber dashed) */}
      {hasConv && convPath && (
        <>
          <path d={convPath} fill="none" stroke="#f59e0b" strokeWidth="1.5"
            strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
          {points.map((p, i) => {
            if (p.convRate === 0) return null;
            const y = ny(p.convRate / maxConv);
            const isTop = p.convRate === maxConv;
            if (!isTop) return <circle key={i} cx={cx(i).toFixed(1)} cy={y.toFixed(1)} r="2.5" fill="#f59e0b" opacity="0.8" />;
            return (
              <g key={i}>
                <circle cx={cx(i).toFixed(1)} cy={y.toFixed(1)} r="3" fill="#f59e0b" />
                <text x={cx(i).toFixed(1)} y={(y - 8).toFixed(1)} textAnchor="middle"
                  fontSize="9" fill="#b45309" fontWeight="700">
                  {fmtPct(p.convRate)}
                </text>
              </g>
            );
          })}
        </>
      )}

      {/* Month labels */}
      {points.map((p, i) => (
        <text key={i} x={cx(i).toFixed(1)} y={H - 6} textAnchor="middle"
          fontSize="12" fill="#4b5563" fontWeight="500">{p.label}</text>
      ))}
    </svg>
  );
}

// ─── ETZ Trials — full dedicated view ────────────────────────────────────────

function channelColor(ch: string): string {
  return CHANNEL_COLORS[ch] ?? '#9ca3af';
}

function FunnelDropArrow({ from, to, label }: { from: number; to: number; label?: string }) {
  const pct = from > 0 ? Math.round((to / from) * 100) : null;
  const dropPct = pct != null ? 100 - pct : null;
  return (
    <div className="flex flex-col items-center py-1 select-none">
      <div className="w-0.5 h-4 bg-gray-200" />
      <div className="flex items-center gap-2">
        <div className="w-0.5 h-4 bg-gray-200" />
        {dropPct != null && (
          <span className="text-[11px] text-red-400 font-medium tabular-nums">
            −{dropPct}% drop
          </span>
        )}
      </div>
      <svg width="12" height="8" viewBox="0 0 12 8" className="text-gray-300">
        <path d="M6 8L0 0h12z" fill="currentColor" />
      </svg>
      {label && <span className="text-[10px] text-gray-400 mt-0.5">{label}</span>}
    </div>
  );
}

function EtzTrialsFullView({
  data,
  loading,
  month,
  stripeOrders,
  stripeRevenue,
  stripeConnected,
  traffic,
  loadingTraffic,
  appTraffic,
  loadingAppTraffic,
  trend,
  loadingTrend,
  sources,
  loadingSources,
  clarity,
  loadingClarity,
}: {
  data:               EtzTrialFunnelResponse | null;
  loading:            boolean;
  month:              string;
  stripeOrders:       number;
  stripeRevenue:      number;
  stripeConnected:    boolean;
  traffic:            EtzFunnelTrafficResponse | null;
  loadingTraffic:     boolean;
  appTraffic:         EtzAppTrafficResponse | null;
  loadingAppTraffic:  boolean;
  trend:              EtzTrendResponse | null;
  loadingTrend:       boolean;
  sources:            EtzSourceResponse | null;
  loadingSources:     boolean;
  clarity:            EtzClarityResponse | null;
  loadingClarity:     boolean;
}) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 text-sm text-gray-400">
        <svg className="animate-spin h-5 w-5 mr-2 text-emerald-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Loading trial data from HubSpot…
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 text-sm text-gray-400">
        {data?.error ?? 'No trial data available'}
      </div>
    );
  }

  const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  const sessions    = traffic?.totalSessions      ?? 0;
  const appSessions = appTraffic?.totalSessions   ?? 0;
  const trials      = data?.trialsStarted         ?? 0;
  const orders      = stripeOrders;

  // Conversion rates: prefer app sessions → trial rate when we have app data
  const appClickRate  = sessions > 0 && appTraffic?.connected ? (appSessions / sessions) * 100 : null;
  const appTrialRate  = appSessions > 0 && appTraffic?.connected ? (trials / appSessions) * 100 : null;
  const trialRate     = sessions > 0 && !appTraffic?.connected ? (trials / sessions) * 100 : null;
  const convRate      = trials > 0 && stripeConnected ? (orders / trials) * 100 : null;
  const overallRate   = sessions > 0 && stripeConnected ? (orders / sessions) * 100 : null;

  const funnelReady   = !loading && !loadingTraffic && data != null;
  const hasAppStage   = appTraffic?.connected === true;

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto space-y-2">

      {/* Header */}
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900">Excel Test Zone · Conversion Funnel</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {monthLabel(month)} · GA4 → HubSpot → Stripe
        </p>
      </div>

      {/* ── Stage 1: Main site traffic ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
            <span className="text-sm font-semibold text-gray-700">Stage 1 · Traffic</span>
          </div>
          <span className="text-xs text-gray-400">GA4</span>
        </div>
        <div className="px-5 py-4">
          {loadingTraffic ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !traffic?.connected ? (
            <p className="text-sm text-gray-400 italic">GA4 not connected</p>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-4xl font-extrabold text-gray-900 tabular-nums">
                  {sessions.toLocaleString()}
                </span>
                <span className="text-sm text-gray-500">sessions</span>
                <span className="text-sm text-gray-400">·</span>
                <span className="text-sm text-gray-500">
                  {traffic.totalNewUsers.toLocaleString()} new users
                </span>
              </div>
              {/* Channel breakdown bar */}
              <div className="flex h-3 rounded-full overflow-hidden gap-px mb-3">
                {traffic.byChannel.map(ch => (
                  <div
                    key={ch.channel}
                    style={{ width: `${ch.pct}%`, background: channelColor(ch.channel) }}
                    title={`${ch.channel}: ${ch.sessions.toLocaleString()} sessions (${ch.pct}%)`}
                  />
                ))}
              </div>
              {/* Channel legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {traffic.byChannel.map(ch => (
                  <div key={ch.channel} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0"
                      style={{ background: channelColor(ch.channel) }} />
                    <span className="text-xs text-gray-600 font-medium">{ch.channel}</span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {ch.sessions.toLocaleString()} ({ch.pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Drop arrow 1: main site → app */}
      {funnelReady && traffic?.connected && hasAppStage && (
        <FunnelDropArrow from={sessions} to={appSessions} label="visited main site → reached app" />
      )}
      {/* Drop arrow 1 fallback: main site → trial (when no app data) */}
      {funnelReady && traffic?.connected && !hasAppStage && (
        <FunnelDropArrow from={sessions} to={trials} label="session → trial" />
      )}

      {/* ── Stage 1b: App site (app.exceltestzone.com.au) ─────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
            <span className="text-sm font-semibold text-gray-700">Stage 2 · App Site</span>
          </div>
          <span className="text-xs text-gray-400">app.exceltestzone.com.au · GA4</span>
        </div>
        <div className="px-5 py-4">
          {loadingAppTraffic ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !appTraffic?.connected ? (
            <div className="space-y-1">
              <p className="text-sm text-gray-400 italic">App site tracking not connected</p>
              <p className="text-xs text-gray-400 max-w-sm">
                Add <code className="bg-gray-100 px-1 rounded text-xs">GOOGLE_ANALYTICS_ETZ_APP_PROPERTY_ID</code> to connect a
                dedicated GA4 property for app.exceltestzone.com.au, or enable cross-domain tracking
                in the existing ETZ GA4 property.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <div className="text-4xl font-extrabold text-gray-900 tabular-nums">
                  {appSessions.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">app sessions</div>
              </div>
              {appClickRate != null && (
                <div>
                  <div className="text-2xl font-bold text-sky-600 tabular-nums">
                    {appClickRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">of main site visitors</div>
                </div>
              )}
              {appTraffic.fromMainSite > 0 && (
                <div>
                  <div className="text-xl font-bold text-sky-500 tabular-nums">
                    {appTraffic.fromMainSite.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">arrived from main site</div>
                </div>
              )}
              {appTraffic.totalNewUsers > 0 && (
                <div className="ml-auto text-right">
                  <div className="text-xl font-bold text-gray-500 tabular-nums">
                    {appTraffic.totalNewUsers.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">new users</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drop arrow 2: app → trial */}
      {funnelReady && hasAppStage && (
        <FunnelDropArrow from={appSessions} to={trials} label="app session → free trial" />
      )}

      {/* ── Stage 3: Free Trials ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />
            <span className="text-sm font-semibold text-gray-700">Stage 3 · Free Trials</span>
          </div>
          <span className="text-xs text-gray-400">HubSpot</span>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="flex items-center gap-8">
              <div>
                <div className="text-4xl font-extrabold text-gray-900 tabular-nums">
                  {trials.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">trials started</div>
              </div>
              {appTrialRate != null && (
                <div>
                  <div className="text-2xl font-bold text-violet-600 tabular-nums">
                    {appTrialRate.toFixed(2)}%
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">of app visitors → trial</div>
                </div>
              )}
              {trialRate != null && (
                <div>
                  <div className="text-2xl font-bold text-violet-600 tabular-nums">
                    {trialRate.toFixed(2)}%
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">of sessions → trial</div>
                </div>
              )}
              {data && (
                <div className="ml-auto text-right">
                  <div className="text-xl font-bold text-blue-600 tabular-nums">
                    {data.currentlyOnTrial.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">still trialling now</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Source Attribution (trial origin) ────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            <span className="text-sm font-semibold text-gray-700">Trial Sources</span>
          </div>
          <span className="text-xs text-gray-400">HubSpot</span>
        </div>
        <div className="px-5 py-4">
          {loadingSources ? (
            <p className="text-sm text-gray-400">Loading sources…</p>
          ) : !sources || sources.error || !sources.rows || sources.total === 0 ? (
            <p className="text-sm text-gray-400 italic">
              {sources?.error ? 'Source data unavailable — will retry shortly' : `No trial source data for ${monthLabel(month)}`}
            </p>
          ) : sources._meta?.hasSourceData === false ? (
            <div>
              <p className="text-sm text-gray-500 mb-2">
                {sources.total.toLocaleString()} trials · source data not yet on deals
              </p>
              <p className="text-xs text-gray-400 italic max-w-sm">
                {sources._meta.note}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Stacked bar */}
              {sources.rows.length > 0 && (
                <div className="flex h-2.5 rounded-full overflow-hidden gap-px mb-3">
                  {sources.rows.map((row, i) => {
                    const BAR_COLORS = ['#7c3aed','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'];
                    return (
                      <div
                        key={row.source}
                        style={{ width: `${row.pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
                        title={`${row.source}: ${row.trials} trials (${row.pct}%)`}
                      />
                    );
                  })}
                </div>
              )}
              {/* Source list */}
              <div className="flex flex-col gap-1.5">
                {sources.rows.map((row, i) => {
                  const BAR_COLORS = ['#7c3aed','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'];
                  return (
                    <div key={row.source} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
                      />
                      <span className="text-sm text-gray-700 flex-1">{row.source}</span>
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.trials}</span>
                      <span className="text-xs text-gray-400 tabular-nums w-10 text-right">{row.pct}%</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 pt-1">
                {sources.total.toLocaleString()} total trials · first-touch source from HubSpot
              </p>
              {sources.rows.some(r => r.source === 'Offline') && (
                <p className="text-xs text-gray-400 italic border-t border-gray-100 pt-2 mt-1">
                  <span className="font-medium not-italic text-gray-500">Offline</span> = source not captured — the trial was created without a tracked web visit (e.g. signed up directly in the app, or manually added in HubSpot). To reduce this, set up a HubSpot workflow to copy the contact&apos;s original source onto the deal at creation.
                </p>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Drop arrow 2 */}
      {funnelReady && (
        <FunnelDropArrow from={trials} to={orders} label="trial → paid" />
      )}

      {/* ── Stage 3: Paid Orders ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span className="text-sm font-semibold text-gray-700">Stage 3 · Paid Orders</span>
          </div>
          <span className="text-xs text-gray-400">Stripe</span>
        </div>
        <div className="px-5 py-4">
          {!stripeConnected ? (
            <p className="text-sm text-gray-400 italic">Stripe not connected</p>
          ) : (
            <div className="flex items-center gap-8">
              <div>
                <div className="text-4xl font-extrabold text-emerald-600 tabular-nums">
                  {orders.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">orders · {AUD.format(stripeRevenue)}</div>
              </div>
              {convRate != null && (
                <div>
                  <div className="text-2xl font-bold text-emerald-600 tabular-nums">
                    {convRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">trial → paid rate</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Overall summary strip ─────────────────────────────────────────── */}
      {funnelReady && stripeConnected && traffic?.connected && overallRate != null && (
        <div className="bg-gray-900 rounded-2xl px-6 py-4 flex items-center justify-between mt-2">
          <div>
            <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">
              Overall · session → paid
            </div>
            <div className="text-2xl font-extrabold text-white tabular-nums">
              {overallRate.toFixed(2)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-1">
              {sessions.toLocaleString()} sessions
            </div>
            <div className="text-xs text-gray-400">
              → {trials.toLocaleString()} trials → {orders.toLocaleString()} paid
            </div>
          </div>
        </div>
      )}

      {/* ── 12-month trend chart ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-2">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-gray-700">12-Month Trend</span>
            <span className="text-xs text-gray-400 ml-2">Sessions · Trials · Orders</span>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-200 inline-block" />
              Sessions
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-violet-600 inline-block" />
              Trials
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Orders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-amber-400 border-dashed inline-block" />
              Conv. rate
            </span>
          </div>
        </div>
        <div className="px-4 py-4">
          {loadingTrend ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400">
              Loading trend data — this takes a moment…
            </div>
          ) : !trend || trend.points.length < 2 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400 italic">
              No trend data available
            </div>
          ) : (
            <>
              <EtzTrendChart points={trend.points} />
              <p className="text-xs text-gray-400 mt-2 text-center">
                All metrics indexed to their own peak (100%) so different scales are comparable · actual values labelled at each point
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Clarity Behavioral Insights ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-2">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            <span className="text-sm font-semibold text-gray-700">User Behaviour · Microsoft Clarity</span>
          </div>
          <span className="text-xs text-gray-400">Last 3 days</span>
        </div>
        <div className="px-5 py-4">
          {loadingClarity ? (
            <p className="text-sm text-gray-400">Loading Clarity data…</p>
          ) : !clarity?.connected ? (
            <div className="space-y-1">
              <p className="text-sm text-gray-500 font-medium">Clarity not yet connected</p>
              <p className="text-xs text-gray-400 max-w-sm">
                {clarity?.error ?? 'Add CLARITY_API_TOKEN to environment variables. Generate at clarity.microsoft.com → Settings → Data Export.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Overall metrics row */}
              {clarity.overall && (() => {
                const hasPPS   = clarity.overall.pagesPerSession > 0;
                const hasScroll = clarity.overall.scrollDepth > 0;
                const hasDead  = clarity.overall.deadClickRate > 0;
                const hasRage  = clarity.overall.rageClickRate > 0;
                const cards = [
                  {
                    label: 'Avg active time',
                    value: `${Math.round(clarity.overall.activeTime)}s`,
                    note:  clarity.overall.activeTime > 120 ? '✓ engaged' : clarity.overall.activeTime < 30 ? '⚠ low' : '',
                    color: clarity.overall.activeTime > 120 ? 'text-emerald-600' : clarity.overall.activeTime < 30 ? 'text-red-600' : 'text-gray-900',
                    show: true,
                  },
                  {
                    label: 'Pages / session',
                    value: hasPPS ? clarity.overall.pagesPerSession.toFixed(1) : '—',
                    note:  hasPPS && clarity.overall.pagesPerSession > 2 ? '✓ exploring' : hasPPS && clarity.overall.pagesPerSession < 1.2 ? '⚠ low depth' : '',
                    color: hasPPS && clarity.overall.pagesPerSession > 2 ? 'text-emerald-600' : 'text-gray-900',
                    show: true,
                  },
                  {
                    label: 'Dead click rate',
                    value: hasDead ? `${clarity.overall.deadClickRate.toFixed(1)}%` : '—',
                    note:  hasDead && clarity.overall.deadClickRate > 8 ? '⚠ broken UI?' : '',
                    color: hasDead && clarity.overall.deadClickRate > 8 ? 'text-red-600' : 'text-gray-900',
                    show: true,
                  },
                  {
                    label: 'Rage click rate',
                    value: hasRage ? `${clarity.overall.rageClickRate.toFixed(1)}%` : '—',
                    note:  hasRage && clarity.overall.rageClickRate > 3 ? '⚠ frustration' : '',
                    color: hasRage && clarity.overall.rageClickRate > 3 ? 'text-red-600' : 'text-gray-900',
                    show: true,
                  },
                ].filter(c => c.show);
                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {cards.map(m => (
                        <div key={m.label} className="bg-gray-50 rounded-xl px-4 py-3">
                          <div className={`text-xl font-bold tabular-nums ${m.color}`}>{m.value}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{m.label}</div>
                          {m.note && <div className="text-xs text-gray-400 mt-0.5">{m.note}</div>}
                        </div>
                      ))}
                    </div>
                    {hasScroll && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">Avg scroll depth</span>
                          <span className="text-xs font-semibold text-gray-700">{clarity.overall.scrollDepth.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min(clarity.overall.scrollDepth, 100)}%` }} />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {clarity.overall.scrollDepth < 40
                            ? '⚠ Most visitors leave before the fold — consider moving CTAs higher'
                            : clarity.overall.scrollDepth > 70
                            ? '✓ Visitors are reading deep into the page'
                            : 'Moderate scroll depth'}
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Traffic quality by source */}
              {clarity.bySource.length > 0 && (() => {
                const maxTime = Math.max(...clarity.bySource.map(r => r.activeTime), 1);
                const totalSessions = clarity.bySource.reduce((s, r) => s + r.sessions, 0);
                const hasScroll  = clarity.bySource.some(r => r.scrollDepth > 0);
                const hasDead    = clarity.bySource.some(r => r.deadClickRate > 0);
                const hasRage    = clarity.bySource.some(r => r.rageClickRate > 0);
                const hasPPS     = clarity.bySource.some(r => r.pagesPerSession > 0);

                const qualityLabel = (t: number) =>
                  t >= 120 ? { label: 'Engaged',  cls: 'bg-emerald-100 text-emerald-700' }
                  : t >= 30 ? { label: 'Moderate', cls: 'bg-amber-100 text-amber-700' }
                              : { label: 'Low',      cls: 'bg-red-100 text-red-600' };

                return (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Traffic quality by source
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left py-1.5 font-medium w-32">Source</th>
                            <th className="text-right py-1.5 font-medium">Sessions</th>
                            <th className="text-left py-1.5 font-medium pl-3" colSpan={2}>Avg active time</th>
                            {hasPPS    && <th className="text-right py-1.5 font-medium">Pages/s</th>}
                            {hasScroll && <th className="text-right py-1.5 font-medium">Scroll</th>}
                            {hasDead   && <th className="text-right py-1.5 font-medium">Dead clicks</th>}
                            {hasRage   && <th className="text-right py-1.5 font-medium">Rage clicks</th>}
                            <th className="text-right py-1.5 font-medium">Quality</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clarity.bySource.slice(0, 10).map(row => {
                            const q = qualityLabel(row.activeTime);
                            const barPct = maxTime > 0 ? (row.activeTime / maxTime) * 100 : 0;
                            const sessionPct = totalSessions > 0 ? ((row.sessions / totalSessions) * 100).toFixed(0) : '0';
                            return (
                              <tr key={row.dimensionValue} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="py-2 text-gray-700 font-medium max-w-[120px] truncate" title={row.dimensionValue}>
                                  {row.dimensionValue}
                                </td>
                                <td className="py-2 text-right text-gray-600 tabular-nums">
                                  {row.sessions.toLocaleString()}
                                  <span className="text-gray-400 ml-1">({sessionPct}%)</span>
                                </td>
                                {/* Active time with visual bar */}
                                <td className="py-2 pl-3 tabular-nums font-medium text-gray-700 w-12">
                                  {Math.round(row.activeTime)}s
                                </td>
                                <td className="py-2 w-24">
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-24">
                                    <div
                                      className={`h-full rounded-full ${row.activeTime >= 120 ? 'bg-emerald-400' : row.activeTime >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </td>
                                {hasPPS    && <td className="py-2 text-right text-gray-600 tabular-nums">{row.pagesPerSession > 0 ? row.pagesPerSession.toFixed(1) : '—'}</td>}
                                {hasScroll && <td className="py-2 text-right text-gray-600 tabular-nums">{row.scrollDepth > 0 ? `${row.scrollDepth.toFixed(0)}%` : '—'}</td>}
                                {hasDead   && <td className={`py-2 text-right tabular-nums ${row.deadClickRate > 8 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{row.deadClickRate > 0 ? `${row.deadClickRate.toFixed(1)}%` : '—'}</td>}
                                {hasRage   && <td className={`py-2 text-right tabular-nums ${row.rageClickRate > 3 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{row.rageClickRate > 0 ? `${row.rageClickRate.toFixed(1)}%` : '—'}</td>}
                                <td className="py-2 text-right">
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${q.cls}`}>{q.label}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Active time &lt; 30s = low-quality visit · quality tiers help prioritise channel spend ·{' '}
                      <a
                        href="https://clarity.microsoft.com/projects/view/qmef32brd0/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:underline"
                      >
                        Open Clarity ↗
                      </a>
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 pb-4 pt-1">
        Traffic: GA4 · Trials: HubSpot ({data?._meta?.pipeline ?? 'ETZ'} pipeline) ·
        Orders: Stripe · Behaviour: Clarity · refreshes on each page load
      </p>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EtzTrialFunnelPanel was removed — replaced by EtzTrialsFullView above.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────

function CampaignBreakdownTable({
  googleData, loadingGoogle,
  metaData,   loadingMeta,
}: {
  googleData:    CampaignsResponse | null; loadingGoogle: boolean;
  metaData:      MetaCampaignsResponse | null; loadingMeta:  boolean;
}) {
  const [source, setSource] = useState<'google' | 'meta'>('google');
  const [tab,    setTab   ] = useState<'pp' | 'etz' | 'hsc'>('pp');

  // Meta doesn't have HSC — fall back to PP when switching
  const activeBrandTab = source === 'meta' && tab === 'hsc' ? 'pp' : tab;

  const googleBrand = googleData?.[tab];
  const metaBrand   = metaData?.[activeBrandTab as 'pp' | 'etz'];

  const googleTabs: { key: 'pp' | 'etz' | 'hsc'; label: string }[] = [
    { key: 'pp',  label: 'Pascal Press' },
    { key: 'etz', label: 'Excel Test Zone' },
    { key: 'hsc', label: 'Excel HSC Copilot' },
  ];
  const metaTabs: { key: 'pp' | 'etz'; label: string }[] = [
    { key: 'pp',  label: 'Pascal Press' },
    { key: 'etz', label: 'Excel Test Zone' },
  ];

  const loading = source === 'google' ? loadingGoogle : loadingMeta;

  return (
    <div className="px-4 md:px-6 pb-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-4 md:px-5 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Ad Campaigns</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {source === 'google'
                ? 'Spend from Google Ads · Revenue from Google Analytics (paid sessions)'
                : 'Spend & reach from Meta (Facebook) Ads'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
              <button
                onClick={() => setSource('google')}
                className={`px-3 py-1.5 transition-colors ${
                  source === 'google' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Google Ads
              </button>
              <button
                onClick={() => setSource('meta')}
                className={`px-3 py-1.5 transition-colors border-l border-gray-300 ${
                  source === 'meta' ? 'bg-[#1877F2] text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Meta
              </button>
            </div>
            {/* Brand tabs */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
              {(source === 'google' ? googleTabs : metaTabs).map((t, i) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as 'pp' | 'etz' | 'hsc')}
                  className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-300' : ''} ${
                    activeBrandTab === t.key ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading campaigns…</div>
        )}

        {/* ── Google Ads view ── */}
        {!loading && source === 'google' && googleBrand && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-5 py-3 bg-gray-50 border-b border-gray-100">
              <div>
                <div className="text-xs text-gray-500">Total spend</div>
                <div className="text-base font-bold text-gray-900">
                  {googleBrand.totals.spend > 0 ? AUD.format(googleBrand.totals.spend) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">GA revenue (paid)</div>
                <div className="text-base font-bold text-blue-700">
                  {googleBrand.gaConnected
                    ? (googleBrand.totals.gaRevenue > 0 ? AUD.format(googleBrand.totals.gaRevenue) : '$0')
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">GA ROAS</div>
                <div className={`text-base font-bold ${
                  googleBrand.totals.gaRoas >= 4 ? 'text-green-700'
                  : googleBrand.totals.gaRoas >= 2 ? 'text-yellow-600'
                  : googleBrand.totals.gaRoas > 0 ? 'text-red-600' : 'text-gray-400'
                }`}>
                  {googleBrand.totals.gaRoas > 0 ? `${googleBrand.totals.gaRoas.toFixed(1)}x` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Clicks</div>
                <div className="text-base font-bold text-gray-900">
                  {googleBrand.totals.clicks > 0 ? googleBrand.totals.clicks.toLocaleString() : '—'}
                </div>
              </div>
            </div>

            {!googleBrand.adsConnected && googleBrand.campaigns.length === 0 && (
              <div className="px-5 py-6 text-sm text-gray-400 italic">
                {googleBrand.error ? `Could not load Google Ads: ${googleBrand.error}` : 'No Google Ads data for this brand/month'}
              </div>
            )}

            {googleBrand.campaigns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium px-4 py-2.5">Campaign</th>
                      <th className="text-right font-medium px-3 py-2.5">Spend</th>
                      <th className="text-right font-medium px-3 py-2.5">Clicks</th>
                      <th className="text-right font-medium px-3 py-2.5">Impr.</th>
                      <th className="text-right font-medium px-3 py-2.5">GA Revenue</th>
                      <th className="text-right font-medium px-3 py-2.5">Tx</th>
                      <th className="text-right font-medium px-4 py-2.5">GA ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleBrand.campaigns.map((c) => (
                      <tr key={c.name} className="border-b border-gray-50 hover:bg-gray-50/80">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900 max-w-[280px] truncate" title={c.name}>
                            {c.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {c.status === 'ENABLED' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">Active</span>
                            )}
                            {c.status === 'PAUSED' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Paused</span>
                            )}
                            {c.status === 'GA_ONLY' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">GA only</span>
                            )}
                            {!c.gaMatched && c.spend > 0 && googleBrand.gaConnected && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-medium">No GA match</span>
                            )}
                          </div>
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-900 font-medium">
                          {c.spend > 0 ? AUD.format(c.spend) : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.clicks > 0 ? c.clicks.toLocaleString() : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.impressions > 0 ? c.impressions.toLocaleString() : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums font-medium text-blue-700">
                          {googleBrand.gaConnected
                            ? (c.gaRevenue > 0 ? AUD.format(c.gaRevenue) : '$0')
                            : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.gaTransactions > 0 ? c.gaTransactions : '—'}
                        </td>
                        <td className={`text-right px-4 py-2.5 tabular-nums font-semibold ${
                          c.gaRoas >= 4 ? 'text-green-700'
                          : c.gaRoas >= 2 ? 'text-yellow-600'
                          : c.gaRoas > 0 ? 'text-red-600' : 'text-gray-400'
                        }`}>
                          {c.gaRoas > 0 ? `${c.gaRoas.toFixed(1)}x` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'hsc' && !googleBrand.gaConnected && googleBrand.campaigns.length > 0 && (
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                HSC has no GA4 property connected yet — showing Google Ads spend only.
              </div>
            )}
          </>
        )}

        {/* ── Meta Ads view ── */}
        {!loading && source === 'meta' && metaBrand && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-5 py-3 border-b border-blue-100" style={{ background: '#f0f4ff' }}>
              <div>
                <div className="text-xs text-gray-500">Total spend</div>
                <div className="text-base font-bold text-gray-900">
                  {metaBrand.totals.spend > 0 ? AUD.format(metaBrand.totals.spend) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Reach</div>
                <div className="text-base font-bold text-[#1877F2]">
                  {metaBrand.totals.reach > 0 ? metaBrand.totals.reach.toLocaleString() : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Impressions</div>
                <div className="text-base font-bold text-gray-900">
                  {metaBrand.totals.impressions > 0 ? metaBrand.totals.impressions.toLocaleString() : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Clicks</div>
                <div className="text-base font-bold text-gray-900">
                  {metaBrand.totals.clicks > 0 ? metaBrand.totals.clicks.toLocaleString() : '—'}
                </div>
              </div>
            </div>

            {metaBrand.error && (
              <div className="px-5 py-6 text-sm text-red-500 italic">
                Could not load Meta Ads: {metaBrand.error}
              </div>
            )}

            {!metaBrand.error && metaBrand.campaigns.length === 0 && (
              <div className="px-5 py-6 text-sm text-gray-400 italic">
                No Meta campaigns with spend found for this period.
              </div>
            )}

            {metaBrand.campaigns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium px-4 py-2.5">Campaign</th>
                      <th className="text-right font-medium px-3 py-2.5">Spend</th>
                      <th className="text-right font-medium px-3 py-2.5">Reach</th>
                      <th className="text-right font-medium px-3 py-2.5">Impressions</th>
                      <th className="text-right font-medium px-3 py-2.5">Clicks</th>
                      <th className="text-right font-medium px-3 py-2.5">CTR</th>
                      <th className="text-right font-medium px-4 py-2.5">CPM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metaBrand.campaigns.map((c) => (
                      <tr key={c.id || c.name} className="border-b border-gray-50 hover:bg-gray-50/80">
                        <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[280px] truncate" title={c.name}>
                          {c.name}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-900 font-medium">
                          {c.spend > 0 ? AUD.format(c.spend) : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-[#1877F2] font-medium">
                          {c.reach > 0 ? c.reach.toLocaleString() : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.impressions > 0 ? c.impressions.toLocaleString() : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.clicks > 0 ? c.clicks.toLocaleString() : '—'}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-gray-600">
                          {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : '—'}
                        </td>
                        <td className="text-right px-4 py-2.5 tabular-nums text-gray-600">
                          {c.cpm > 0 ? AUD.format(c.cpm) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function FinanceDashboard({ records, syncing, lastSynced, onSyncGoogleAds }: Props) {
  const [selectedMonth,    setSelectedMonth   ] = useState<string>(defaultYearMonth);
  const [revenue,          setRevenue         ] = useState<RevenueResponse | null>(null);
  const [loadingRevenue,   setLoadingRevenue  ] = useState(false);
  const [revenueHistory,   setRevenueHistory  ] = useState<MonthRevHistory[] | null>(null);
  const [loadingHistory,   setLoadingHistory  ] = useState(false);
  const [googleAdsSpend,   setGoogleAdsSpend  ] = useState<GoogleAdsSpendResponse | null>(null);
  const [googleAdsHistory, setGoogleAdsHistory] = useState<GoogleAdsHistoryItem[] | null>(null);
  const [ga4Revenue,       setGa4Revenue      ] = useState<GA4RevenueResponse | null>(null);
  const [ga4History,       setGa4History      ] = useState<GA4HistoryItem[] | null>(null);
  const [campaigns,            setCampaigns           ] = useState<CampaignsResponse | null>(null);
  const [loadingCampaigns,    setLoadingCampaigns    ] = useState(false);
  const [metaCampaigns,        setMetaCampaigns       ] = useState<MetaCampaignsResponse | null>(null);
  const [loadingMetaCampaigns, setLoadingMetaCampaigns] = useState(false);
  const [etzTrialFunnel,       setEtzTrialFunnel      ] = useState<EtzTrialFunnelResponse | null>(null);
  const [loadingEtzTrial,      setLoadingEtzTrial     ] = useState(false);
  const [etzTraffic,           setEtzTraffic          ] = useState<EtzFunnelTrafficResponse | null>(null);
  const [loadingEtzTraffic,    setLoadingEtzTraffic   ] = useState(false);
  const [etzAppTraffic,        setEtzAppTraffic       ] = useState<EtzAppTrafficResponse | null>(null);
  const [loadingEtzAppTraffic, setLoadingEtzAppTraffic] = useState(false);
  const [etzTrend,             setEtzTrend            ] = useState<EtzTrendResponse | null>(null);
  const [loadingEtzTrend,      setLoadingEtzTrend     ] = useState(false);
  const [etzSources,           setEtzSources          ] = useState<EtzSourceResponse | null>(null);
  const [loadingEtzSources,    setLoadingEtzSources   ] = useState(false);
  const [etzClarity,           setEtzClarity          ] = useState<EtzClarityResponse | null>(null);
  const [loadingClarity,       setLoadingClarity      ] = useState(false);
  const [financeView,          setFinanceView         ] = useState<'overview' | 'etz-trials'>('overview');
  const [siteConversion,   setSiteConversion  ] = useState<WebsiteConversionResponse | null>(null);
  const [channelRevenue,   setChannelRevenue  ] = useState<ChannelRevenueResponse | null>(null);

  // Persist month choice so remounts (tab switches) don't snap back to default
  useEffect(() => {
    try { sessionStorage.setItem(MONTH_STORAGE_KEY, selectedMonth); } catch { /* ignore */ }
  }, [selectedMonth]);

  useEffect(() => {
    // Abort in-flight requests when month changes so a slower older response
    // cannot overwrite fresher data (was flipping July → June numbers).
    const ac = new AbortController();
    const { signal } = ac;
    const month = selectedMonth;

    setLoadingRevenue(true);
    setRevenue(null); // clear stale totals immediately on month change
    setGoogleAdsSpend(null);
    setGa4Revenue(null);
    setCampaigns(null);
    setMetaCampaigns(null);
    setEtzTrialFunnel(null);
    setEtzTraffic(null);
    setEtzAppTraffic(null);
    setEtzSources(null);
    setSiteConversion(null);
    setChannelRevenue(null);

    fetch('/api/revenue?month=' + month, { signal })
      .then(r => r.json())
      .then((data: RevenueResponse) => {
        // Only apply if this response is still for the active month
        if (data?.month && data.month !== month) return;
        setRevenue(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } })
      .finally(() => { if (!signal.aborted) setLoadingRevenue(false); });

    fetch('/api/google-ads-spend?month=' + month, { signal })
      .then(r => r.json())
      .then((data: GoogleAdsSpendResponse) => {
        if (data?.month && data.month !== month) return;
        setGoogleAdsSpend(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } });

    fetch('/api/ga4-revenue?month=' + month, { signal })
      .then(r => r.json())
      .then((data: GA4RevenueResponse) => {
        if (data?.month && data.month !== month) return;
        setGa4Revenue(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } });

    setLoadingCampaigns(true);
    fetch('/api/google-ads-campaigns?month=' + month, { signal })
      .then(r => r.json())
      .then((data: CampaignsResponse) => {
        if (data?.month && data.month !== month) return;
        setCampaigns(data);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setCampaigns(null);
      })
      .finally(() => { if (!signal.aborted) setLoadingCampaigns(false); });

    setLoadingMetaCampaigns(true);
    fetch('/api/meta-campaigns?month=' + month, { signal })
      .then(r => r.json())
      .then((data: MetaCampaignsResponse) => {
        if (data?.month && data.month !== month) return;
        setMetaCampaigns(data);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setMetaCampaigns(null);
      })
      .finally(() => { if (!signal.aborted) setLoadingMetaCampaigns(false); });

    setLoadingEtzTrial(true);
    fetch('/api/etz-trial-funnel?month=' + month, { signal })
      .then(r => r.json())
      .then((data: EtzTrialFunnelResponse) => {
        if (data?.month && data.month !== month) return;
        setEtzTrialFunnel(data);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setEtzTrialFunnel(null);
      })
      .finally(() => { if (!signal.aborted) setLoadingEtzTrial(false); });

    setLoadingEtzTraffic(true);
    fetch('/api/etz-funnel-traffic?month=' + month, { signal })
      .then(r => r.json())
      .then((data: EtzFunnelTrafficResponse) => {
        if (!signal.aborted) setEtzTraffic(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') setEtzTraffic(null); })
      .finally(() => { if (!signal.aborted) setLoadingEtzTraffic(false); });

    setLoadingEtzAppTraffic(true);
    fetch('/api/etz-app-traffic?month=' + month, { signal })
      .then(r => r.json())
      .then((data: EtzAppTrafficResponse) => {
        if (!signal.aborted) setEtzAppTraffic(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') setEtzAppTraffic(null); })
      .finally(() => { if (!signal.aborted) setLoadingEtzAppTraffic(false); });

    // Delay 2 s so etz-sources fires after etz-trial-funnel (2 HubSpot search calls,
    // ~400–800 ms total) has cleared HubSpot's 4 req/sec secondly limit.
    // ISR caches the response after first successful load so subsequent views
    // hit the cache and make no live HubSpot call at all.
    setLoadingEtzSources(true);
    const srcTimer = setTimeout(() => {
      if (signal.aborted) { setLoadingEtzSources(false); return; }
      fetch('/api/etz-sources?month=' + month, { signal })
        .then(r => r.json())
        .then((data: EtzSourceResponse) => {
          if (data?.month && data.month !== month) return;
          if (!signal.aborted) setEtzSources(data);
        })
        .catch((e) => { if (e?.name !== 'AbortError') setEtzSources(null); })
        .finally(() => { if (!signal.aborted) setLoadingEtzSources(false); });
    }, 2000);
    signal.addEventListener('abort', () => clearTimeout(srcTimer));

    fetch('/api/website-conversion?month=' + month, { signal })
      .then(r => r.json())
      .then((data: WebsiteConversionResponse) => {
        if (data?.month && data.month !== month) return;
        setSiteConversion(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } });

    fetch('/api/ga4-channel-revenue?month=' + month, { signal })
      .then(r => r.json())
      .then((data: ChannelRevenueResponse) => {
        if (data?.month && data.month !== month) return;
        setChannelRevenue(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } });

    return () => ac.abort();
  }, [selectedMonth]);

  // Fetch ETZ 12-month trend + Clarity behavioral data once on mount
  useEffect(() => {
    setLoadingEtzTrend(true);
    fetch('/api/etz-trend?months=12')
      .then(r => r.json())
      .then((data: EtzTrendResponse) => setEtzTrend(data))
      .catch(() => setEtzTrend(null))
      .finally(() => setLoadingEtzTrend(false));

    setLoadingClarity(true);
    fetch('/api/etz-clarity')
      .then(r => r.json())
      .then((data: EtzClarityResponse) => setEtzClarity(data))
      .catch(() => setEtzClarity(null))
      .finally(() => setLoadingClarity(false));
  }, []);

  useEffect(() => {
    setLoadingHistory(true);
    Promise.all([
      fetch('/api/revenue-history').then(r => r.json()),
      fetch('/api/google-ads-history').then(r => r.json()),
      fetch('/api/ga4-revenue-history').then(r => r.json()),
    ])
      .then(([revData, gadsData, ga4Data]: [MonthRevHistory[], GoogleAdsHistoryItem[], GA4HistoryItem[]]) => {
        setRevenueHistory(revData);
        setGoogleAdsHistory(gadsData);
        setGa4History(ga4Data);
      })
      .catch(() => { /* ignore */ })
      .finally(() => { setLoadingHistory(false); });
  }, []);

  const ppRecords  = spendForBrandMonth(records, 'Pascal Press',   selectedMonth);
  const etzRecords = spendForBrandMonth(records, 'Excel Test Zone', selectedMonth);

  // Use live Google Ads API spend; fall back to Monday.com if API call failed
  const ppLiveSpend  = googleAdsSpend?.pp.connected  ? googleAdsSpend.pp.spend  : null;
  const etzLiveSpend = googleAdsSpend?.etz.connected ? googleAdsSpend.etz.spend : null;

  const ppSpend = ppLiveSpend !== null && ppLiveSpend !== undefined
    ? ppLiveSpend
    : ppRecords.reduce((s, r) => s + (r.actualSpend ?? 0), 0);

  const etzGoogleSpend = etzLiveSpend !== null && etzLiveSpend !== undefined
    ? etzLiveSpend
    : etzRecords.filter(r => r.channel === 'Google Ads').reduce((s, r) => s + (r.actualSpend ?? 0), 0);

  const ppMetaSpend  = metaCampaigns?.pp?.totals?.spend  ?? 0;
  const etzMetaSpend = metaCampaigns?.etz?.totals?.spend ?? 0;
  const ppTotalSpend  = ppSpend        + ppMetaSpend;
  const etzTotalSpend = etzGoogleSpend + etzMetaSpend;

  const ppRevenue  = revenue?.pp?.totalRevenue  ?? 0;
  const etzRevenue = revenue?.etz?.totalRevenue ?? 0;
  const ppRoas     = ppTotalSpend  > 0 && ppRevenue  > 0 ? ppRevenue  / ppTotalSpend  : null;
  const etzRoas    = etzTotalSpend > 0 && etzRevenue > 0 ? etzRevenue / etzTotalSpend : null;

  // Chart data: prefer live Google Ads history, fall back to Monday.com records
  const ppChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:        CHART_LABELS[i] ?? ym,
    spend:        googleAdsHistory?.find(h => h.month === ym)?.pp
                  ?? spendForBrandMonth(records, 'Pascal Press', ym).reduce((s, r) => s + (r.actualSpend ?? 0), 0),
    revenue:      revenueHistory?.find(h => h.month === ym)?.pp.totalRevenue ?? 0,
    // GA4 paid search revenue preferred; fall back to BC referral_source (usually 0)
    googlePaidRev: ga4History?.find(h => h.month === ym)?.pp.paid
                  ?? revenueHistory?.find(h => h.month === ym)?.pp.googlePaidRevenue
                  ?? 0,
  }));

  const etzChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:        CHART_LABELS[i] ?? ym,
    spend:        googleAdsHistory?.find(h => h.month === ym)?.etz
                  ?? spendForBrandMonth(records, 'Excel Test Zone', ym)
                      .filter(r => r.channel === 'Google Ads')
                      .reduce((s, r) => s + (r.actualSpend ?? 0), 0),
    revenue:      revenueHistory?.find(h => h.month === ym)?.etz.totalRevenue     ?? 0,
    googlePaidRev: ga4History?.find(h => h.month === ym)?.etz?.paid
                  ?? revenueHistory?.find(h => h.month === ym)?.etz.googlePaidRevenue
                  ?? 0,
  }));

  const ppPrev = revenue?.ppPrev ?? null;
  const ppRevRaw = revenue?.pp ?? null;
  const etzRevRaw = revenue?.etz ?? null;

  // Overlay GA4 channel revenue on top of BC's total revenue data.
  // Priority: (1) ga4Revenue direct fetch, (2) ga4History for this month, (3) BC/Stripe referral_source fallback.
  // GA4 is the source of truth for paid vs organic split; BC/Stripe is the source of truth for totals.
  const ga4PaidForMonth    = ga4Revenue?.pp.connected
    ? ga4Revenue.pp.paidSearchRevenue
    : (ga4History?.find(h => h.month === selectedMonth)?.pp.paid ?? null);
  const ga4OrganicForMonth = ga4Revenue?.pp.connected
    ? ga4Revenue.pp.organicSearchRevenue
    : (ga4History?.find(h => h.month === selectedMonth)?.pp.organic ?? null);

  const ppRev: typeof ppRevRaw = ppRevRaw
    ? {
        ...ppRevRaw,
        googlePaidRevenue:    ga4PaidForMonth    ?? ppRevRaw.googlePaidRevenue,
        googleOrganicRevenue: ga4OrganicForMonth ?? ppRevRaw.googleOrganicRevenue,
      }
    : null;

  // ETZ GA4 overlay — same pattern as PP above.
  const etzGa4PaidForMonth    = ga4Revenue?.etz?.connected
    ? ga4Revenue.etz.paidSearchRevenue
    : (ga4History?.find(h => h.month === selectedMonth)?.etz?.paid ?? null);
  const etzGa4OrganicForMonth = ga4Revenue?.etz?.connected
    ? ga4Revenue.etz.organicSearchRevenue
    : (ga4History?.find(h => h.month === selectedMonth)?.etz?.organic ?? null);

  const etzRev: typeof etzRevRaw = etzRevRaw
    ? {
        ...etzRevRaw,
        googlePaidRevenue:    etzGa4PaidForMonth    ?? etzRevRaw.googlePaidRevenue,
        googleOrganicRevenue: etzGa4OrganicForMonth ?? etzRevRaw.googleOrganicRevenue,
      }
    : null;

  const ppCustomerData: CustomerPoint[] = CHART_YMS.map((ym, i) => ({
    label:    CHART_LABELS[i] ?? ym,
    newCusts: revenueHistory?.find(h => h.month === ym)?.pp.newCustomers      ?? 0,
    retCusts: revenueHistory?.find(h => h.month === ym)?.pp.returningCustomers ?? 0,
  }));

  const etzCustomerData: CustomerPoint[] = CHART_YMS.map((ym, i) => ({
    label:    CHART_LABELS[i] ?? ym,
    newCusts: revenueHistory?.find(h => h.month === ym)?.etz.newCustomers      ?? 0,
    retCusts: revenueHistory?.find(h => h.month === ym)?.etz.returningCustomers ?? 0,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between px-4 md:px-6 py-3 gap-y-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          {/* Sub-tab switcher */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1 mr-1">
            {(['overview', 'etz-trials'] as const).map(v => (
              <button
                key={v}
                onClick={() => setFinanceView(v)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  financeView === v
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {v === 'overview' ? 'Overview' : '🧪 ETZ Trials'}
              </button>
            ))}
          </div>
          <label className="text-sm font-medium text-gray-600">Month</label>
          <select
            value={selectedMonth}
            onChange={e => { setSelectedMonth(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {monthOptions().map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {loadingRevenue && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading&hellip;
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSyncGoogleAds}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {syncing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Syncing&hellip;
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                Sync Google Ads
              </>
            )}
          </button>
          {lastSynced != null && (
            <span className="text-xs text-gray-400">
              Synced {new Date(lastSynced).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto">

        {/* ── ETZ Trials view ─────────────────────────────────────────────── */}
        {financeView === 'etz-trials' && (
          <EtzTrialsFullView
            data={etzTrialFunnel}
            loading={loadingEtzTrial}
            month={selectedMonth}
            stripeOrders={revenue?.etz?.totalOrders ?? 0}
            stripeRevenue={revenue?.etz?.totalRevenue ?? 0}
            stripeConnected={revenue?.etz?.connected === true}
            traffic={etzTraffic}
            loadingTraffic={loadingEtzTraffic}
            appTraffic={etzAppTraffic}
            loadingAppTraffic={loadingEtzAppTraffic}
            trend={etzTrend}
            loadingTrend={loadingEtzTrend}
            sources={etzSources}
            loadingSources={loadingEtzSources}
            clarity={etzClarity}
            loadingClarity={loadingClarity}
          />
        )}

        {/* ── Overview view ────────────────────────────────────────────────── */}
        {financeView === 'overview' && <>

        {/* Summary strip */}
        <div className="px-4 md:px-6 pt-4 pb-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
              Summary &middot; {monthLabel(selectedMonth)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Pascal Press &middot; Ad Spend</div>
                  <div className="text-lg font-bold text-gray-900">
                    {ppTotalSpend > 0 ? AUD.format(ppTotalSpend) : '—'}
                  </div>
                </div>
                <div className="text-gray-300 text-xl">&rarr;</div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">BigCommerce Revenue</div>
                  <div className={'text-lg font-bold ' + (revenue?.pp?.connected ? 'text-green-700' : 'text-gray-400')}>
                    {revenue?.pp?.connected === true ? AUD.format(ppRevenue) : '—'}
                  </div>
                </div>
                <div className="text-right min-w-[48px]">
                  <div className="text-xs text-gray-500 mb-0.5">ROAS</div>
                  <div className={'text-lg font-bold ' + (ppRoas !== null ? (ppRoas >= 4 ? 'text-green-700' : ppRoas >= 2 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300')}>
                    {ppRoas !== null ? ppRoas.toFixed(1) + 'x' : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:pl-6 sm:border-l border-gray-100">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Excel Test Zone &middot; Ad Spend</div>
                  <div className="text-lg font-bold text-gray-900">
                    {etzTotalSpend > 0 ? AUD.format(etzTotalSpend) : '—'}
                  </div>
                </div>
                <div className="text-gray-300 text-xl">&rarr;</div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Stripe Revenue</div>
                  <div className={'text-lg font-bold ' + (revenue?.etz?.connected ? 'text-green-700' : 'text-gray-400')}>
                    {revenue?.etz?.connected === true ? AUD.format(etzRevenue) : '—'}
                  </div>
                </div>
                <div className="text-right min-w-[48px]">
                  <div className="text-xs text-gray-500 mb-0.5">ROAS</div>
                  <div className={'text-lg font-bold ' + (etzRoas !== null ? (etzRoas >= 4 ? 'text-green-700' : etzRoas >= 2 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300')}>
                    {etzRoas !== null ? etzRoas.toFixed(1) + 'x' : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Brand panels */}
        <div className="flex flex-col md:flex-row gap-4 px-4 md:px-6 py-4">
          <BrandPanel
            brand="Pascal Press"
            label="Pascal Press"
            color="bg-blue-500"
            accentBg="bg-blue-50"
            accentText="text-blue-900"
            records={records}
            selectedMonth={selectedMonth}
            revenue={ppRev}
            revenueLabel="BigCommerce"
            prevRevenue={ppPrev}
            liveGoogleAdsSpend={ppLiveSpend}
            liveGoogleAdsConnected={googleAdsSpend?.pp.connected}
            websiteConversion={siteConversion?.pp ?? null}
            channelRevenue={channelRevenue?.pp ?? null}
          />
          <BrandPanel
            brand="Excel Test Zone"
            label="Excel Test Zone"
            color="bg-emerald-500"
            accentBg="bg-emerald-50"
            accentText="text-emerald-900"
            records={records}
            selectedMonth={selectedMonth}
            revenue={etzRev}
            revenueLabel="Stripe"
            prevRevenue={null}
            liveGoogleAdsSpend={etzLiveSpend}
            liveGoogleAdsConnected={googleAdsSpend?.etz.connected}
            websiteConversion={siteConversion?.etz ?? null}
            channelRevenue={channelRevenue?.etz ?? null}
          />
        </div>

        {/* Campaign-level Ads spend + GA4 revenue */}
        <CampaignBreakdownTable
          googleData={campaigns}        loadingGoogle={loadingCampaigns}
          metaData={metaCampaigns}      loadingMeta={loadingMetaCampaigns}
        />

        {/* Line charts — FY26 Jan–Jun */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Pascal Press &middot; FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:12, height:10, background:'#3b82f6', borderRadius:2, opacity:0.8 }} />
                Ad Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display:'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#2563eb" strokeWidth="2.5" />
                </svg>
                Google Paid Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display:'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
                Total Revenue
              </span>
              <span className="text-gray-400 italic">bar label = ROAS</span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <SpendRevenueChart data={ppChartData} spendColor="#3b82f6" googlePaidColor="#2563eb" totalRevColor="#10b981" />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Excel Test Zone &middot; FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:12, height:10, background:'#10b981', borderRadius:2, opacity:0.8 }} />
                Ad Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display:'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
                Total Revenue
              </span>
              <span className="text-gray-400 italic">bar label = ROAS</span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <SpendRevenueChart data={etzChartData} spendColor="#10b981" totalRevColor="#10b981" />
            )}
          </div>
        </div>

        {/* New vs Returning customer charts — FY26 Jan–Jun */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Pascal Press &middot; New vs Returning FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#3b82f6" strokeWidth="2" />
                </svg>
                New
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="5 3" />
                </svg>
                Returning
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <CustomerTrendChart data={ppCustomerData} newColor="#3b82f6" retColor="#8b5cf6" />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Excel Test Zone &middot; New vs Returning FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#10b981" strokeWidth="2" />
                </svg>
                New
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="5 3" />
                </svg>
                Returning
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <CustomerTrendChart data={etzCustomerData} newColor="#10b981" retColor="#8b5cf6" />
            )}
          </div>
        </div>

        {/* Monthly budget breakdown — FY26 Jan–Jun */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-blue-50 border-b border-gray-200">
              <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
                Pascal Press &middot; Budget vs Spend by Month
              </div>
              <div className="text-xs text-blue-700 mt-0.5">Google Ads budget: {AUD.format(MONTHLY_GOOGLE_BUDGETS['Pascal Press'] ?? 0)}/mo</div>
            </div>
            <BudgetBreakdownTable
              brand="Pascal Press"
              records={records}
              accentBg="bg-blue-50"
              accentText="text-blue-800"
            />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-emerald-50 border-b border-gray-200">
              <div className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">
                Excel Test Zone &middot; Budget vs Spend by Month
              </div>
              <div className="text-xs text-emerald-700 mt-0.5">Google Ads budget: {AUD.format(MONTHLY_GOOGLE_BUDGETS['Excel Test Zone'] ?? 0)}/mo</div>
            </div>
            <BudgetBreakdownTable
              brand="Excel Test Zone"
              records={records}
              accentBg="bg-emerald-50"
              accentText="text-emerald-800"
            />
          </div>
        </div>

        </> /* end overview */}

      </div>
    </div>
  );
}
