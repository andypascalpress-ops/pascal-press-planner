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
  month: string | null; campaigns: EmailCampaign[]; connected: boolean;
  totalSends: number; totalOpens: number; totalClicks: number;
  avgOpenRate: number; avgClickRate: number;
}
interface CampaignRevenue { campaignName: string; revenue: number; transactions: number; }
interface RevenueData { byCampaign: CampaignRevenue[]; totalRevenue: number; totalTx: number; connected: boolean; }
interface CampaignGroup { key: string; label: string; rev: CampaignRevenue | null; emails: EmailCampaign[]; }
interface TrendPoint {
  month: string; avgOpenRate: number; avgClickRate: number;
  avgCtor: number; unsubRate: number; totalSends: number; campaigns: number;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
function normName(s: string): string { return s.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, ''); }
function detectBrand(name: string, fromName: string): 'Pascal Press' | 'Excel Test Zone' | 'Blake Education' {
  const n = name.toLowerCase();
  const f = (fromName ?? '').toLowerCase();
  if (n.startsWith('be_') || n.includes('blake') || f.includes('blake')) return 'Blake Education';
  if (n.includes('etz') || n.startsWith('excel') || f.includes('excel test') || f.includes('etz')) return 'Excel Test Zone';
  return 'Pascal Press';
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
    map.set(normName(stripNumericPrefix(c.campaignName)), c);
    map.set(normName(c.campaignName), c);
  }
  return map;
}
function lookupRevenue(emailName: string, hsCampaignName: string, revenueMap: Map<string, CampaignRevenue>): CampaignRevenue | null {
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

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, delta, warn }: { label: string; value: string; sub?: string; delta?: ReactNode; warn?: boolean }) {
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
  return <span className={`text-xs font-semibold ${isGood ? 'text-green-600' : 'text-red-500'}`}>{change > 0 ? '↑' : '↓'}{Math.abs(change).toFixed(1)}%</span>;
}
function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(value * 100, 100).toFixed(1)}%` }} />
    </div>
  );
}
function openColors(r: number) {
  return r >= 0.2 ? { text: 'text-green-600', bar: 'bg-green-400' } : r >= 0.15 ? { text: 'text-yellow-600', bar: 'bg-yellow-400' } : { text: 'text-red-500', bar: 'bg-red-400' };
}
function clkColors(r: number) {
  return r >= 0.03 ? { text: 'text-green-600', bar: 'bg-green-400' } : r >= 0.015 ? { text: 'text-yellow-600', bar: 'bg-yellow-400' } : { text: 'text-red-500', bar: 'bg-red-400' };
}
function ctorColor(r: number): string { return r >= 0.15 ? 'text-green-600' : r >= 0.08 ? 'text-yellow-600' : 'text-red-500'; }
function unsubColor(r: number): string { return r <= 0.002 ? 'text-green-600' : r <= 0.005 ? 'text-yellow-600' : 'text-red-500'; }

// ── Trend Chart ───────────────────────────────────────────────────────────────

function TrendChart({ data, selectedMonth }: { data: TrendPoint[]; selectedMonth: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Filter to months with sends
  const pts = data.filter(d => d.totalSends > 0);
  if (pts.length < 2) {
    return <div className="text-sm text-gray-400 text-center py-8">Not enough data yet — needs at least 2 months with sends.</div>;
  }

  const W = 760, H = 210;
  const PAD = { top: 20, right: 54, bottom: 36, left: 46 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Left axis scale: open rate + click rate
  const maxLeft = Math.max(...pts.map(d => d.avgOpenRate), 0.30);
  const leftCeil  = Math.ceil(maxLeft / 0.1) * 0.1; // round up to nearest 10%

  // Right axis scale: unsubscribe rate
  const maxRight = Math.max(...pts.map(d => d.unsubRate), 0.005);
  const rightCeil = Math.ceil(maxRight / 0.001) * 0.001; // round up to nearest 0.1%

  const xOf   = (i: number) => PAD.left + (i / (pts.length - 1)) * chartW;
  const yL    = (v: number) => PAD.top + chartH * (1 - v / leftCeil);
  const yR    = (v: number) => PAD.top + chartH * (1 - v / rightCeil);

  const openPts  = pts.map((d, i) => `${xOf(i).toFixed(1)},${yL(d.avgOpenRate).toFixed(1)}`).join(' ');
  const clickPts = pts.map((d, i) => `${xOf(i).toFixed(1)},${yL(d.avgClickRate).toFixed(1)}`).join(' ');
  const unsubPts = pts.map((d, i) => `${xOf(i).toFixed(1)},${yR(d.unsubRate).toFixed(1)}`).join(' ');

  const leftGrids: number[] = [];
  for (let v = 0; v <= leftCeil + 0.001; v += 0.1) leftGrids.push(Math.round(v * 100) / 100);

  const rightGridVals = [0, rightCeil / 2, rightCeil];

  const monthAbbr = (ym: string) => {
    const [yr, mo] = ym.split('-');
    const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo) - 1] ?? '';
    return parseInt(mo) === 1 ? `${abbr} '${yr.slice(2)}` : abbr;
  };

  const hlIdx = pts.findIndex(d => d.month === selectedMonth);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 230 }}>
        {/* Left grid lines */}
        {leftGrids.map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={yL(v)} x2={W - PAD.right} y2={yL(v)} stroke="#f3f4f6" strokeWidth={1} />
            <text x={PAD.left - 6} y={yL(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{(v * 100).toFixed(0)}%</text>
          </g>
        ))}

        {/* Right axis labels (unsub) */}
        {rightGridVals.map((v, i) => (
          <text key={i} x={W - PAD.right + 6} y={yR(v) + 4} textAnchor="start" fontSize={9} fill="#ef4444" opacity={0.65}>
            {(v * 100).toFixed(2)}%
          </text>
        ))}

        {/* Axis border lines */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={W - PAD.right} y1={PAD.top} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#fca5a5" strokeWidth={1} opacity={0.5} />

        {/* Selected month highlight */}
        {hlIdx >= 0 && (
          <line x1={xOf(hlIdx)} y1={PAD.top} x2={xOf(hlIdx)} y2={H - PAD.bottom} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5} />
        )}

        {/* Unsubscribe rate (dashed red, right axis) */}
        <polyline points={unsubPts} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5,3" strokeLinecap="round" strokeLinejoin="round" />

        {/* Open rate */}
        <polyline points={openPts} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Click rate */}
        <polyline points={clickPts} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points + hover areas */}
        {pts.map((d, i) => (
          <g key={i}>
            <circle cx={xOf(i)} cy={yL(d.avgOpenRate)} r={hovered === i ? 5 : 3.5} fill="#3b82f6" />
            <circle cx={xOf(i)} cy={yL(d.avgClickRate)} r={hovered === i ? 4 : 2.5} fill="#10b981" />
            <circle cx={xOf(i)} cy={yR(d.unsubRate)} r={hovered === i ? 4 : 2.5} fill="#ef4444" />
            <rect
              x={i === 0 ? xOf(i) : (xOf(i) + xOf(i - 1)) / 2}
              y={PAD.top}
              width={pts.length === 1 ? chartW : i === 0 || i === pts.length - 1 ? chartW / (pts.length - 1) / 2 : (xOf(i + 1 < pts.length ? i + 1 : i) - xOf(i - 1)) / 2}
              height={chartH}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          </g>
        ))}

        {/* X axis labels */}
        {pts.map((d, i) => (
          <text key={i} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={10} fill={d.month === selectedMonth ? '#6366f1' : '#9ca3af'} fontWeight={d.month === selectedMonth ? 600 : 400}>
            {monthAbbr(d.month)}
          </text>
        ))}

        {/* Hover tooltip */}
        {hovered !== null && (() => {
          const d = pts[hovered];
          const x = xOf(hovered);
          const tw = 158, th = 84;
          const tx = x + tw + 14 > W - PAD.right ? x - tw - 10 : x + 10;
          const ty = Math.max(PAD.top, Math.min(PAD.top + chartH - th, yL(d.avgOpenRate) - th / 2));
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx={6} fill="white" stroke="#e5e7eb" strokeWidth={1} />
              <text x={tx + tw / 2} y={ty + 15} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">{monthLabel(d.month)}</text>
              <text x={tx + tw / 2} y={ty + 27} textAnchor="middle" fontSize={9} fill="#9ca3af">{fmt(d.totalSends)} sends &middot; {d.campaigns} emails</text>
              <circle cx={tx + 13} cy={ty + 42} r={4} fill="#3b82f6" />
              <text x={tx + 22} y={ty + 46} fontSize={10} fill="#374151">Open rate: {pct(d.avgOpenRate)}</text>
              <circle cx={tx + 13} cy={ty + 57} r={3.5} fill="#10b981" />
              <text x={tx + 22} y={ty + 61} fontSize={10} fill="#374151">Click rate: {pct(d.avgClickRate)}</text>
              <circle cx={tx + 13} cy={ty + 71} r={3} fill="#ef4444" />
              <text x={tx + 22} y={ty + 75} fontSize={10} fill="#374151">Unsub rate: {pct(d.unsubRate)}</text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-500 -mt-1">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#3b82f6" strokeWidth="2.5" /></svg>
          Open Rate (left axis)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#10b981" strokeWidth="2" /></svg>
          Click Rate (left axis)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="5,3" /></svg>
          Unsub Rate (right axis)
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmailTab() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [showAll,       setShowAll]       = useState(false);
  const [showGa4Panel,  setShowGa4Panel]  = useState(false);
  const [showTrend,     setShowTrend]     = useState(false);
  const [data,          setData]          = useState<EmailData | null>(null);
  const [prevData,      setPrevData]      = useState<EmailData | null>(null);
  const [revenueData,   setRevenueData]   = useState<RevenueData | null>(null);
  const [prevRevData,   setPrevRevData]   = useState<RevenueData | null>(null);
  const [trendData,     setTrendData]     = useState<TrendPoint[] | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [revLoading,    setRevLoading]    = useState(false);
  const [trendLoading,  setTrendLoading]  = useState(false);
  const [sortKey,       setSortKey]       = useState<SortKey>('sentAt');
  const [sortDir,       setSortDir]       = useState<SortDir>('desc');
  const [brandFilter,   setBrandFilter]   = useState<'All' | 'Pascal Press' | 'Excel Test Zone' | 'Blake Education'>('All');

  const monthOptions = buildMonthOptions();

  // Current month HubSpot
  useEffect(() => {
    setLoading(true); setData(null);
    const url = selectedMonth ? `/api/hubspot-email?month=${selectedMonth}` : '/api/hubspot-email';
    fetch(url).then(r => r.json()).then((d: EmailData) => setData(d)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [selectedMonth]);

  // GA4 revenue + previous month data (parallel)
  useEffect(() => {
    const ctrl = new AbortController();
    setRevenueData(null); setPrevData(null); setPrevRevData(null); setRevLoading(true);
    let start = '2022-01-01', end = 'today', prevStart = '', prevEnd = '';
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

  // Trend data — lazy: only fetch when user opens the trend panel
  useEffect(() => {
    if (!showTrend || trendData) return;
    setTrendLoading(true);
    fetch('/api/hubspot-email-trend')
      .then(r => r.json()).then((d: TrendPoint[]) => setTrendData(Array.isArray(d) ? d : null))
      .catch(() => setTrendData(null))
      .finally(() => setTrendLoading(false));
  }, [showTrend, trendData]);

  // ── Derived values ────────────────────────────────────────────────────────

  const allCampaigns   = data?.campaigns ?? [];
  const campaigns      = brandFilter === 'All'
    ? allCampaigns
    : allCampaigns.filter(c => detectBrand(c.name, c.fromName) === brandFilter);
  const revenueMap     = buildRevenueMap(revenueData?.byCampaign ?? []);
  const gaConnected    = revenueData?.connected ?? false;
  const totalSends     = campaigns.reduce((s, c) => s + c.sends, 0);
  const totalDelivered = campaigns.reduce((s, c) => s + c.delivered, 0);
  const totalOpens     = campaigns.reduce((s, c) => s + c.opens, 0);
  const totalClicks    = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalUnsubs    = campaigns.reduce((s, c) => s + c.unsubscribes, 0);
  const deliveryRate   = safeDiv(totalDelivered, totalSends);
  const unsubRate      = safeDiv(totalUnsubs, totalSends);
  const avgOpenRate    = safeDiv(totalOpens, totalDelivered);
  const avgClickRate   = safeDiv(totalClicks, totalDelivered);
  const avgCtor        = safeDiv(totalClicks, totalOpens);
  const totalRevenue   = revenueData?.totalRevenue ?? 0;
  const revPerSend     = safeDiv(totalRevenue, totalSends);

  const prevSends      = prevData?.totalSends ?? 0;
  const prevDelivered  = (prevData?.campaigns ?? []).reduce((s, c) => s + c.delivered, 0);
  const prevUnsubs     = (prevData?.campaigns ?? []).reduce((s, c) => s + c.unsubscribes, 0);
  const prevDelivRate  = safeDiv(prevDelivered, prevSends);
  const prevUnsubRate  = safeDiv(prevUnsubs, prevSends);
  const prevCtor       = safeDiv(prevData?.totalClicks ?? 0, prevData?.totalOpens ?? 0);
  const prevRevenue    = prevRevData?.totalRevenue ?? 0;
  const prevRevPerSend = safeDiv(prevRevenue, prevSends);
  const hasMoM         = !!selectedMonth && !!prevData?.connected;

  const bestOpenRate   = [...campaigns].filter(c => c.sends >= 100).sort((a, b) => b.openRate - a.openRate)[0] ?? null;
  const bestCtor       = [...campaigns].filter(c => c.opens >= 50).sort((a, b) => b.clickToOpen - a.clickToOpen)[0] ?? null;
  const topRevCampaign = (revenueData?.byCampaign ?? []).filter(c => c.campaignName !== '(not set)').sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  const handleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4 md:py-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Marketing</h2>
          <p className="text-sm text-gray-500">
            HubSpot &middot; GA4 revenue &middot; {hasMoM ? `vs ${monthLabel(getPrevMonth(selectedMonth))}` : 'select month for MoM'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Brand filter */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['All', 'Pascal Press', 'Excel Test Zone', 'Blake Education'] as const).map(b => (
              <button
                key={b}
                onClick={() => { setBrandFilter(b); setShowAll(false); }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  brandFilter === b
                    ? b === 'Pascal Press' ? 'bg-blue-600 text-white'
                    : b === 'Excel Test Zone' ? 'bg-emerald-600 text-white'
                    : b === 'Blake Education' ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {b === 'All' ? 'All' : b === 'Pascal Press' ? 'PP' : b === 'Excel Test Zone' ? 'ETZ' : 'BE'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowTrend(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              showTrend ? 'bg-indigo-600 text-white border-indigo-600' : 'text-indigo-600 border-indigo-300 hover:bg-indigo-50'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,11 4,6 7,8 10,3 13,5"/>
            </svg>
            12-Month Trend
          </button>
          <select
            value={selectedMonth}
            onChange={e => { setSelectedMonth(e.target.value); setShowAll(false); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All time</option>
            {monthOptions.map(ym => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
          </select>
        </div>
      </div>

      {/* HubSpot not connected */}
      {!loading && data && !data.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
          <div className="text-amber-700 font-medium mb-1">HubSpot not connected</div>
          <div className="text-sm text-amber-600">Add <code className="bg-amber-100 px-1 rounded">HUBSPOT_API_KEY</code> to Vercel.</div>
        </div>
      )}

      {loading && <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading campaigns&hellip;</div>}

      {!loading && data?.connected && (
        <>
          {/* ── 12-Month Trend Chart ── */}
          {showTrend && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-sm font-medium text-gray-700">12-Month Performance Trend</span>
                  {selectedMonth && <span className="ml-2 text-xs text-indigo-500">&#x2022; {monthLabel(selectedMonth)} highlighted</span>}
                </div>
              </div>
              {trendLoading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading 12 months of data&hellip; this takes a moment</div>}
              {!trendLoading && trendData && <TrendChart data={trendData} selectedMonth={selectedMonth} />}
              {!trendLoading && !trendData && <div className="text-sm text-red-500 text-center py-8">Could not load trend data.</div>}
            </div>
          )}

          {/* ── Top Performers ── */}
          {campaigns.length > 0 && (bestOpenRate || bestCtor || (gaConnected && topRevCampaign)) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
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

          {/* ── Stat cards row 1 ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatCard label="Sends" value={fmt(totalSends)} sub={monthLabel(selectedMonth)}
              delta={hasMoM ? <MomDelta curr={totalSends} prev={prevSends} /> : undefined} />
            <StatCard label="Delivery Rate" value={pct(deliveryRate)} sub={`${fmt(totalDelivered)} delivered`}
              delta={hasMoM ? <MomDelta curr={deliveryRate} prev={prevDelivRate} /> : undefined}
              warn={deliveryRate > 0 && deliveryRate < 0.95} />
            <StatCard label="Avg Open Rate" value={pct(avgOpenRate)} sub={`${fmt(totalOpens)} opens`}
              delta={hasMoM ? <MomDelta curr={avgOpenRate} prev={prevData?.avgOpenRate ?? 0} /> : undefined} />
            <StatCard label="Avg Click Rate" value={pct(avgClickRate)} sub={`${fmt(totalClicks)} clicks`}
              delta={hasMoM ? <MomDelta curr={avgClickRate} prev={prevData?.avgClickRate ?? 0} /> : undefined} />
          </div>

          {/* ── Stat cards row 2 ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard label="Click-to-Open Rate" value={pct(avgCtor)} sub="content engagement quality"
              delta={hasMoM ? <MomDelta curr={avgCtor} prev={prevCtor} /> : undefined} />
            <StatCard label="Unsubscribe Rate" value={pct(unsubRate)} sub={`${fmt(totalUnsubs)} unsubscribes`}
              delta={hasMoM ? <MomDelta curr={unsubRate} prev={prevUnsubRate} invert /> : undefined}
              warn={unsubRate > 0.005} />
            <StatCard label="Revenue (GA4)"
              value={revLoading ? '…' : gaConnected ? fmtAUD(totalRevenue) : '—'}
              sub={revLoading ? 'loading…' : gaConnected ? `${fmt(revenueData?.totalTx ?? 0)} transactions` : 'GA4 not connected'}
              delta={hasMoM && gaConnected ? <MomDelta curr={totalRevenue} prev={prevRevenue} /> : undefined} />
            <StatCard label="Revenue per Send"
              value={revLoading ? '…' : gaConnected && revPerSend > 0 ? `$${revPerSend.toFixed(3)}` : '—'}
              sub={gaConnected ? 'avg value per email sent' : 'GA4 not connected'}
              delta={hasMoM && gaConnected ? <MomDelta curr={revPerSend} prev={prevRevPerSend} /> : undefined} />
          </div>

          {/* ── GA4 panel ── */}
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
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">No campaigns sent in {monthLabel(selectedMonth)}</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Emails &mdash; {monthLabel(selectedMonth)}</span>
                <span className="text-xs text-gray-400">
                  {campaigns.length} emails{groups ? ` · ${groups.filter(g => g.key !== '__unmatched__').length} GA4 matched` : ''}
                </span>
              </div>
              <div className="overflow-x-auto w-full">
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
                        const gs = group.emails.reduce((s, c) => s + c.sends, 0);
                        const rps = group.rev && gs > 0 ? safeDiv(group.rev.revenue, gs) : 0;
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
                              const oc = openColors(c.openRate), cc = clkColors(c.clickRate);
                              const ur = safeDiv(c.unsubscribes, c.sends);
                              return (
                                <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                                  <td className="pl-8 pr-5 py-2.5 max-w-xs">
                                    <div className="font-medium text-gray-800 truncate text-sm" title={c.name}>{c.name}</div>
                                    {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{sentDate(c.sentAt)}</td>
                                  <td className="px-4 py-2.5 text-right text-gray-700 font-mono text-xs">{fmt(c.sends)}</td>
                                  <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className={`font-medium tabular-nums text-xs ${oc.text}`}>{pct(c.openRate)}</span><div className="flex-1 min-w-[50px]"><RateBar value={c.openRate} color={oc.bar} /></div></div></td>
                                  <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className={`font-medium tabular-nums text-xs ${cc.text}`}>{pct(c.clickRate)}</span><div className="flex-1 min-w-[50px]"><RateBar value={c.clickRate * 10} color={cc.bar} /></div></div></td>
                                  <td className={`px-4 py-2.5 text-right font-medium text-xs tabular-nums ${c.opens > 0 ? ctorColor(c.clickToOpen) : 'text-gray-300'}`}>{c.opens > 0 ? pct(c.clickToOpen) : '—'}</td>
                                  <td className={`px-4 py-2.5 text-right font-medium text-xs tabular-nums ${c.sends > 0 ? unsubColor(ur) : 'text-gray-300'}`}>{c.sends > 0 ? pct(ur) : '—'}</td>
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
                          const oc = openColors(c.openRate), cc = clkColors(c.clickRate);
                          const ur = safeDiv(c.unsubscribes, c.sends);
                          return (
                            <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                              <td className="px-5 py-3 max-w-xs">
                                <div className="font-medium text-gray-800 truncate" title={c.name}>{c.name}</div>
                                {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{sentDate(c.sentAt)}</td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">{fmt(c.sends)}</td>
                              <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`font-medium tabular-nums text-xs ${oc.text}`}>{pct(c.openRate)}</span><div className="flex-1 min-w-[50px]"><RateBar value={c.openRate} color={oc.bar} /></div></div></td>
                              <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`font-medium tabular-nums text-xs ${cc.text}`}>{pct(c.clickRate)}</span><div className="flex-1 min-w-[50px]"><RateBar value={c.clickRate * 10} color={cc.bar} /></div></div></td>
                              <td className={`px-4 py-3 text-right font-medium text-xs tabular-nums ${c.opens > 0 ? ctorColor(c.clickToOpen) : 'text-gray-300'}`}>{c.opens > 0 ? pct(c.clickToOpen) : '—'}</td>
                              <td className={`px-4 py-3 text-right font-medium text-xs tabular-nums ${c.sends > 0 ? unsubColor(ur) : 'text-gray-300'}`}>{c.sends > 0 ? pct(ur) : '—'}</td>
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

          {/* ── Benchmarks ── */}
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
