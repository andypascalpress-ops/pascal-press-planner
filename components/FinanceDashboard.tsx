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
}

function BrandPanel({
  brand, label, color, accentBg, accentText,
  records, selectedMonth, revenue, revenueLabel, prevRevenue,
  liveGoogleAdsSpend, liveGoogleAdsConnected,
  websiteConversion,
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

  const googlePaidRev    = revenue?.googlePaidRevenue    ?? 0;
  const googleOrganicRev = revenue?.googleOrganicRevenue ?? 0;

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

function CampaignBreakdownTable({ data, loading }: { data: CampaignsResponse | null; loading: boolean }) {
  const [tab, setTab] = useState<'pp' | 'etz' | 'hsc'>('pp');
  const brand = data?.[tab];
  const tabs: { key: 'pp' | 'etz' | 'hsc'; label: string }[] = [
    { key: 'pp',  label: 'Pascal Press' },
    { key: 'etz', label: 'Excel Test Zone' },
    { key: 'hsc', label: 'Excel HSC Copilot' },
  ];

  return (
    <div className="px-4 md:px-6 pb-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Google Ads Campaigns</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Spend from Google Ads · Revenue from Google Analytics (paid sessions)
            </p>
          </div>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.key ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading campaigns…</div>
        )}

        {!loading && brand && (
          <>
            {/* Totals strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-5 py-3 bg-gray-50 border-b border-gray-100">
              <div>
                <div className="text-xs text-gray-500">Total spend</div>
                <div className="text-base font-bold text-gray-900">
                  {brand.totals.spend > 0 ? AUD.format(brand.totals.spend) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">GA revenue (paid)</div>
                <div className="text-base font-bold text-blue-700">
                  {brand.gaConnected
                    ? (brand.totals.gaRevenue > 0 ? AUD.format(brand.totals.gaRevenue) : '$0')
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">GA ROAS</div>
                <div className={`text-base font-bold ${
                  brand.totals.gaRoas >= 4 ? 'text-green-700'
                  : brand.totals.gaRoas >= 2 ? 'text-yellow-600'
                  : brand.totals.gaRoas > 0 ? 'text-red-600' : 'text-gray-400'
                }`}>
                  {brand.totals.gaRoas > 0 ? `${brand.totals.gaRoas.toFixed(1)}x` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Clicks</div>
                <div className="text-base font-bold text-gray-900">
                  {brand.totals.clicks > 0 ? brand.totals.clicks.toLocaleString() : '—'}
                </div>
              </div>
            </div>

            {!brand.adsConnected && brand.campaigns.length === 0 && (
              <div className="px-5 py-6 text-sm text-gray-400 italic">
                {brand.error ? `Could not load Google Ads: ${brand.error}` : 'No Google Ads data for this brand/month'}
              </div>
            )}

            {brand.campaigns.length > 0 && (
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
                    {brand.campaigns.map((c) => (
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
                            {!c.gaMatched && c.spend > 0 && brand.gaConnected && (
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
                          {brand.gaConnected
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

            {tab === 'hsc' && !brand.gaConnected && brand.campaigns.length > 0 && (
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                HSC has no GA4 property connected yet — showing Google Ads spend only.
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
  const [campaigns,        setCampaigns       ] = useState<CampaignsResponse | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [siteConversion,   setSiteConversion  ] = useState<WebsiteConversionResponse | null>(null);

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
    setSiteConversion(null);

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

    fetch('/api/website-conversion?month=' + month, { signal })
      .then(r => r.json())
      .then((data: WebsiteConversionResponse) => {
        if (data?.month && data.month !== month) return;
        setSiteConversion(data);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { /* ignore */ } });

    return () => ac.abort();
  }, [selectedMonth]);

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

  const ppRevenue  = revenue?.pp?.totalRevenue  ?? 0;
  const etzRevenue = revenue?.etz?.totalRevenue ?? 0;
  const ppRoas     = ppSpend        > 0 && ppRevenue  > 0 ? ppRevenue  / ppSpend        : null;
  const etzRoas    = etzGoogleSpend > 0 && etzRevenue > 0 ? etzRevenue / etzGoogleSpend : null;

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

        {/* Summary strip */}
        <div className="px-4 md:px-6 pt-4 pb-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
              Summary &middot; {monthLabel(selectedMonth)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Pascal Press &middot; Total Spend</div>
                  <div className="text-lg font-bold text-gray-900">
                    {ppSpend > 0 ? AUD.format(ppSpend) : '—'}
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
                  <div className="text-xs text-gray-500 mb-0.5">Excel Test Zone &middot; Google Ads</div>
                  <div className="text-lg font-bold text-gray-900">
                    {etzGoogleSpend > 0 ? AUD.format(etzGoogleSpend) : '—'}
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
          />
        </div>

        {/* Campaign-level Ads spend + GA4 revenue */}
        <CampaignBreakdownTable data={campaigns} loading={loadingCampaigns} />

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

      </div>
    </div>
  );
}
