'use client';

import { useState, useEffect, Fragment, ReactNode } from 'react';

type SortKey = 'sentAt' | 'sends' | 'opens' | 'openRate' | 'clicks' | 'clickRate' | 'revenue' | 'ctor' | 'unsubRate';
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
function safeDiv(a: number, b: number): number { return b > 0 ? a / b : 0; }
function monthLabel(ym: string): string {
  if (!ym) return 'All time';
  const [y, m] = ym.split('-');
  return (MONTH_NAMES[parseInt(m ?? '1') - 1] ?? '') + ' ' + y;
}
function buildMonthOptions(): string[] {
  const opts: string[] = [];
  const d = new Date(); d.setDate(1);
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
function stripNumericPrefix(s: string): string { return s.replace(/^\d+[-_]/, ''); }
function getPrevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  emailName: string, hsCampaignName: string, revenueMap: Map<string, CampaignRevenue>,
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

function buildGroups(sorted: EmailCampaign[], revenueMap: Map<string, CampaignRevenue>, sortKey: SortKey): CampaignGroup[] {
  const groupMap = new Map<string, CampaignGroup>();
  const groupOrder: string[] = [];
  for (const c of sorted) {
    const rev = lookupRevenue(c.name, c.hsCampaignName, revenueMap);
    const key = rev ? rev.campaignName : '__unmatched__';
    if (!groupMap.has(key)) {
      groupOrder.push(key);
      groupMap.set(key, { key, label: rev ? stripNumericPrefix(rev.campaignName) : 'Other (no GA4 match)', rev, emails: [] });
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
  if (key === 'ctor')      return c.clickToOpen;
  if (key === 'unsubRate') return safeDiv(c.unsubscribes, c.sends);
  if (key === 'revenue')   { const r = lookupRevenue(c.name, c.hsCampaignName, revMap); return r ? r.revenue : 0; }
  return 0;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, delta, warn }: {
  label: string; value: string; sub?: string; delta?: ReactNode; warn?: boolean;
}) {
  return (
    <div className={`rounded-xl border shadow-sm px-5 py-4 ${warn ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-end gap-2">
        <div className={`text-2xl font-bold ${warn ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
        {delta}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MomDelta({ curr, prev, invert = false }: { curr: number; prev: number; invert?: boolean }) {
  if (prev === 0) return null;
  const change = ((curr - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return null;
  const isGood = invert ? change < 0 : change > 0;
  return (
    <span className={`text-xs font-semibold ${isGood ? 'text-green-600' : 'text-red-500'}`}>
      {change > 0 ? '↑' : '↓'}{Math.abs(change).toFixed(1)}%
    </span>
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

function openColors(r: number) {
  return r >= 0.2  ? { text: 'text-green-600',  bar: 'bg-green-400'  }
       : r >= 0.15 ? { text: 'text-yellow-600', bar: 'bg-yellow-400' }
       :             { text: 'text-red-500',     bar: 'bg-red-400'    };
}
function clkColors(r: number) {
  return r >= 0.03  ? { text: 'text-green-600',  bar: 'bg-green-400'  }
       : r >= 0.015 ? { text: 'text-yellow-600', bar: 'bg-yellow-400' }
       :              { text: 'text-red-500',     bar: 'bg-red-400'    };
}
function ctorColor(r: number): string {
  return r >= 0.15 ? 'text-green-600' : r >= 0.08 ? 'text-yellow-600' : 'text-red-500';
}
function unsubColor(r: number): string {
  return r <= 0.002 ? 'text-green-600' : r <= 0.005 ? 'text-yellow-600' : 'text-red-500';
}

// ── Main component ───────────────────────────────────────────────────────────

export default function EmailTab() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [showAll,      setShowAll]        = useState(false);
  const [showGa4Panel, setShowGa4Panel]   = useState(false);
  const [data,         setData]           = useState<EmailData | null>(null);
  const [prevData,     setPrevData]       = useState<EmailData | null>(null);
  const [revenueData,  setRevenueData]    = useState<RevenueData | null>(null);
  const [prevRevData,  setPrevRevData]    = useState<RevenueData | null>(null);
  const [loading,      setLoading]        = useState(false);
  const [revLoading,   setRevLoading]     = useState(false);
  const [sortKey,      setSortKey]        = useState<SortKey>('sentAt');
  const [sortDir,      setSortDir]        = useState<SortDir>('desc');

  const monthOptions = buildMonthOptions();

  // Fetch current month HubSpot data
  useEffect(() => {
    setLoading(true); setData(null);
    const url = selectedMonth ? `/api/hubspot-email?month=${selectedMonth}` : '/api/hubspot-email';
    fetch(url).then(r => r.json()).then((d: EmailData) => setData(d)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [selectedMonth]);

  // Fetch GA4 revenue + previous month data (all in parallel)
  useEffect(() => {
    const ctrl = new AbortController();
    setRevenueData(null); setPrevData(null); setPrevRevData(null); setRevLoading(true);

    let start = '2022-01-01', end = 'today';
    let prevStart = '', prevEnd = '';
    if (selectedMonth) {
      const [y, m] = selectedMonth.split('-').map(Number);
      start = `${selectedMonth}-01`;
      end   = `${selectedMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
      const prev = getPrevMonth(selectedMonth);
      const [py, pm] = prev.split('-').map(Number);
      prevStart = `${prev}-01`;
      prevEnd   = `${prev}-${String(new Date(py, pm, 0).getDate()).padStart(2, '0')}`;
    }

    const jobs: Promise<void>[] = [
      fetch(`/api/ga-email-revenue?start=${start}&end=${end}`, { signal: ctrl.signal })
        .then(r => r.json()).then((d: RevenueData) => setRevenueData(d))
        .catch(err => { if ((err as Error).name !== 'AbortError') setRevenueData(null); }),
    ];
    if (selectedMonth && prevStart) {
      jobs.push(
        fetch(`/api/hubspot-email?month=${getPrevMonth(selectedMonth)}`, { signal: ctrl.signal })
          .then(r => r.json()).then((d: EmailData) => setPrevData(d)).catch(() => setPrevData(null)),
        fetch(`/api/ga-email-revenue?start=${prevStart}&end=${prevEnd}`, { signal: ctrl.signal })
          .then(r => r.json()).then((d: RevenueData) => setPrevRevData(d)).catch(() => setPrevRevData(null)),
      );
    }
    Promise.all(jobs).finally(() => setRevLoading(false));
    return () => ctrl.abort();
  }, [selectedMonth]);

  // ── Derived values ───────────────────────────────────────────────────────

  const campaigns    = data?.campaigns ?? [];
  const revenueMap   = buildRevenueMap(revenueData?.byCampaign ?? []);
  const gaConnected  = revenueData?.connected ?? false;
  const totalSends   = data?.totalSends ?? 0;
  const totalDelivered = campaigns.reduce((s, c) => s + c.delivered, 0);
  const totalUnsubs  = campaigns.reduce((s, c) => s + c.unsubscribes, 0);
  const deliveryRate = safeDiv(totalDelivered, totalSends);
  const unsubRate    = safeDiv(totalUnsubs, totalSends);
  const avgCtor      = safeDiv(data?.totalClicks ?? 0, data?.totalOpens ?? 0);
  const totalRevenue = revenueData?.totalRevenue ?? 0;
  const revPerSend   = safeDiv(totalRevenue, totalSends);

  const prevSends      = prevData?.totalSends ?? 0;
  const prevDelivered  = (prevData?.campaigns ?? []).reduce((s, c) => s + c.delivered, 0);
  const prevUnsubs     = (prevData?.campaigns ?? []).reduce((s, c) => s + c.unsubscribes, 0);
  const prevDelivRate  = safeDiv(prevDelivered, prevSends);
  const prevUnsubRate  = safeDiv(prevUnsubs, prevSends);
  const prevCtor       = safeDiv(prevData?.totalClicks ?? 0, prevData?.totalOpens ?? 0);
  const prevRevenue    = prevRevData?.totalRevenue ?? 0;
  const prevRevPerSend = safeDiv(prevRevenue, prevSends);
  const hasMoM         = !!selectedMonth && !!prevData?.connected;

  // Top performers (meaningful sample sizes only)
  const bestOpenRate   = [...campaigns].filter(c => c.sends >= 100).sort((a, b) => b.openRate - a.openRate)[0] ?? null;
  const bestCtor       = [...campaigns].filter(c => c.opens >= 50).sort((a, b) => b.clickToOpen - a.clickToOpen)[0] ?? null;
  const topRevCampaign = (revenueData?.byCampaign ?? []).filter(c => c.campaignName !== '(not set)').sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  // Sorting
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

  const matchedGa4Keys = new Set<string>();
  if (groups) for (const g of groups) { if (g.key !== '__unmatched__') matchedGa4Keys.add(g.key); }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Marketing</h2>
          <p className="text-sm text-gray-500">
            HubSpot performance &middot; GA4 revenue &middot;{' '}
            {hasMoM ? `vs ${monthLabel(getPrevMonth(selectedMonth))}` : 'select a month for MoM'}
          </p>
        </div>
        <select
          value={selectedMonth}
          onChange={e => { setSelectedMonth(e.target.value); setShowAll(false); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All time</option>
          {monthOptions.map(ym => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
        </select>
      </div>

      {/* HubSpot not connected */}
      {!loading && data && !data.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
          <div className="text-amber-700 font-medium mb-1">HubSpot not connected</div>
          <div className="text-sm text-amber-600">Add <code className="bg-amber-100 px-1 rounded">HUBSPOT_API_KEY</code> to Vercel.</div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading campaigns&hellip;</div>
      )}

      {!loading && data?.connected && (
        <>
          {/* ── Top Performers ── */}
          {campaigns.length > 0 && (bestOpenRate || bestCtor || (gaConnected && topRevCampaign)) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
              {bestOpenRate && (
                <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2 font-medium">&#x1F3C6; Best Open Rate</div>
                  <div className="font-medium text-gray-800 text-sm truncate" title={bestOpenRate.name}>{bestOpenRate.name}</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">{pct(bestOpenRate.openRate)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmt(bestOpenRate.sends)} sends &middot; {sentDate(bestOpenRate.sentAt)}</div>
                </div>
              )}
              {bestCtor && (
                <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2 font-medium">&#x1F3AF; Best Click-to-Open</div>
                  <div className="font-medium text-gray-800 text-sm truncate" title={bestCtor.name}>{bestCtor.name}</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">{pct(bestCtor.clickToOpen)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmt(bestCtor.opens)} opens &middot; {fmt(bestCtor.clicks)} clicks</div>
                </div>
              )}
              {gaConnected && topRevCampaign && (
                <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2 font-medium">&#x1F4B0; Top Revenue Campaign</div>
                  <div className="font-medium text-gray-800 text-sm truncate" title={topRevCampaign.campaignName}>{stripNumericPrefix(topRevCampaign.campaignName)}</div>
                  <div className="text-2xl font-bold text-emerald-600 mt-1">{fmtAUD(topRevCampaign.revenue)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmt(topRevCampaign.transactions)} transactions</div>
                </div>
              )}
            </div>
          )}

          {/* ── Stat cards: row 1 — volume & engagement ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <StatCard label="Sends" value={fmt(totalSends)} sub={monthLabel(selectedMonth)}
              delta={hasMoM ? <MomDelta curr={totalSends} prev={prevSends} /> : undefined} />
            <StatCard label="Delivery Rate" value={pct(deliveryRate)} sub={`${fmt(totalDelivered)} delivered`}
              delta={hasMoM ? <MomDelta curr={deliveryRate} prev={prevDelivRate} /> : undefined}
              warn={deliveryRate > 0 && deliveryRate < 0.95} />
            <StatCard label="Avg Open Rate" value={pct(data.avgOpenRate)} sub={`${fmt(data.totalOpens)} opens`}
              delta={hasMoM ? <MomDelta curr={data.avgOpenRate} prev={prevData?.avgOpenRate ?? 0} /> : undefined} />
            <StatCard label="Avg Click Rate" value={pct(data.avgClickRate)} sub={`${fmt(data.totalClicks)} clicks`}
              delta={hasMoM ? <MomDelta curr={data.avgClickRate} prev={prevData?.avgClickRate ?? 0} /> : undefined} />
          </div>

          {/* ── Stat cards: row 2 — quality & commercial ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <StatCard label="Click-to-Open Rate" value={pct(avgCtor)} sub="content engagement quality"
              delta={hasMoM ? <MomDelta curr={avgCtor} prev={prevCtor} /> : undefined} />
            <StatCard label="Unsubscribe Rate" value={pct(unsubRate)} sub={`${fmt(totalUnsubs)} unsubscribes`}
              delta={hasMoM ? <MomDelta curr={unsubRate} prev={prevUnsubRate} invert /> : undefined}
              warn={unsubRate > 0.005} />
            <StatCard
              label="Revenue (GA4)"
              value={revLoading ? '…' : gaConnected ? fmtAUD(totalRevenue) : '—'}
              sub={revLoading ? 'loading…' : gaConnected ? `${fmt(revenueData?.totalTx ?? 0)} transactions` : 'GA4 not connected'}
              delta={hasMoM && gaConnected ? <MomDelta curr={totalRevenue} prev={prevRevenue} /> : undefined} />
            <StatCard
              label="Revenue per Send"
              value={revLoading ? '…' : gaConnected && revPerSend > 0 ? `$${revPerSend.toFixed(3)}` : '—'}
              sub={gaConnected ? 'avg value per email sent' : 'GA4 not connected'}
              delta={hasMoM && gaConnected ? <MomDelta curr={revPerSend} prev={prevRevPerSend} /> : undefined} />
          </div>

          {/* ── GA4 campaign breakdown panel ── */}
          {gaConnected && !revLoading && (revenueData?.byCampaign ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-3 text-left" onClick={() => setShowGa4Panel(v => !v)}>
                <span className="text-sm font-medium text-gray-700">GA4 Session Campaigns &mdash; {monthLabel(selectedMonth)}</span>
                <span className="text-xs text-gray-400">{(revenueData?.byCampaign ?? []).length} campaigns &middot; {showGa4Panel ? 'hide ↑' : 'show ↓'}</span>
              </button>
              {showGa4Panel && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {(revenueData?.byCampaign ?? []).slice().sort((a, b) => b.revenue - a.revenue).map(c => {
                    const isMatched = matchedGa4Keys.has(c.campaignName);
                    return (
                      <div key={c.campaignName} className="flex items-center justify-between px-5 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isMatched ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                          <span className="text-sm text-gray-700 truncate" title={c.campaignName}>{stripNumericPrefix(c.campaignName)}</span>
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
                Add <code className="bg-blue-100 px-1 rounded">GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON</code> to Vercel for revenue data.
              </div>
            </div>
          )}

          {/* ── Campaign Table ── */}
          {campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No campaigns sent in {monthLabel(selectedMonth)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Emails &mdash; {monthLabel(selectedMonth)}</span>
                <span className="text-xs text-gray-400">
                  {campaigns.length} emails{groups ? ` · ${groups.filter(g => g.key !== '__unmatched__').length} GA4 matched` : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-5 py-2.5 font-medium">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sentAt')}>Sent{arw('sentAt')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sends')}>Sends{arw('sends')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[120px] cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('openRate')}>Open Rate{arw('openRate')}</th>
                      <th className="px-4 py-2.5 font-medium min-w-[110px] cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('clickRate')}>Click Rate{arw('clickRate')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" title="Click-to-Open Rate" onClick={() => handleSort('ctor')}>CTOR{arw('ctor')}</th>
                      <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" title="Unsubscribe Rate" onClick={() => handleSort('unsubRate')}>Unsub%{arw('unsubRate')}</th>
                      {gaConnected && <th className="text-right px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('revenue')}>GA4 Revenue{arw('revenue')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groups ? (
                      groups.map(group => {
                        const groupSends = group.emails.reduce((s, c) => s + c.sends, 0);
                        const rps = group.rev && groupSends > 0 ? safeDiv(group.rev.revenue, groupSends) : 0;
                        return (
                          <Fragment key={group.key}>
                            <tr className="bg-slate-50 border-t-2 border-slate-200">
                              <td colSpan={7} className="px-5 py-2">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{group.label}</span>
                                  <span className="text-xs text-slate-400">&middot; {group.emails.length} email{group.emails.length !== 1 ? 's' : ''}</span>
                                  {group.rev && group.rev.transactions > 0 && <span className="text-xs text-slate-400">&middot; {fmt(group.rev.transactions)} tx</span>}
                                  {rps > 0 && <span className="text-xs text-emerald-600 font-medium">${rps.toFixed(3)}/send</span>}
                                </div>
                              </td>
                              {gaConnected && (
                                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">
                                  {group.rev ? fmtAUD(group.rev.revenue) : <span className="text-gray-300">&mdash;</span>}
                                </td>
                              )}
                            </tr>
                            {group.emails.map(c => {
                              const oc = openColors(c.openRate);
                              const cc = clkColors(c.clickRate);
                              const ur = safeDiv(c.unsubscribes, c.sends);
                              return (
                                <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                                  <td className="pl-8 pr-5 py-2.5 max-w-xs">
                                    <div className="font-medium text-gray-800 truncate text-sm" title={c.name}>{c.name}</div>
                                    {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{sentDate(c.sentAt)}</td>
                                  <td className="px-4 py-2.5 text-right text-gray-700 font-mono text-xs">{fmt(c.sends)}</td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <span className={`font-medium tabular-nums text-xs ${oc.text}`}>{pct(c.openRate)}</span>
                                      <div className="flex-1 min-w-[50px]"><RateBar value={c.openRate} color={oc.bar} /></div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <span className={`font-medium tabular-nums text-xs ${cc.text}`}>{pct(c.clickRate)}</span>
                                      <div className="flex-1 min-w-[50px]"><RateBar value={c.clickRate * 10} color={cc.bar} /></div>
                                    </div>
                                  </td>
                                  <td className={`px-4 py-2.5 text-right font-medium text-xs tabular-nums ${c.opens > 0 ? ctorColor(c.clickToOpen) : 'text-gray-300'}`}>
                                    {c.opens > 0 ? pct(c.clickToOpen) : '—'}
                                  </td>
                                  <td className={`px-4 py-2.5 text-right font-medium text-xs tabular-nums ${c.sends > 0 ? unsubColor(ur) : 'text-gray-300'}`}>
                                    {c.sends > 0 ? pct(ur) : '—'}
                                  </td>
                                  {gaConnected && <td />}
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })
                    ) : (
                      <>
                        {visible.map(c => {
                          const oc = openColors(c.openRate);
                          const cc = clkColors(c.clickRate);
                          const ur = safeDiv(c.unsubscribes, c.sends);
                          return (
                            <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                              <td className="px-5 py-3 max-w-xs">
                                <div className="font-medium text-gray-800 truncate" title={c.name}>{c.name}</div>
                                {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{sentDate(c.sentAt)}</td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">{fmt(c.sends)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium tabular-nums text-xs ${oc.text}`}>{pct(c.openRate)}</span>
                                  <div className="flex-1 min-w-[50px]"><RateBar value={c.openRate} color={oc.bar} /></div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium tabular-nums text-xs ${cc.text}`}>{pct(c.clickRate)}</span>
                                  <div className="flex-1 min-w-[50px]"><RateBar value={c.clickRate * 10} color={cc.bar} /></div>
                                </div>
                              </td>
                              <td className={`px-4 py-3 text-right font-medium text-xs tabular-nums ${c.opens > 0 ? ctorColor(c.clickToOpen) : 'text-gray-300'}`}>
                                {c.opens > 0 ? pct(c.clickToOpen) : '—'}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium text-xs tabular-nums ${c.sends > 0 ? unsubColor(ur) : 'text-gray-300'}`}>
                                {c.sends > 0 ? pct(ur) : '—'}
                              </td>
                              {gaConnected && <td className="px-4 py-3 text-right text-gray-300 text-xs">&hellip;</td>}
                            </tr>
                          );
                        })}
                        {campaigns.length > 10 && (
                          <tr>
                            <td colSpan={gaConnected ? 8 : 7} className="px-5 py-3 text-center border-t border-gray-100">
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

          {/* ── Benchmarks legend ── */}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>Open rate: <span className="text-green-600 font-medium">20%+</span> &middot; <span className="text-yellow-600 font-medium">15&ndash;20%</span> &middot; <span className="text-red-500 font-medium">&lt;15%</span></span>
            <span>Click rate: <span className="text-green-600 font-medium">3%+</span> &middot; <span className="text-yellow-600 font-medium">1.5&ndash;3%</span> &middot; <span className="text-red-500 font-medium">&lt;1.5%</span></span>
            <span>CTOR: <span className="text-green-600 font-medium">15%+</span> &middot; <span className="text-yellow-600 font-medium">8&ndash;15%</span> &middot; <span className="text-red-500 font-medium">&lt;8%</span></span>
            <span>Unsub: <span className="text-green-600 font-medium">&lt;0.2%</span> &middot; <span className="text-yellow-600 font-medium">0.2&ndash;0.5%</span> &middot; <span className="text-red-500 font-medium">&gt;0.5%</span></span>
          </div>
        </>
      )}
    </div>
  );
}
