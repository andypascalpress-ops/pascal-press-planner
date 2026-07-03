'use client';

import { useState, useEffect, Fragment } from 'react';

type SortKey = 'sentAt' | 'sends' | 'opens' | 'openRate' | 'clicks' | 'clickRate' | 'revenue';
type SortDir = 'asc' | 'desc';

interface EmailCampaign {
  id:             string;
  name:           string;
  subject:        string;
  fromName:       string;
  sentAt:         string | null;
  sends:          number;
  delivered:      number;
  opens:          number;
  clicks:         number;
  unsubscribes:   number;
  openRate:       number;
  clickRate:      number;
  clickToOpen:    number;
  hsCampaignName: string;
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

interface CampaignGroup {
  key:    string;
  label:  string;
  rev:    CampaignRevenue | null;
  emails: EmailCampaign[];
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function pct(n: number): string { return (n * 100).toFixed(1) + '%'; }
function fmt(n: number): string { return n.toLocaleString('en-AU'); }
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
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function normName(s: string): string {
  return s.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}
function stripNumericPrefix(s: string): string {
  return s.replace(/^\d+[-_]/, '');
}

function buildRevenueMap(byCampaign: CampaignRevenue[]): Map<string, CampaignRevenue> {
  const map = new Map<string, CampaignRevenue>();
  for (const c of byCampaign) {
    const base = stripNumericPrefix(c.campaignName);
    map.set(normName(base), c);
    map.set(normName(c.campaignName), c);
  }
  return map;
}

function lookupRevenue(
  emailName:      string,
  hsCampaignName: string,
  revenueMap:     Map<string, CampaignRevenue>,
): CampaignRevenue | null {
  if (hsCampaignName) {
    const ckey = normName(stripNumericPrefix(hsCampaignName));
    if (ckey.length > 3) {
      if (revenueMap.has(ckey)) return revenueMap.get(ckey)!;
      for (const [mk, val] of revenueMap) {
        if (mk === ckey || mk.startsWith(ckey + '_') || ckey.startsWith(mk + '_')) return val;
      }
    }
  }
  const target = normName(emailName);
  if (revenueMap.has(target)) return revenueMap.get(target)!;
  for (const [key, val] of revenueMap) {
    if (key.length > 5 && (target.startsWith(key + '_') || target === key)) return val;
  }
  for (const [key, val] of revenueMap) {
    if (key.length > 8 && (key.includes(target) || target.includes(key))) return val;
  }
  return null;
}

function buildGroups(
  sorted:     EmailCampaign[],
  revenueMap: Map<string, CampaignRevenue>,
  sortKey:    SortKey,
): CampaignGroup[] {
  const groupMap   = new Map<string, CampaignGroup>();
  const groupOrder: string[] = [];
  for (const c of sorted) {
    const rev = lookupRevenue(c.name, c.hsCampaignName, revenueMap);
    const key = rev ? rev.campaignName : '__unmatched__';
    if (!groupMap.has(key)) {
      groupOrder.push(key);
      groupMap.set(key, {
        key,
        label: rev ? stripNumericPrefix(rev.campaignName) : 'Other (no GA4 match)',
        rev,
        emails: [],
      });
    }
    groupMap.get(key)!.emails.push(c);
  }
  if (sortKey === 'revenue') {
    groupOrder.sort((a, b) => {
      if (a === '__unmatched__') return 1;
      if (b === '__unmatched__') return -1;
      return (groupMap.get(b)?.rev?.revenue ?? 0) - (groupMap.get(a)?.rev?.revenue ?? 0);
    });
  }
  return groupOrder.map(k => groupMap.get(k)!);
}

function getSortNum(c: EmailCampaign, key: SortKey, revMap: Map<string, CampaignRevenue>): number {
  if (key === 'sentAt')    return c.sentAt ? new Date(c.sentAt).getTime() : 0;
  if (key === 'sends')     return c.sends;
  if (key === 'opens')     return c.opens;
  if (key === 'openRate')  return c.openRate;
  if (key === 'clicks')    return c.clicks;
  if (key === 'clickRate') return c.clickRate;
  if (key === 'revenue') {
    const r = lookupRevenue(c.name, c.hsCampaignName, revMap);
    return r ? r.revenue : 0;
  }
  return 0;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function RateBar({ value, color }: { value: number; color: string }) {
  const w = Math.min(value * 100, 100).toFixed(1);
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export default function EmailTab() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [showAll,       setShowAll]       = useState(false);
  const [showGa4Panel,  setShowGa4Panel]  = useState(false);
  const [data,          setData]          = useState<EmailData | null>(null);
  const [revenueData,   setRevenueData]   = useState<RevenueData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [revLoading,    setRevLoading]    = useState(false);
  const [sortKey,       setSortKey]       = useState<SortKey>('sentAt');
  const [sortDir,       setSortDir]       = useState<SortDir>('desc');

  const monthOptions = buildMonthOptions();

  useEffect(() => {
    setLoading(true);
    setData(null);
    const url = selectedMonth ? `/api/hubspot-email?month=${selectedMonth}` : '/api/hubspot-email';
    fetch(url)
      .then(r => r.json())
      .then((d: EmailData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  useEffect(() => {
    const controller = new AbortController();
    setRevenueData(null);
    setRevLoading(true);
    let start = '2022-01-01';
    let end   = 'today';
    if (selectedMonth) {
      const [y, m] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      start = `${selectedMonth}-01`;
      end   = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    }
    fetch(`/api/ga-email-revenue?start=${start}&end=${end}`, { signal: controller.signal })
      .then(r => r.json())
      .then((d: RevenueData) => setRevenueData(d))
      .catch(err => { if ((err as Error).name !== 'AbortError') setRevenueData(null); })
      .finally(() => setRevLoading(false));
    return () => controller.abort();
  }, [selectedMonth]);

  const campaigns   = data?.campaigns ?? [];
  const revenueMap  = buildRevenueMap(revenueData?.byCampaign ?? []);
  const gaConnected = revenueData?.connected ?? false;

  const handleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir((d: SortDir) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('desc'); }
  };
  const arw = (col: SortKey) => sortKey === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const sorted = [...campaigns].sort((a, b) => {
    const diff = getSortNum(a, sortKey, revenueMap) - getSortNum(b, sortKey, revenueMap);
    return sortDir === 'asc' ? diff : -diff;
  });

  const groups  = (gaConnected && !revLoading) ? buildGroups(sorted, revenueMap, sortKey) : null;
  const visible = showAll ? sorted : sorted.slice(0, 10);

  // Figure out which GA4 campaigns are unmatched (no HubSpot emails)
  const matchedGa4Keys = new Set<string>();
  if (groups) {
    for (const g of groups) {
      if (g.key !== '__unmatched__') matchedGa4Keys.add(g.key);
    }
  }
  const unmatchedGa4 = (revenueData?.byCampaign ?? []).filter(
    c => !matchedGa4Keys.has(c.campaignName) && c.campaignName !== '(not set)',
  );

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Marketing</h2>
          <p className="text-sm text-gray-500">HubSpot performance · GA4 revenue by campaign</p>
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

      {!loading && data && !data.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
          <div className="text-amber-700 font-medium mb-1">HubSpot not connected</div>
          <div className="text-sm text-amber-600">
            Add <code className="bg-amber-100 px-1 rounded">HUBSPOT_API_KEY</code> to Vercel.
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading campaigns...</div>
      )}

      {!loading && data?.connected && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            <StatCard label="Sends"  value={fmt(data.totalSends)}  sub={monthLabel(selectedMonth)} />
            <StatCard label="Opens"  value={fmt(data.totalOpens)}  sub={pct(data.avgOpenRate) + ' open rate'} />
            <StatCard label="Clicks" value={fmt(data.totalClicks)} sub={pct(data.avgClickRate) + ' click rate'} />
            <StatCard
              label="Revenue (GA4)"
              value={revLoading ? '…' : gaConnected ? fmtAUD(revenueData?.totalRevenue ?? 0) : '—'}
              sub={revLoading ? 'loading…' : gaConnected ? `${fmt(revenueData?.totalTx ?? 0)} transactions` : 'GA4 not connected'}
            />
            <StatCard label="Campaigns" value={String(campaigns.length)} sub="in period" />
          </div>

          {/* GA4 campaign breakdown panel */}
          {gaConnected && !revLoading && (revenueData?.byCampaign ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3 text-left"
                onClick={() => setShowGa4Panel(v => !v)}
              >
                <span className="text-sm font-medium text-gray-700">
                  GA4 Session Campaigns — {monthLabel(selectedMonth)}
                </span>
                <span className="text-xs text-gray-400">
                  {(revenueData?.byCampaign ?? []).length} campaigns · {showGa4Panel ? 'hide ↑' : 'show ↓'}
                </span>
              </button>
              {showGa4Panel && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {(revenueData?.byCampaign ?? [])
                    .slice()
                    .sort((a, b) => b.revenue - a.revenue)
                    .map(c => {
                      const isMatched = matchedGa4Keys.has(c.campaignName);
                      const label = stripNumericPrefix(c.campaignName);
                      return (
                        <div key={c.campaignName} className="flex items-center justify-between px-5 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isMatched ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                            <span className="text-sm text-gray-700 truncate" title={c.campaignName}>{label}</span>
                            {!isMatched && <span className="text-xs text-gray-400 flex-shrink-0">no HubSpot match</span>}
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                            <span className="text-xs text-gray-400">{fmt(c.transactions)} tx</span>
                            <span className="font-mono font-semibold text-emerald-700 text-sm">{fmtAUD(c.revenue)}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {!gaConnected && !revLoading && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
              <span className="text-blue-500 text-lg">i</span>
              <div className="text-sm text-blue-700">
                <span className="font-medium">GA4 not connected.</span>{' '}
                Add <code className="bg-blue-100 px-1 rounded">GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON</code> to Vercel.
              </div>
            </div>
          )}

          {campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No campaigns sent in {monthLabel(selectedMonth)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Emails — {monthLabel(selectedMonth)}
                </span>
                <span className="text-xs text-gray-400">
                  {campaigns.length} emails{groups ? ` · ${groups.filter(g => g.key !== '__unmatched__').length} GA4 campaigns matched` : ''}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-5 py-2.5 font-medium">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sentAt')}>Sent{arw('sentAt')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sends')}>Sends{arw('sends')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('opens')}>Opens{arw('opens')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[130px] cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('openRate')}>Open rate{arw('openRate')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('clicks')}>Clicks{arw('clicks')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[120px] cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('clickRate')}>Click rate{arw('clickRate')}</th>
                      {gaConnected && (
                        <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('revenue')}>GA4 Revenue{arw('revenue')}</th>
                      )}
                      <th className="text-right px-5 py-2.5 font-medium">Unsubs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups ? (
                      groups.map(group => (
                        <Fragment key={group.key}>
                          <tr className="bg-slate-50 border-t-2 border-slate-200">
                            <td colSpan={7} className="px-5 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{group.label}</span>
                                <span className="text-xs text-slate-400">· {group.emails.length} email{group.emails.length !== 1 ? 's' : ''}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">
                              {group.rev ? fmtAUD(group.rev.revenue) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-5 py-2 text-right text-xs text-slate-400">
                              {group.rev && group.rev.transactions > 0 ? `${fmt(group.rev.transactions)} tx` : ''}
                            </td>
                          </tr>
                          {group.emails.map(c => {
                            const openColor = c.openRate >= 0.2 ? 'text-green-600' : c.openRate >= 0.15 ? 'text-yellow-600' : 'text-red-500';
                            const openBar   = c.openRate >= 0.2 ? 'bg-green-400'  : c.openRate >= 0.15 ? 'bg-yellow-400'  : 'bg-red-400';
                            const clkColor  = c.clickRate >= 0.03 ? 'text-green-600' : c.clickRate >= 0.015 ? 'text-yellow-600' : 'text-red-500';
                            const clkBar    = c.clickRate >= 0.03 ? 'bg-green-400'  : c.clickRate >= 0.015 ? 'bg-yellow-400'  : 'bg-red-400';
                            return (
                              <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                                <td className="pl-8 pr-5 py-2.5 max-w-xs">
                                  <div className="font-medium text-gray-800 truncate text-sm" title={c.name}>{c.name}</div>
                                  {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                                </td>
                                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{sentDate(c.sentAt)}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700 font-mono">{fmt(c.sends)}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700 font-mono">{fmt(c.opens)}</td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className={`font-medium tabular-nums ${openColor}`}>{pct(c.openRate)}</span>
                                    <div className="flex-1 min-w-[60px]"><RateBar value={c.openRate} color={openBar} /></div>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right text-gray-700 font-mono">{fmt(c.clicks)}</td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className={`font-medium tabular-nums ${clkColor}`}>{pct(c.clickRate)}</span>
                                    <div className="flex-1 min-w-[60px]"><RateBar value={c.clickRate * 10} color={clkBar} /></div>
                                  </div>
                                </td>
                                <td />
                                <td className="px-5 py-2.5 text-right text-gray-500 font-mono">{fmt(c.unsubscribes)}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))
                    ) : (
                      <>
                        {visible.map(c => {
                          const openColor = c.openRate >= 0.2 ? 'text-green-600' : c.openRate >= 0.15 ? 'text-yellow-600' : 'text-red-500';
                          const openBar   = c.openRate >= 0.2 ? 'bg-green-400'  : c.openRate >= 0.15 ? 'bg-yellow-400'  : 'bg-red-400';
                          const clkColor  = c.clickRate >= 0.03 ? 'text-green-600' : c.clickRate >= 0.015 ? 'text-yellow-600' : 'text-red-500';
                          const clkBar    = c.clickRate >= 0.03 ? 'bg-green-400'  : c.clickRate >= 0.015 ? 'bg-yellow-400'  : 'bg-red-400';
                          return (
                            <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                              <td className="px-5 py-3 max-w-xs">
                                <div className="font-medium text-gray-800 truncate" title={c.name}>{c.name}</div>
                                {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{sentDate(c.sentAt)}</td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.sends)}</td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.opens)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium tabular-nums ${openColor}`}>{pct(c.openRate)}</span>
                                  <div className="flex-1 min-w-[60px]"><RateBar value={c.openRate} color={openBar} /></div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono">{fmt(c.clicks)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium tabular-nums ${clkColor}`}>{pct(c.clickRate)}</span>
                                  <div className="flex-1 min-w-[60px]"><RateBar value={c.clickRate * 10} color={clkBar} /></div>
                                </div>
                              </td>
                              {gaConnected && <td className="px-4 py-3 text-right text-gray-300 text-xs">…</td>}
                              <td className="px-5 py-3 text-right text-gray-500 font-mono">{fmt(c.unsubscribes)}</td>
                            </tr>
                          );
                        })}
                        {campaigns.length > 10 && (
                          <tr>
                            <td colSpan={gaConnected ? 9 : 8} className="px-5 py-3 text-center border-t border-gray-100">
                              <button onClick={() => setShowAll(v => !v)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                                {showAll ? 'Show less' : `Show all ${campaigns.length} campaigns`}
                              </button>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-6 text-xs text-gray-500">
            <span>Open rate: <span className="text-green-600 font-medium">20%+ good</span> · <span className="text-yellow-600 font-medium">15–20% avg</span> · <span className="text-red-500 font-medium">under 15% low</span></span>
            <span>Click rate: <span className="text-green-600 font-medium">3%+ good</span> · <span className="text-yellow-600 font-medium">1.5–3% avg</span> · <span className="text-red-500 font-medium">under 1.5% low</span></span>
          </div>
        </>
      )}
    </div>
  );
}
