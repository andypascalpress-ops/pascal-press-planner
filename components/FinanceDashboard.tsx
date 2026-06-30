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
  revenue: number;
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

const CHART_YMS    = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const CHART_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentYearMonth(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
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

// ─── Line chart ──────────────────────────────────────────────────────────────

function SpendRevenueChart({
  data,
  spendColor,
  revenueColor,
}: {
  data: ChartPoint[];
  spendColor: string;
  revenueColor: string;
}) {
  const W   = 400;
  const H   = 160;
  const PAD = { t: 12, r: 16, b: 28, l: 52 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const n   = data.length;
  if (n < 2) return null;

  const allVals    = data.flatMap(d => [d.spend, d.revenue]);
  const maxVal     = Math.max(...allVals, 1);
  const hasRevenue = data.some(d => d.revenue > 0);

  const px = (i: number): number => PAD.l + (i / (n - 1)) * cW;
  const py = (v: number): number => PAD.t + cH - (Math.max(0, v) / maxVal) * cH;

  const toPath = (vals: number[]): string =>
    vals.map((v, i) => (i === 0 ? 'M' : 'L') + ' ' + px(i).toFixed(1) + ' ' + py(v).toFixed(1)).join(' ');

  const spendPath = toPath(data.map(d => d.spend));
  const revPath   = toPath(data.map(d => d.revenue));

  const ticks = Array.from({ length: 4 }, (_, i) => {
    const v = (maxVal / 3) * i;
    return { value: v, y: py(v) };
  });

  const fmt = (v: number): string =>
    v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + v.toFixed(0);

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y.toFixed(1)} x2={W - PAD.r} y2={t.y.toFixed(1)}
            stroke="#f3f4f6" strokeWidth="1" />
          <text x={PAD.l - 4} y={t.y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
            {fmt(t.value)}
          </text>
        </g>
      ))}
      {hasRevenue && (
        <path d={revPath} fill="none" stroke={revenueColor} strokeWidth="2"
          strokeLinejoin="round" strokeDasharray="5 3" />
      )}
      <path d={spendPath} fill="none" stroke={spendColor} strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          {d.spend > 0 && (
            <circle cx={px(i).toFixed(1)} cy={py(d.spend).toFixed(1)} r="3" fill={spendColor} />
          )}
          {hasRevenue && d.revenue > 0 && (
            <circle cx={px(i).toFixed(1)} cy={py(d.revenue).toFixed(1)} r="3" fill={revenueColor} />
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
}

function BrandPanel({
  brand, label, color, accentBg, accentText,
  records, selectedMonth, revenue, revenueLabel, prevRevenue,
}: BrandPanelProps) {
  const monthRecords = spendForBrandMonth(records, brand, selectedMonth);
  const annualBudget = (ANNUAL_BUDGETS as Record<string, number>)[brand] ?? 0;

  const totalSpend  = monthRecords.reduce((s, r) => s + (r.actualSpend ?? 0), 0);
  const totalBudget = monthRecords.reduce((s, r) => s + effectiveBudget(r), 0);

  // Channel breakdown — Meta Ads excluded
  const byChannel: Record<string, number> = {};
  for (const r of monthRecords) {
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + (r.actualSpend ?? 0);
  }
  const channelEntries = Object.entries(byChannel)
    .filter(([ch, v]) => v > 0 && ch !== 'Meta Ads')
    .sort(([, a], [, b]) => b - a);

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

  const roas       = totalSpend > 0 && rev > 0 ? rev / totalSpend : null;
  const googleRoas = googleSpend > 0 && rev > 0 ? rev / googleSpend : null;
  const aov        = orders > 0 && rev > 0 ? rev / orders : null;
  const cac        = totalSpend > 0 && newCusts > 0 ? totalSpend / newCusts : null;
  const retRate    = totalCusts > 0 ? Math.round((retCusts / totalCusts) * 100) : null;
  const prevRoas   = totalSpend > 0 && prevRev > 0 ? prevRev / totalSpend : null;

  const isConnected = revenue?.connected === true;

  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className={accentBg + ' px-5 py-3 border-b border-gray-200'}>
        <h2 className={'text-base font-bold ' + accentText}>{label}</h2>
        <div className="text-xs text-gray-500 mt-0.5">Annual budget: {AUD.format(annualBudget)}</div>
      </div>

      <div className="divide-y divide-gray-100">

        {/* ── Ad Spend ── */}
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Ad Spend</div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900">
              {totalSpend > 0 ? AUD.format(totalSpend) : '—'}
            </span>
            {totalBudget > 0 && (
              <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (totalSpend > totalBudget ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700')}>
                {((totalSpend / totalBudget) * 100).toFixed(0)}% of budget
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
                const isOver = chBudget > 0 && amt > chBudget;
                return (
                  <div key={ch} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      {ch}
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

        {/* ── Revenue ── */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Revenue</div>
            <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + (isConnected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400')}>
              {isConnected ? revenueLabel : revenueLabel + ' · not connected'}
            </span>
          </div>
          {isConnected ? (
            <>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-2xl font-bold text-green-700">{AUD.format(rev)}</span>
                <span className="text-sm text-gray-500">{orders} orders</span>
              </div>
              {prevRev > 0 && (
                <div className="flex items-center gap-1.5 mb-3">
                  <Delta current={rev} prev={prevRev} />
                  <span className="text-xs text-gray-400">vs last month</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {aov !== null && (
                  <MetricTile label="Avg Order Value" value={AUD.format(aov)} color="text-blue-700" />
                )}
                {roas !== null && (
                  <MetricTile
                    label="ROAS"
                    value={roas.toFixed(1) + 'x'}
                    color={roas >= 4 ? 'text-green-700' : roas >= 2 ? 'text-yellow-600' : 'text-red-600'}
                    delta={prevRoas !== null ? { current: roas, prev: prevRoas } : undefined}
                  />
                )}
                {googleRoas !== null && (
                  <MetricTile
                    label="Google ROAS"
                    value={googleRoas.toFixed(1) + 'x'}
                    color={googleRoas >= 4 ? 'text-green-700' : googleRoas >= 2 ? 'text-yellow-600' : 'text-red-600'}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 italic">Connect {revenueLabel} to see revenue</div>
          )}
        </div>

        {/* ── Customers ── */}
        {isConnected && totalCusts > 0 && (
          <div className="px-5 py-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Customers</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-700">{newCusts}</div>
                {prevRevenue?.connected === true && prevNewCusts > 0 && (
                  <div className="flex justify-center mt-0.5">
                    <Delta current={newCusts} prev={prevNewCusts} />
                  </div>
                )}
                <div className="text-xs text-blue-500 mt-0.5">New</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-700">{retCusts}</div>
                {prevRevenue?.connected === true && prevRetCusts > 0 && (
                  <div className="flex justify-center mt-0.5">
                    <Delta current={retCusts} prev={prevRetCusts} />
                  </div>
                )}
                <div className="text-xs text-purple-500 mt-0.5">Returning</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cac !== null && (
                <MetricTile
                  label="Cost per Acquisition"
                  value={AUD.format(cac)}
                  sub="per new customer"
                  color="text-orange-600"
                />
              )}
              {retRate !== null && (
                <MetricTile
                  label="Retention Rate"
                  value={retRate + '%'}
                  sub="returning"
                  color={retRate >= 40 ? 'text-green-700' : 'text-yellow-600'}
                />
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Monthly budget breakdown table ──────────────────────────────────────────

const FY26_YMS = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];

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
    <div className="overflow-x-auto">
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
                    {totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) + '%' : '—'}
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
                        {pct !== null ? pct + '%' : '—'}
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

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function FinanceDashboard({ records, syncing, lastSynced, onSyncGoogleAds }: Props) {
  const [selectedMonth,  setSelectedMonth ] = useState<string>(currentYearMonth());
  const [revenue,        setRevenue       ] = useState<RevenueResponse | null>(null);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [revenueHistory, setRevenueHistory] = useState<MonthRevHistory[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setLoadingRevenue(true);
    fetch('/api/revenue?month=' + selectedMonth)
      .then(r => r.json())
      .then((data: RevenueResponse) => { setRevenue(data); })
      .catch(() => { /* ignore */ })
      .finally(() => { setLoadingRevenue(false); });
  }, [selectedMonth]);

  useEffect(() => {
    setLoadingHistory(true);
    fetch('/api/revenue-history')
      .then(r => r.json())
      .then((data: MonthRevHistory[]) => { setRevenueHistory(data); })
      .catch(() => { /* ignore */ })
      .finally(() => { setLoadingHistory(false); });
  }, []);

  const ppRecords      = spendForBrandMonth(records, 'Pascal Press',    selectedMonth);
  const etzRecords     = spendForBrandMonth(records, 'Excel Test Zone',  selectedMonth);
  const ppSpend        = ppRecords.reduce((s, r)  => s + (r.actualSpend ?? 0), 0);
  const etzGoogleSpend = etzRecords
    .filter(r => r.channel === 'Google Ads')
    .reduce((s, r) => s + (r.actualSpend ?? 0), 0);
  const ppRevenue  = revenue?.pp?.totalRevenue  ?? 0;
  const etzRevenue = revenue?.etz?.totalRevenue ?? 0;
  const ppRoas     = ppSpend        > 0 && ppRevenue  > 0 ? ppRevenue  / ppSpend        : null;
  const etzRoas    = etzGoogleSpend > 0 && etzRevenue > 0 ? etzRevenue / etzGoogleSpend : null;

  const ppChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:   CHART_LABELS[i] ?? ym,
    spend:   spendForBrandMonth(records, 'Pascal Press', ym)
               .reduce((s, r) => s + (r.actualSpend ?? 0), 0),
    revenue: revenueHistory?.find(h => h.month === ym)?.pp.totalRevenue ?? 0,
  }));

  const etzChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:   CHART_LABELS[i] ?? ym,
    spend:   spendForBrandMonth(records, 'Excel Test Zone', ym)
               .filter(r => r.channel === 'Google Ads')
               .reduce((s, r) => s + (r.actualSpend ?? 0), 0),
    revenue: revenueHistory?.find(h => h.month === ym)?.etz.totalRevenue ?? 0,
  }));

  const ppPrev = revenue?.ppPrev ?? null;
  const ppRev  = revenue?.pp     ?? null;
  const etzRev = revenue?.etz    ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

      {/* Controls bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
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
        <div className="px-6 pt-4 pb-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
              Summary &middot; {monthLabel(selectedMonth)}
            </div>
            <div className="grid grid-cols-2 gap-6">
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
              <div className="flex items-center gap-4 pl-6 border-l border-gray-100">
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
        <div className="flex gap-4 px-6 py-4">
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
          />
        </div>

        {/* Line charts — FY26 Jan–Jun */}
        <div className="grid grid-cols-2 gap-4 px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Pascal Press &middot; FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#3b82f6" strokeWidth="2" />
                </svg>
                Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
                Revenue
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <SpendRevenueChart data={ppChartData} spendColor="#3b82f6" revenueColor="#22c55e" />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Excel Test Zone &middot; FY26 Jan&ndash;Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#10b981" strokeWidth="2" />
                </svg>
                Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
                Revenue
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading&hellip;</div>
            ) : (
              <SpendRevenueChart data={etzChartData} spendColor="#10b981" revenueColor="#22c55e" />
            )}
          </div>
        </div>

        {/* Monthly budget breakdown — FY26 Jan–Jun */}
        <div className="grid grid-cols-2 gap-4 px-6 pb-6">
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
