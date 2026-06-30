'use client';

import { useState, useEffect } from 'react';
import { SpendRecord } from '@/lib/types';
import { ANNUAL_BUDGETS } from '@/lib/constants';
import { RevenueData } from '@/lib/bigcommerce-revenue';

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

interface Props {
  records: SpendRecord[];
  syncing: boolean;
  lastSynced?: string;
  onSyncGoogleAds: () => void;
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const CHART_YMS    = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
const CHART_LABELS = ['Jan','Feb','Mar','Apr','May','Jun'];

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
}

function monthOptions(): { value: string; label: string }[] {
  const opts = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ value: val, label: monthLabel(val) });
  }
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  opts.push({
    value: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`,
    label: monthLabel(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`),
  });
  return opts;
}

function spendForBrandMonth(records: SpendRecord[], brand: string, ym: string): SpendRecord[] {
  const [year, mon] = ym.split('-').map(Number);
  const monthName = MONTH_NAMES[mon - 1];
  const fyYear = mon >= 7 ? year + 1 : year;
  const fy = `FY${String(fyYear).slice(-2)}`;
  return records.filter(r => r.brand === brand && r.month === monthName && r.fy === fy);
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const over = max > 0 && value > max;
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div
        className={`h-1.5 rounded-full transition-all ${over ? 'bg-red-500' : color}`}
        style={{ width: `${pct}%` }}
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
    <div className={`text-xs font-medium mt-0.5 ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'} {pct}% vs last mo
    </div>
  );
}

// ─── Line chart ────────────────────────────────────────────────────────────────

interface ChartPoint {
  label: string;
  spend: number;
  revenue: number;
}

function SpendRevenueChart({
  data,
  spendColor,
  revenueColor,
}: {
  data: ChartPoint[];
  spendColor: string;
  revenueColor: string;
}) {
  const W = 400;
  const H = 160;
  const PAD = { t: 12, r: 16, b: 28, l: 52 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const n   = data.length;
  if (n < 2) return null;

  const maxVal     = Math.max(...data.flatMap(d => [d.spend, d.revenue]), 1);
  const hasRevenue = data.some(d => d.revenue > 0);

  const px = (i: number) => PAD.l + (i / (n - 1)) * cW;
  const py = (v: number) => PAD.t + cH - (Math.max(0, v) / maxVal) * cH;

  const toPath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');

  const spendPath = toPath(data.map(d => d.spend));
  const revPath   = toPath(data.map(d => d.revenue));

  const TICK_COUNT = 3;
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const v = (maxVal / TICK_COUNT) * i;
    return { value: v, y: py(v) };
  });

  const fmt = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={PAD.l} y1={t.y.toFixed(1)}
            x2={W - PAD.r} y2={t.y.toFixed(1)}
            stroke="#f3f4f6" strokeWidth="1"
          />
          <text x={PAD.l - 4} y={t.y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
            {fmt(t.value)}
          </text>
        </g>
      ))}

      {hasRevenue && (
        <path
          d={revPath}
          fill="none"
          stroke={revenueColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeDasharray="5 3"
        />
      )}

      <path
        d={spendPath}
        fill="none"
        stroke={spendColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {data.map((d, i) => (
        <g key={i}>
          {d.spend > 0 && (
            <circle cx={px(i)} cy={py(d.spend)} r={3} fill={spendColor} />
          )}
          {hasRevenue && d.revenue > 0 && (
            <circle cx={px(i)} cy={py(d.revenue)} r={3} fill={revenueColor} />
          )}
          <text x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Brand panel ───────────────────────────────────────────────────────────────

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
  prevRevenue?: RevenueData | null;
}

function BrandPanel({
  brand, label, color, accentBg, accentText,
  records, selectedMonth, revenue, revenueLabel, prevRevenue,
}: BrandPanelProps) {
  const monthRecords = spendForBrandMonth(records, brand, selectedMonth);
  const annualBudget = ANNUAL_BUDGETS[brand] ?? 0;

  const totalSpend  = monthRecords.reduce((s, r) => s + (r.actualSpend || 0), 0);
  const totalBudget = monthRecords.reduce((s, r) => s + (r.budget || 0), 0);

  // Channel breakdown — Meta Ads excluded
  const byChannel: Record<string, number> = {};
  for (const r of monthRecords) {
    byChannel[r.channel] = (byChannel[r.channel] || 0) + (r.actualSpend || 0);
  }
  const channelEntries = Object.entries(byChannel)
    .filter(([ch, v]) => v > 0 && ch !== 'Meta Ads')
    .sort(([, a], [, b]) => b - a);

  const googleSpend = byChannel['Google Ads'] || 0;
  const rev         = revenue?.totalRevenue ?? 0;
  const roas        = totalSpend > 0 && rev > 0 ? rev / totalSpend : null;
  const googleRoas  = googleSpend > 0 && rev > 0 ? rev / googleSpend : null;

  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className={`${accentBg} px-5 py-3 border-b border-gray-200`}>
        <h2 className={`text-base font-bold ${accentText}`}>{label}</h2>
        <div className="text-xs text-gray-500 mt-0.5">Annual budget: {AUD.format(annualBudget)}</div>
      </div>

      <div className="divide-y divide-gray-100">
        {/* Ad Spend */}
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Ad Spend</div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900">
              {totalSpend > 0 ? AUD.format(totalSpend) : '—'}
            </span>
            {totalBudget > 0 && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${totalSpend > totalBudget ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                {`${((totalSpend / totalBudget) * 100).toFixed(0)}% of budget`}
              </span>
            )}
          </div>
          {totalBudget > 0 && <ProgressBar value={totalSpend} max={totalBudget} color={color} />}
          {channelEntries.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {channelEntries.map(([ch, amt]) => (
                <div key={ch} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{ch}</span>
                  <span className="font-medium text-gray-900">{AUD.format(amt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-400 italic">No spend recorded for this month</div>
          )}
        </div>

        {/* Revenue */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Revenue</div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${revenue?.connected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {revenue?.connected ? revenueLabel : `${revenueLabel} · not connected`}
            </span>
          </div>
          {revenue?.connected ? (
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-bold text-green-700">{AUD.format(revenue.totalRevenue)}</span>
              <span className="text-sm text-gray-500">{revenue.totalOrders} orders</span>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">Connect {revenueLabel} to see revenue</div>
          )}
        </div>

        {/* Customers */}
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Customers</div>
          {revenue?.connected ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-700">{revenue.newCustomers}</div>
                {prevRevenue?.connected && (
                  <Delta current={revenue.newCustomers} prev={prevRevenue.newCustomers} />
                )}
                <div className="text-xs text-blue-500 mt-0.5">New</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-700">{revenue.returningCustomers}</div>
                {prevRevenue?.connected && (
                  <Delta current={revenue.returningCustomers} prev={prevRevenue.returningCustomers} />
                )}
                <div className="text-xs text-purple-500 mt-0.5">Returning</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">No data yet</div>
          )}
        </div>

        {/* ROAS */}
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Return on Ad Spend</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Overall ROAS</div>
              {roas !== null ? (
                <div className={`text-xl font-bold ${roas >= 3 ? 'text-green-700' : roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {roas.toFixed(1)}x
                </div>
              ) : <div className="text-xl font-bold text-gray-300">—</div>}
            </div>
            {googleSpend > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Google Ads ROAS</div>
                {googleRoas !== null ? (
                  <div className={`text-xl font-bold ${googleRoas >= 3 ? 'text-green-700' : googleRoas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {googleRoas.toFixed(1)}x
                  </div>
                ) : <div className="text-xl font-bold text-gray-300">—</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

export default function FinanceDashboard({ records, syncing, lastSynced, onSyncGoogleAds }: Props) {
  const [selectedMonth,  setSelectedMonth ] = useState(currentYearMonth);
  const [revenue,        setRevenue       ] = useState<RevenueResponse | null>(null);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [revenueHistory, setRevenueHistory] = useState<MonthRevHistory[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch current + previous month revenue
  useEffect(() => {
    setLoadingRevenue(true);
    fetch(`/api/revenue?month=${selectedMonth}`)
      .then(r => r.json())
      .then(data => setRevenue(data))
      .catch(() => {})
      .finally(() => setLoadingRevenue(false));
  }, [selectedMonth]);

  // Fetch FY26 Jan–Jun history once on mount
  useEffect(() => {
    setLoadingHistory(true);
    fetch('/api/revenue-history')
      .then(r => r.json())
      .then((data: MonthRevHistory[]) => setRevenueHistory(data))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, []);

  // Summary numbers
  const ppMonth        = spendForBrandMonth(records, 'Pascal Press', selectedMonth);
  const etzMonth       = spendForBrandMonth(records, 'Excel Test Zone', selectedMonth);
  const ppSpend        = ppMonth.reduce((s, r) => s + (r.actualSpend || 0), 0);
  const etzGoogleSpend = etzMonth.filter(r => r.channel === 'Google Ads').reduce((s, r) => s + (r.actualSpend || 0), 0);
  const ppRevenue      = revenue?.pp?.totalRevenue  ?? 0;
  const etzRevenue     = revenue?.etz?.totalRevenue ?? 0;
  const ppRoas         = ppSpend        > 0 && ppRevenue  > 0 ? ppRevenue  / ppSpend        : null;
  const etzRoas        = etzGoogleSpend > 0 && etzRevenue > 0 ? etzRevenue / etzGoogleSpend : null;

  // Chart data
  const ppChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:   CHART_LABELS[i],
    spend:   spendForBrandMonth(records, 'Pascal Press', ym)
               .reduce((s, r) => s + (r.actualSpend || 0), 0),
    revenue: revenueHistory?.find(h => h.month === ym)?.pp.totalRevenue ?? 0,
  }));

  const etzChartData: ChartPoint[] = CHART_YMS.map((ym, i) => ({
    label:   CHART_LABELS[i],
    spend:   spendForBrandMonth(records, 'Excel Test Zone', ym)
               .filter(r => r.channel === 'Google Ads')
               .reduce((s, r) => s + (r.actualSpend || 0), 0),
    revenue: revenueHistory?.find(h => h.month === ym)?.etz.totalRevenue ?? 0,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600">Month</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {monthOptions().map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {loadingRevenue && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Loading…
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
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
                </svg>
                Sync Google Ads
              </>
            )}
          </button>
          {lastSynced && (
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
              Summary · {monthLabel(selectedMonth)}
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Pascal Press · Total Spend</div>
                  <div className="text-lg font-bold text-gray-900">{ppSpend > 0 ? AUD.format(ppSpend) : '—'}</div>
                </div>
                <div className="text-gray-300 text-xl">→</div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">BigCommerce Revenue</div>
                  <div className={`text-lg font-bold ${revenue?.pp?.connected ? 'text-green-700' : 'text-gray-400'}`}>
                    {revenue?.pp?.connected ? AUD.format(ppRevenue) : '—'}
                  </div>
                </div>
                <div className="text-right min-w-12">
                  <div className="text-xs text-gray-500 mb-0.5">ROAS</div>
                  <div className={`text-lg font-bold ${ppRoas !== null ? (ppRoas >= 3 ? 'text-green-700' : ppRoas >= 1 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300'}`}>
                    {ppRoas !== null ? `${ppRoas.toFixed(1)}x` : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 pl-6 border-l border-gray-100">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Excel Test Zone · Google Ads</div>
                  <div className="text-lg font-bold text-gray-900">{etzGoogleSpend > 0 ? AUD.format(etzGoogleSpend) : '—'}</div>
                </div>
                <div className="text-gray-300 text-xl">→</div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-0.5">Stripe Revenue</div>
                  <div className={`text-lg font-bold ${revenue?.etz?.connected ? 'text-green-700' : 'text-gray-400'}`}>
                    {revenue?.etz?.connected ? AUD.format(etzRevenue) : '—'}
                  </div>
                </div>
                <div className="text-right min-w-12">
                  <div className="text-xs text-gray-500 mb-0.5">ROAS</div>
                  <div className={`text-lg font-bold ${etzRoas !== null ? (etzRoas >= 3 ? 'text-green-700' : etzRoas >= 1 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-300'}`}>
                    {etzRoas !== null ? `${etzRoas.toFixed(1)}x` : '—'}
                  </div>       </div>
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
            revenue={revenue?.pp ?? null}
            revenueLabel="BigCommerce"
            prevRevenue={revenue?.ppPrev ?? null}
          />
          <BrandPanel
            brand="Excel Test Zone"
            label="Excel Test Zone"
            color="bg-emerald-500"
            accentBg="bg-emerald-50"
            accentText="text-emerald-900"
            records={records}
            selectedMonth={selectedMonth}
            revenue={revenue?.etz ?? null}
            revenueLabel="Stripe"
          />
        </div>

        {/* Line charts — FY26 Jan–Jun */}
        <div className="grid grid-cols-2 gap-4 px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Pascal Press · FY26 Jan–Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#3b82f6" strokeWidth="2"/>
                </svg>
                Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 2"/>
                </svg>
                Revenue
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading…</div>
            ) : (
              <SpendRevenueChart data={ppChartData} spendColor="#3b82f6" revenueColor="#22c55e" />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Excel Test Zone · FY26 Jan–Jun
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#10b981" strokeWidth="2"/>
                </svg>
                Spend
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="4" style={{ display: 'inline' }}>
                  <line x1="0" y1="2" x2="16" y2="2" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 2"/>
                </svg>
                Revenue
              </span>
            </div>
            {loadingHistory ? (
              <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading…</div>
            ) : (
              <SpendRevenueChart data={etzChartData} spendColor="#10b981" revenueColor="#22c55e" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
