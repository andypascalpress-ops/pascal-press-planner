'use client';

import { useState, useEffect } from 'react';

type SortKey = 'sentAt' | 'sends' | 'opens' | 'openRate' | 'clicks' | 'clickRate' | 'revenue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailCampaign {
  id:           string;
  name:         string;
  subject:      string;
  fromName:     string;
  sentAt:       string | null;
  sends:        number;
  delivered:    number;
  opens:        number;
  clicks:       number;
  unsubscribes: number;
  openRate:     number;
  clickRate:    number;
  clickToOpen:  number;
}

interface EmailData {
  month:        string | null;
  campaigns:    EmailCampaign[];
  connected:    boolean;
  totalSends:   number;
  totalOpens:   number;
  totalClicks:  number;
  avgOpenRate:  number;
  avgClickRate: number;
}

interface CampaignRevenue {
  campaignName: string;
  revenue:      number;
  transactions: number;
}

interface RevenueData {
  byCampaign:   CampaignRevenue[];
  totalRevenue: number;
  totalTx:      number;
  connected:    boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmt(n: number): string {
  return n.toLocaleString('en-AU');
}

function fmtAUD(n: number): string {
  if (n === 0) return '—';
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function monthLabel(ym: string): string {
  if (!ym) return 'All time';
  const [y, m] = ym.split('-');
  return (MONTH_NAMES[parseInt(m ?? '1') - 1] ?? '') + ' ' + y;
}

function buildMonthOptions(): string[] {
  const opts: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 48; i++) {
    opts.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d.setMonth(d.getMonth() - 1);
  }
  return opts;
}

function sentDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Normalise a name: lowercase, spaces/hyphens → underscores, strip special chars */
function normName(s: string): string {
  return s.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Strip the leading numeric prefix HubSpot adds to utm_campaign values.
 * e.g. "28676354-PP_5735_Black Friday" → "PP_5735_Black Friday"
 */
function stripNumericPrefix(s: string): string {
  return s.replace(/^\d+[-_]/, '');
}

/**
 * Build a revenue lookup map from GA4 data.
 * Keys: normalised base name (numeric prefix stripped) AND full normalised name.
 * GA4 campaign "28676354-PP_5735_Black Friday" covers ALL emails named PP_5735_*
 */
function buildRevenueMap(byCampaign: CampaignRevenue[]): Map<string, CampaignRevenue> {
  const map = new Map<string, CampaignRevenue>();
  for (const c of byCampaign) {
    const base = stripNumericPrefix(c.campaignName);
    map.set(normName(base), c);
    map.set(normName(c.campaignName), c);
  }
  return map;
}

/**
 * Look up revenue for a HubSpot email name against the GA4 map.
 * Handles: HubSpot email "PP_5735_Black Friday_Reminder 3" matching GA4 "PP_5735_Black Friday"
 * because the email name STARTS WITH the campaign base name.
 */
function lookupRevenue(
  emailName:  string,
  revenueMap: Map<string, CampaignRevenue>,
): CampaignRevenue | null {
  const target = normName(emailName);

  // 1. Exact match
  if (revenueMap.has(target)) return revenueMap.get(target)!;

  // 2. Email name starts with GA4 campaign name (email is a variant of the campaign)
  for (const [key, val] of revenueMap) {
    if (key.length > 5 && (target.startsWith(key + '_') || target === key)) return val;
  }

  // 3. Fallback: substring containment
  for (const [key, val] of revenueMap) {
    if (key.length > 8 && (key.includes(target) || target.includes(key))) return val;
  }

  return null;
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Rate bar ────────────────────────────────────────────────────────────────

function RateBar({ value, color }: { value: number; color: string }) {
  const w = Math.min(value * 100, 100).toFixed(1);
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function EmailTab() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [showAll,       setShowAll]       = useState(false);
  const [data,          setData]          = useState<EmailData | null>(null);
  const [revenueData,   setRevenueData]   = useState<RevenueData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [sortKey,       setSortKey]       = useState<SortKey>('sentAt');
  const [sortDir,       setSortDir]       = useState<'asc' | 'desc'>('desc');

  const monthOptions = buildMonthOptions();

  // Fetch HubSpot email data
  useEffect(() => {
    setLoading(true);
    setData(null);
    const url = selectedMonth
      ? `/api/hubspot-email?month=${selectedMonth}`
      : '/api/hubspot-email';
    fetch(url)
      .then(r => r.json())
      .then((d: EmailData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  // Fetch GA4 revenue data — scoped to the selected month if set
  useEffect(() => {
    let start = '2022-01-01';
    let end   = 'today';
    if (selectedMonth) {
      const [y, m] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      start = `${selectedMonth}-01`;
      end   = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    }
    fetch(`/api/ga-email-revenue?start=${start}&end=${end}`)
      .then(r => r.json())
      .then((d: RevenueData) => setRevenueData(d))
      .catch(() => setRevenueData(null));
  }, [selectedMonth]);

  const campaigns   = data?.campaigns ?? [];
  const revenueMap  = buildRevenueMap(revenueData?.byCampaign ?? []);
  const gaConnected = revenueData?.connected ?? false;

  const handleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('desc'); }
  };
  const sortArrow = (col: SortKey) =>
    sortKey === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const sorted = [...campaigns].sort((a, b) => {
    const num = (c: EmailCampaign): number => {
      switch (sortKey) {
        case 'sentAt':    return c.sentAt ? new Date(c.sentAt).getTime() : 0;
        case 'sends':     return c.sends;
        case 'opens':     return c.opens;
        case 'openRate':  return c.openRate;
        case 'clicks':    return c.clicks;
        case 'clickRate': return c.clickRate;
        case 'revenue':   return lookupRevenue(c.name, revenueMap)?.revenue ?? 0;
        default:          return 0;
      }
    };
    const diff = num(a) - num(b);
    return sortDir === 'asc' ? diff : -diff;
  });

  const visible = showAll ? sorted : sorted.slice(0, 10);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">

      {/* -- Header -- */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Marketing</h2>
          <p className="text-sm text-gray-500">HubSpot performance · GA4 revenue</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Month</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All time</option>
            {monthOptions.map(ym => (
              <option key={ym} value={ym}>{monthLabel(ym)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* -- Not connected -- */}
      {!loading && data && !data.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
          <div className="text-amber-700 font-medium mb-1">HubSpot not connected</div>
          <div className="text-sm text-amber-600">
            Add <code className="bg-amber-100 px-1 rounded">HUBSPOT_API_KEY</code> to Vercel environment variables to pull live email data.
          </div>
        </div>
      )}

      {/* -- Loading -- */}
      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          Loading campaigns…
        </div>
      )}

      {/* -- Summary cards -- */}
      {!loading && data?.connected && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <StatCard
              label="Sends"
              value={fmt(data.totalSends)}
              sub={monthLabel(selectedMonth)}
            />
            <StatCard
              label="Opens"
              value={fmt(data.totalOpens)}
              sub={pct(data.avgOpenRate) + ' open rate'}
            />
            <StatCard
              label="Clicks"
              value={fmt(data.totalClicks)}
              sub={pct(data.avgClickRate) + ' click rate'}
            />
            <StatCard
              label="Revenue (GA4)"
              value={gaConnected ? fmtAUD(revenueData?.totalRevenue ?? 0) : '—'}
              sub={gaConnected ? `${fmt(revenueData?.totalTx ?? 0)} transactions` : 'GA4 not connected'}
            />
            <StatCard
              label="Campaigns"
              value={String(campaigns.length)}
              sub="in period"
            />
          </div>

          {/* -- GA4 not connected notice -- */}
          {!gaConnected && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
              <span className="text-blue-500 text-lg">ℹ</span>
              <div className="text-sm text-blue-700">
                <span className="font-medium">GA4 revenue not connected.</span> Add{' '}
                <code className="bg-blue-100 px-1 rounded">GOOGLE_ANALYTICS_PROPERTY_ID</code> and{' '}
                <code className="bg-blue-100 px-1 rounded">GA4_REFRESH_TOKEN</code> to Vercel to show per-campaign revenue.
              </div>
            </div>
          )}

          {/* -- Campaign table -- */}
          {campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No campaigns sent in {monthLabel(selectedMonth)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Campaigns — {monthLabel(selectedMonth)}
                </span>
                <span className="text-xs text-gray-400">{campaigns.length} total</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-5 py-2.5 font-medium">Campaign</th>
                      <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('sentAt')}>Sent{sortArrow('sentAt')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('sends')}>Sends{sortArrow('sends')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('opens')}>Opens{sortArrow('opens')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[130px] cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('openRate')}>Open rate{sortArrow('openRate')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('clicks')}>Clicks{sortArrow('clicks')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[120px] cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('clickRate')}>Click rate{sortArrow('clickRate')}</th>
                      {gaConnected && (
                        <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('revenue')} title="Campaign-level revenue from GA4. Click to sort. Multiple sends from the same campaign share the same figure.">Cmpgn Rev.{sortArrow('revenue')}</th>
                      )}
                      <th className="text-right px-5 py-2.5 font-medium">Unsubs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(() => {
                      const shownCampaigns = new Set<string>();
                      return visible.map(c => {
                      const rev = gaConnected ? lookupRevenue(c.name, revenueMap) : null;
                      const isFirstForCampaign = rev
                        ? !shownCampaigns.has(rev.campaignName)
                        : false;
                      if (isFirstForCampaign && rev) shownCampaigns.add(rev.campaignName);
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 max-w-xs">
                            <div className="font-medium text-gray-800 truncate" title={c.name}>{c.name}</div>
                            {c.subject && (
                              <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{sentDate(c.sentAt)}</td>
                          <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.sends)}</td>
                          <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.opens)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium tabular-nums ${c.openRate >= 0.2 ? 'text-green-600' : c.openRate >= 0.15 ? 'text-yellow-600' : 'text-red-500'}`}>
                                {pct(c.openRate)}
                              </span>
                              <div className="flex-1 min-w-[60px]">
                                <RateBar value={c.openRate} color={c.openRate >= 0.2 ? 'bg-green-400' : c.openRate >= 0.15 ? 'bg-yellow-400' : 'bg-red-400'} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.clicks)}</td>
                          <td className="px-4 py-3">
                            <div c