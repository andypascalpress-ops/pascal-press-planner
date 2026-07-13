'use client';

import { useState, useEffect } from 'react';

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
interface CampaignRevenue { campaignName: string; revenue: number; transactions: number; brand?: 'pp' | 'etz'; }
interface RevenueBrandSlice { byCampaign: CampaignRevenue[]; totalRevenue: number; totalTx: number; }
interface RevenueData {
  byCampaign: CampaignRevenue[];
  totalRevenue: number;
  totalTx: number;
  connected: boolean;
  byBrand?: { pp: RevenueBrandSlice; etz: RevenueBrandSlice };
  range?: { startDate: string; endDate: string };
}
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
function fmtAUD2(n: number): string {
  if (n === 0) return '—';
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function stripNumericPrefix(s: string): string {
  // GA often prefixes HubSpot campaign IDs: "48087648-PP_5755_..."
  return s.replace(/^\d{4,}[-_]/, '').replace(/^\d+[-_]/, '');
}
/** Extract codes like PP_5755 / ETZ_1234 for fuzzy matching across HubSpot vs GA names. */
function extractCampaignCode(s: string): string | null {
  const m = s.match(/\b((?:pp|etz|be)[_-]?\d{3,6})\b/i);
  return m ? m[1]!.toLowerCase().replace('-', '_') : null;
}
function getPrevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Sydney-safe month range — never request GA4 future dates. */
function monthDateRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  let end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (end > today) end = today;
  if (start > today) return { start: today, end: today };
  return { start, end };
}
function buildRevenueMap(byCampaign: CampaignRevenue[]): Map<string, CampaignRevenue> {
  const map = new Map<string, CampaignRevenue>();
  for (const c of byCampaign) {
    const stripped = stripNumericPrefix(c.campaignName);
    map.set(normName(stripped), c);
    map.set(normName(c.campaignName), c);
    const code = extractCampaignCode(c.campaignName);
    if (code) map.set(code, c);
  }
  return map;
}
function lookupRevenue(emailName: string, hsCampaignName: string, revenueMap: Map<string, CampaignRevenue>): CampaignRevenue | null {
  const candidates = [hsCampaignName, emailName].filter(Boolean);
  for (const raw of candidates) {
    const code = extractCampaignCode(raw);
    if (code && revenueMap.has(code)) return revenueMap.get(code)!;
  }
  for (const raw of candidates) {
    const ckey = normName(stripNumericPrefix(raw));
    if (ckey.length <= 3) continue;
    if (revenueMap.has(ckey)) return revenueMap.get(ckey)!;
    for (const [mk, val] of revenueMap) {
      if (mk.length < 4) continue;
      if (mk === ckey || mk.startsWith(ckey + '_') || ckey.startsWith(mk + '_')) return val;
      // GA name often shorter than HubSpot "..._Launch" suffix
      if (ckey.includes(mk) || mk.includes(ckey)) return val;
    }
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

function MomDelta({ curr, prev, invert = false }: { curr: number; prev: number; invert?: boolean }) {
  if (prev === 0) return null;
  const change = ((curr - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return null;
  const isGood = invert ? change < 0 : change > 0;
  return <span className={`text-xs font-semibold ${isGood ? 'text-green-600' : 'text-red-500'}`}>{change > 0 ? '↑' : '↓'}{Math.abs(change).toFixed(1)}%</span>;
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
  // Default to current calendar month so we never kick off the heavy "all time"
  // HubSpot pull first (that slow response used to overwrite a later month selection).
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const opts = buildMonthOptions();
    return opts[0] ?? '';
  });
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
  const [sortKey,       setSortKey]       = useState<SortKey>('revenue');
  const [sortDir,       setSortDir]       = useState<SortDir>('desc');
  const [brandFilter,   setBrandFilter]   = useState<'All' | 'Pascal Press' | 'Excel Test Zone' | 'Blake Education'>('All');

  const monthOptions = buildMonthOptions();

  // Current month HubSpot — abort in-flight requests so a slower "all time" / prior
  // month response cannot wipe a newer selection a few seconds later.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);

    const url = selectedMonth ? `/api/hubspot-email?month=${selectedMonth}` : '/api/hubspot-email';
    fetch(url, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(`HubSpot email HTTP ${r.status}`);
        return r.json() as Promise<EmailData>;
      })
      .then(d => {
        if (cancelled) return;
        // Guard against malformed / error payloads blanking the tab
        if (!d || typeof d !== 'object') {
          setData(null);
          return;
        }
        setData({
          month: d.month ?? (selectedMonth || null),
          campaigns: Array.isArray(d.campaigns) ? d.campaigns : [],
          connected: !!d.connected,
          totalSends: d.totalSends ?? 0,
          totalOpens: d.totalOpens ?? 0,
          totalClicks: d.totalClicks ?? 0,
          avgOpenRate: d.avgOpenRate ?? 0,
          avgClickRate: d.avgClickRate ?? 0,
        });
      })
      .catch(err => {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        console.error('[EmailTab hubspot]', err);
        // Keep last good data if we already have it for this month — only clear when empty
        setData(prev => prev);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [selectedMonth]);

  // GA4 revenue + previous month data (parallel)
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setRevLoading(true);
    // Clear secondary data only after abort is set up — never let stale responses re-apply
    setRevenueData(null);
    setPrevData(null);
    setPrevRevData(null);

    let start = '2022-01-01', end = 'today', prevStart = '', prevEnd = '';
    if (selectedMonth) {
      const cur = monthDateRange(selectedMonth);
      start = cur.start;
      end = cur.end;
      const prev = getPrevMonth(selectedMonth);
      const prevRange = monthDateRange(prev);
      prevStart = prevRange.start;
      prevEnd = prevRange.end;
    }

    const safeJson = async <T,>(r: Response): Promise<T> => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<T>;
    };

    const jobs: Promise<void>[] = [
      fetch(`/api/ga-email-revenue?start=${start}&end=${end}`, { signal: ctrl.signal })
        .then(r => safeJson<RevenueData>(r))
        .then(d => { if (!cancelled) setRevenueData(d); })
        .catch(err => {
          if (cancelled || (err as Error)?.name === 'AbortError') return;
          setRevenueData(null);
        }),
    ];
    if (selectedMonth && prevStart) {
      jobs.push(
        fetch(`/api/hubspot-email?month=${getPrevMonth(selectedMonth)}`, { signal: ctrl.signal })
          .then(r => safeJson<EmailData>(r))
          .then(d => { if (!cancelled) setPrevData(d); })
          .catch(err => {
            if (cancelled || (err as Error)?.name === 'AbortError') return;
            setPrevData(null);
          }),
        fetch(`/api/ga-email-revenue?start=${prevStart}&end=${prevEnd}`, { signal: ctrl.signal })
          .then(r => safeJson<RevenueData>(r))
          .then(d => { if (!cancelled) setPrevRevData(d); })
          .catch(err => {
            if (cancelled || (err as Error)?.name === 'AbortError') return;
            setPrevRevData(null);
          }),
      );
    }
    Promise.all(jobs).finally(() => {
      if (!cancelled) setRevLoading(false);
    });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
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

  // Use the correct GA property slice so PP totals match the Pascal Press GA report
  // (session medium = email). Do NOT blend ETZ into PP.
  const activeRevSlice: RevenueBrandSlice | null = (() => {
    if (!revenueData?.connected) return null;
    if (brandFilter === 'Pascal Press' && revenueData.byBrand?.pp) return revenueData.byBrand.pp;
    if (brandFilter === 'Excel Test Zone' && revenueData.byBrand?.etz) return revenueData.byBrand.etz;
    if (brandFilter === 'Blake Education') {
      // Blake has no GA email property wired yet
      return { byCampaign: [], totalRevenue: 0, totalTx: 0 };
    }
    // All: combined PP + ETZ channel totals
    return {
      byCampaign: revenueData.byCampaign ?? [],
      totalRevenue: revenueData.totalRevenue ?? 0,
      totalTx: revenueData.totalTx ?? 0,
    };
  })();

  const revenueMap     = buildRevenueMap(activeRevSlice?.byCampaign ?? []);
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

  // Channel total from the active GA property (matches Traffic acquisition email filter).
  // Matched keys used for green dots in the GA panel.
  const matchedKeys = new Set<string>();
  for (const c of campaigns) {
    const match = lookupRevenue(c.name, c.hsCampaignName, revenueMap);
    if (match) matchedKeys.add(match.campaignName);
  }

  const totalRevenue = activeRevSlice?.totalRevenue ?? 0;
  const totalRevTx   = activeRevSlice?.totalTx ?? 0;
  const revPerSend   = safeDiv(totalRevenue, totalSends);

  // GA4 panel list — full channel breakdown for the active brand property
  const filteredRevCampaigns = activeRevSlice?.byCampaign ?? [];

  // Previous month revenue — same brand-scoped slice
  const prevActiveSlice: RevenueBrandSlice | null = (() => {
    if (!prevRevData?.connected) return null;
    if (brandFilter === 'Pascal Press' && prevRevData.byBrand?.pp) return prevRevData.byBrand.pp;
    if (brandFilter === 'Excel Test Zone' && prevRevData.byBrand?.etz) return prevRevData.byBrand.etz;
    if (brandFilter === 'Blake Education') return { byCampaign: [], totalRevenue: 0, totalTx: 0 };
    return {
      byCampaign: prevRevData.byCampaign ?? [],
      totalRevenue: prevRevData.totalRevenue ?? 0,
      totalTx: prevRevData.totalTx ?? 0,
    };
  })();
  const prevRevenue = prevActiveSlice?.totalRevenue ?? 0;
  const prevSends   = prevData?.totalSends ?? 0;
  const hasMoM      = !!selectedMonth && !!prevData?.connected;

  const brandShort =
    brandFilter === 'Pascal Press' ? 'PP'
    : brandFilter === 'Excel Test Zone' ? 'ETZ'
    : brandFilter === 'Blake Education' ? 'Blake'
    : 'All brands';
  const revSourceLabel =
    brandFilter === 'Pascal Press' ? 'Pascal Press GA · medium=email'
    : brandFilter === 'Excel Test Zone' ? 'Excel Test Zone GA · medium=email'
    : brandFilter === 'Blake Education' ? 'Blake — no email revenue property yet'
    : 'PP + ETZ GA · medium=email';
  const rangeLabel = revenueData?.range
    ? `${revenueData.range.startDate} → ${revenueData.range.endDate}`
    : monthLabel(selectedMonth);

  const bestOpenRate   = [...campaigns].filter(c => c.sends >= 100).sort((a, b) => b.openRate - a.openRate)[0] ?? null;
  const bestCtor       = [...campaigns].filter(c => c.opens >= 50).sort((a, b) => b.clickToOpen - a.clickToOpen)[0] ?? null;
  const topRevCampaign = filteredRevCampaigns.filter(c => c.campaignName !== '(not set)' && c.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  type WinnerRow = {
    email: EmailCampaign;
    rev: CampaignRevenue | null;
    brand: string;
    matchStatus: 'matched' | 'unmatched' | 'not_set_pool';
    whyEmpty: string | null;
    rps: number;
  };

  const winnerRows: WinnerRow[] = campaigns.map(email => {
    const rev = lookupRevenue(email.name, email.hsCampaignName, revenueMap);
    let matchStatus: WinnerRow['matchStatus'] = 'unmatched';
    let whyEmpty: string | null = null;
    if (rev) {
      matchStatus = rev.campaignName === '(not set)' ? 'not_set_pool' : 'matched';
      if (rev.revenue <= 0) whyEmpty = 'Matched campaign, no purchases in range';
    } else {
      whyEmpty = 'No GA campaign tag match — check utm_campaign on the send';
    }
    const rps = rev && email.sends > 0 ? safeDiv(rev.revenue, email.sends) : 0;
    return {
      email,
      rev,
      brand: detectBrand(email.name, email.fromName),
      matchStatus,
      whyEmpty: rev && rev.revenue > 0 ? null : whyEmpty,
      rps,
    };
  }).sort((a, b) => {
    const ra = a.rev?.revenue ?? 0;
    const rb = b.rev?.revenue ?? 0;
    if (rb !== ra) return rb - ra;
    return b.email.openRate - a.email.openRate;
  });

  // How many HubSpot emails share each GA campaign name (for safe row-level $)
  const revShareCount = new Map<string, number>();
  for (const w of winnerRows) {
    if (!w.rev) continue;
    revShareCount.set(w.rev.campaignName, (revShareCount.get(w.rev.campaignName) ?? 0) + 1);
  }

  const rankedGa = filteredRevCampaigns.slice().sort((a, b) => b.revenue - a.revenue);
  const unmatchedGaRev = rankedGa
    .filter(c => !matchedKeys.has(c.campaignName) || c.campaignName === '(not set)')
    .reduce((s, c) => s + c.revenue, 0);

  const momNote = (() => {
    if (!hasMoM) return null;
    const bits: string[] = [];
    if (prevData) {
      const openDelta = (avgOpenRate - (prevData.avgOpenRate ?? 0)) * 100;
      if (Math.abs(openDelta) >= 0.3) bits.push(`Open rate ${openDelta > 0 ? 'up' : 'down'} ${Math.abs(openDelta).toFixed(1)}pp`);
    }
    if (prevRevenue > 0 && gaConnected) {
      const revDelta = ((totalRevenue - prevRevenue) / prevRevenue) * 100;
      if (Math.abs(revDelta) >= 1) bits.push(`revenue ${revDelta > 0 ? 'up' : 'down'} ${Math.abs(revDelta).toFixed(0)}%`);
    }
    if (prevSends > 0) {
      const sendDelta = ((totalSends - prevSends) / prevSends) * 100;
      if (Math.abs(sendDelta) >= 5) bits.push(`sends ${sendDelta > 0 ? 'up' : 'down'} ${Math.abs(sendDelta).toFixed(0)}%`);
    }
    if (!bits.length) return `vs ${monthLabel(getPrevMonth(selectedMonth))}`;
    return `vs ${monthLabel(getPrevMonth(selectedMonth))}: ${bits.join(' · ')}`;
  })();

  const handleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('desc'); }
  };
  const arw = (col: SortKey) => sortKey === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  const sorted = [...campaigns].sort((a, b) => {
    const diff = getSortNum(a, sortKey, revenueMap) - getSortNum(b, sortKey, revenueMap);
    return sortDir === 'asc' ? diff : -diff;
  });
  const groups = (gaConnected && !revLoading) ? buildGroups(sorted, revenueMap, sortKey) : null;
  const matchedCount = winnerRows.filter(r => r.matchStatus === 'matched').length;

  const displayRows: WinnerRow[] = (sortKey === 'revenue' && sortDir === 'desc')
    ? winnerRows
    : sorted.map(email => {
        const rev = lookupRevenue(email.name, email.hsCampaignName, revenueMap);
        return {
          email,
          rev,
          brand: detectBrand(email.name, email.fromName),
          matchStatus: (rev ? (rev.campaignName === '(not set)' ? 'not_set_pool' : 'matched') : 'unmatched') as WinnerRow['matchStatus'],
          whyEmpty: rev && rev.revenue > 0
            ? null
            : (rev ? 'Matched campaign, no purchases in range' : 'No GA campaign tag match — check utm_campaign on the send'),
          rps: rev && email.sends > 0 ? safeDiv(rev.revenue, email.sends) : 0,
        };
      });

  const visibleRows = showAll ? displayRows : displayRows.slice(0, 12);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4 md:py-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Marketing</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {monthLabel(selectedMonth)} · {brandShort} · HubSpot performance + GA email revenue
            {hasMoM ? ` · ${momNote}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
            Trend
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

      {!loading && data && !data.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
          <div className="text-amber-700 font-medium mb-1">HubSpot not connected</div>
          <div className="text-sm text-amber-600">Add <code className="bg-amber-100 px-1 rounded">HUBSPOT_API_KEY</code> to Vercel.</div>
        </div>
      )}

      {!loading && !data && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center mb-6">
          <div className="text-gray-700 font-medium mb-1">Could not load email data</div>
          <div className="text-sm text-gray-500">Try selecting the month again, or refresh the page.</div>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading campaigns&hellip;</div>
      )}
      {loading && data && (
        <div className="text-xs text-gray-400 mb-3">Refreshing campaigns&hellip;</div>
      )}

      {data?.connected && (
        <>
          {showTrend && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
              <div className="mb-4">
                <span className="text-sm font-medium text-gray-700">12-month open / click / unsub trend</span>
                {selectedMonth && <span className="ml-2 text-xs text-indigo-500">· {monthLabel(selectedMonth)} highlighted</span>}
              </div>
              {trendLoading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading trend…</div>}
              {!trendLoading && trendData && <TrendChart data={trendData} selectedMonth={selectedMonth} />}
              {!trendLoading && !trendData && <div className="text-sm text-red-500 text-center py-8">Could not load trend data.</div>}
            </div>
          )}

          {/* 1. Summary strip */}
          <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-800">At a glance</div>
              <div className="text-xs text-gray-500">{rangeLabel} · {revSourceLabel}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-gray-100">
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Sends</div>
                <div className="text-2xl font-bold text-gray-900">{fmt(totalSends)}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  {fmt(campaigns.length)} emails
                  {hasMoM && <MomDelta curr={totalSends} prev={prevSends} />}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Open rate</div>
                <div className={`text-2xl font-bold ${openColors(avgOpenRate).text}`}>{pct(avgOpenRate)}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  {fmt(totalOpens)} opens
                  {hasMoM && <MomDelta curr={avgOpenRate} prev={prevData?.avgOpenRate ?? 0} />}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Click rate</div>
                <div className={`text-2xl font-bold ${clkColors(avgClickRate).text}`}>{pct(avgClickRate)}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  CTOR {pct(avgCtor)}
                  {hasMoM && <MomDelta curr={avgClickRate} prev={prevData?.avgClickRate ?? 0} />}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Email revenue</div>
                <div className="text-2xl font-bold text-emerald-700">
                  {revLoading ? '…' : gaConnected ? fmtAUD2(totalRevenue) : '—'}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  {gaConnected ? `${fmt(totalRevTx)} orders` : 'GA offline'}
                  {hasMoM && gaConnected && <MomDelta curr={totalRevenue} prev={prevRevenue} />}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Best campaign</div>
                {topRevCampaign ? (
                  <>
                    <div className="text-sm font-semibold text-gray-900 truncate" title={topRevCampaign.campaignName}>
                      {stripNumericPrefix(topRevCampaign.campaignName)}
                    </div>
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">{fmtAUD2(topRevCampaign.revenue)}</div>
                  </>
                ) : bestOpenRate ? (
                  <>
                    <div className="text-sm font-semibold text-gray-900 truncate" title={bestOpenRate.name}>{bestOpenRate.name}</div>
                    <div className="text-lg font-bold text-green-600 mt-0.5">{pct(bestOpenRate.openRate)} open</div>
                  </>
                ) : (
                  <div className="text-sm text-gray-400 mt-1">No sends yet</div>
                )}
              </div>
            </div>
            {momNote && hasMoM && (
              <div className="px-5 py-2.5 bg-slate-50 border-t border-gray-100 text-xs text-slate-600">{momNote}</div>
            )}
          </div>

          {/* 2. Split panels */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">

            {/* HubSpot engagement */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-800">1. Email performance</div>
                <div className="text-xs text-gray-500 mt-0.5">HubSpot sends, opens, clicks — engagement quality</div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-gray-100">
                <div className="bg-white px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Delivery</div>
                  <div className={`text-lg font-bold ${deliveryRate > 0 && deliveryRate < 0.95 ? 'text-red-600' : 'text-gray-900'}`}>{pct(deliveryRate)}</div>
                  <div className="text-xs text-gray-400">{fmt(totalDelivered)} delivered</div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Unsub rate</div>
                  <div className={`text-lg font-bold ${unsubColor(unsubRate)}`}>{pct(unsubRate)}</div>
                  <div className="text-xs text-gray-400">{fmt(totalUnsubs)} unsubscribes</div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Best open</div>
                  {bestOpenRate ? (
                    <>
                      <div className="text-lg font-bold text-green-600">{pct(bestOpenRate.openRate)}</div>
                      <div className="text-xs text-gray-500 truncate" title={bestOpenRate.name}>{bestOpenRate.name}</div>
                    </>
                  ) : <div className="text-sm text-gray-400">—</div>}
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">Best CTOR</div>
                  {bestCtor ? (
                    <>
                      <div className={`text-lg font-bold ${ctorColor(bestCtor.clickToOpen)}`}>{pct(bestCtor.clickToOpen)}</div>
                      <div className="text-xs text-gray-500 truncate" title={bestCtor.name}>{bestCtor.name}</div>
                    </>
                  ) : <div className="text-sm text-gray-400">—</div>}
                </div>
              </div>
              <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
                <span>Open: <span className="text-green-600">20%+</span> / <span className="text-yellow-600">15–20%</span> / <span className="text-red-500">&lt;15%</span></span>
                <span>Click: <span className="text-green-600">3%+</span> / <span className="text-yellow-600">1.5–3%</span> / <span className="text-red-500">&lt;1.5%</span></span>
              </div>
            </div>

            {/* GA revenue ranking */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800">2. Revenue by campaign</div>
                  <div className="text-xs text-gray-500 mt-0.5">{revSourceLabel}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-lg font-bold text-emerald-700">{revLoading ? '…' : gaConnected ? fmtAUD2(totalRevenue) : '—'}</div>
                  <div className="text-[11px] text-gray-400">{gaConnected ? `${fmt(totalRevTx)} orders · $${revPerSend.toFixed(3)}/send` : 'not connected'}</div>
                </div>
              </div>

              {!gaConnected && !revLoading && (
                <div className="px-5 py-6 text-sm text-blue-700 bg-blue-50">GA not connected — add service account JSON to Vercel.</div>
              )}
              {revLoading && (
                <div className="px-5 py-6 text-sm text-gray-400">Loading revenue…</div>
              )}
              {gaConnected && !revLoading && rankedGa.length === 0 && (
                <div className="px-5 py-6 text-sm text-gray-400">No email-attributed revenue in this range.</div>
              )}
              {gaConnected && !revLoading && rankedGa.length > 0 && (
                <div className="divide-y divide-gray-50 max-h-[320px] overflow-y-auto">
                  {rankedGa.map((c, i) => {
                    const isMatched = matchedKeys.has(c.campaignName);
                    const isNotSet = c.campaignName === '(not set)';
                    const label = isNotSet ? '(not set) — missing utm_campaign' : stripNumericPrefix(c.campaignName);
                    return (
                      <div key={`${c.brand ?? 'x'}-${c.campaignName}`} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="w-5 text-xs text-gray-400 font-mono text-right flex-shrink-0">{i + 1}</span>
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            isNotSet ? 'bg-amber-400' : isMatched ? 'bg-emerald-400' : 'bg-gray-300'
                          }`}
                          title={isNotSet ? 'Revenue without campaign tag' : isMatched ? 'Matched to a HubSpot email' : 'No HubSpot match'}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-gray-800 truncate" title={c.campaignName}>{label}</div>
                          <div className="text-[11px] text-gray-400">
                            {isNotSet ? 'Real $ but not tied to a named send'
                              : isMatched ? 'Matched to HubSpot'
                              : 'No HubSpot match'}
                            {c.brand ? ` · ${c.brand.toUpperCase()}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-mono font-semibold text-emerald-700 text-sm">{fmtAUD2(c.revenue)}</div>
                          <div className="text-[11px] text-gray-400">{fmt(c.transactions)} tx</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {gaConnected && !revLoading && unmatchedGaRev > 0 && (
                <div className="px-4 py-2 border-t border-amber-100 bg-amber-50 text-[11px] text-amber-800">
                  {fmtAUD2(unmatchedGaRev)} of email revenue has no clean HubSpot campaign match (often (not set)).
                </div>
              )}
            </div>
          </div>

          {/* 3. Winners table */}
          {campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No campaigns sent in {monthLabel(selectedMonth)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
              <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800">3. Campaign winners</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Ranked by revenue, then open rate · green = GA match · grey = no match · amber = (not set)
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {campaigns.length} emails · {matchedCount} matched
                </div>
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                      <th className="text-left px-2 py-2.5 font-medium w-8"> </th>
                      <th className="text-left px-3 py-2.5 font-medium">Campaign</th>
                      <th className="text-left px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sentAt')}>Sent{arw('sentAt')}</th>
                      <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('sends')}>Sends{arw('sends')}</th>
                      <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('openRate')}>Open{arw('openRate')}</th>
                      <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('clickRate')}>Click{arw('clickRate')}</th>
                      <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('ctor')}>CTOR{arw('ctor')}</th>
                      <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('unsubRate')}>Unsub{arw('unsubRate')}</th>
                      {gaConnected && (
                        <>
                          <th className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('revenue')}>Revenue{arw('revenue')}</th>
                          <th className="text-right px-4 py-2.5 font-medium">$/send</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => {
                      const c = row.email;
                      const oc = openColors(c.openRate);
                      const cc = clkColors(c.clickRate);
                      const ur = safeDiv(c.unsubscribes, c.sends);
                      const soleMatch = !!(row.rev && (revShareCount.get(row.rev.campaignName) ?? 0) === 1);
                      const showRev = soleMatch ? row.rev : null;
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors border-t border-gray-50">
                          <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{i + 1}</td>
                          <td className="px-2 py-2.5">
                            <span
                              className={`inline-block w-2.5 h-2.5 rounded-full ${
                                row.matchStatus === 'matched' ? 'bg-emerald-400'
                                : row.matchStatus === 'not_set_pool' ? 'bg-amber-400'
                                : 'bg-gray-300'
                              }`}
                              title={row.whyEmpty ?? (row.matchStatus === 'matched' ? `Matched: ${row.rev?.campaignName}` : '')}
                            />
                          </td>
                          <td className="px-3 py-2.5 max-w-[240px]">
                            <div className="font-medium text-gray-800 truncate text-sm" title={c.name}>{c.name}</div>
                            {c.subject && <div className="text-xs text-gray-400 truncate mt-0.5" title={c.subject}>{c.subject}</div>}
                            {row.whyEmpty && (
                              <div className="text-[11px] text-amber-700 mt-0.5 truncate" title={row.whyEmpty}>{row.whyEmpty}</div>
                            )}
                            {!soleMatch && row.rev && row.rev.revenue > 0 && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Shared pot {fmtAUD2(row.rev.revenue)} · see group below
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">{sentDate(c.sentAt)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700 font-mono text-xs">{fmt(c.sends)}</td>
                          <td className={`px-3 py-2.5 text-right font-medium text-xs tabular-nums ${oc.text}`}>{pct(c.openRate)}</td>
                          <td className={`px-3 py-2.5 text-right font-medium text-xs tabular-nums ${cc.text}`}>{pct(c.clickRate)}</td>
                          <td className={`px-3 py-2.5 text-right font-medium text-xs tabular-nums ${c.opens > 0 ? ctorColor(c.clickToOpen) : 'text-gray-300'}`}>{c.opens > 0 ? pct(c.clickToOpen) : '—'}</td>
                          <td className={`px-3 py-2.5 text-right font-medium text-xs tabular-nums ${c.sends > 0 ? unsubColor(ur) : 'text-gray-300'}`}>{c.sends > 0 ? pct(ur) : '—'}</td>
                          {gaConnected && (
                            <>
                              <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-700">
                                {showRev && showRev.revenue > 0
                                  ? fmtAUD2(showRev.revenue)
                                  : <span className="text-gray-300" title={row.whyEmpty ?? undefined}>—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600">
                                {showRev && showRev.revenue > 0 && c.sends > 0
                                  ? `$${safeDiv(showRev.revenue, c.sends).toFixed(3)}`
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {campaigns.length > 12 && (
                <div className="px-5 py-3 text-center border-t border-gray-100">
                  <button onClick={() => setShowAll(v => !v)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                    {showAll ? 'Show less' : `Show all ${campaigns.length} campaigns`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Shared GA pots */}
          {gaConnected && groups && groups.some(g => g.emails.length > 1 && g.key !== '__unmatched__') && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
              <button className="w-full flex items-center justify-between px-5 py-3 text-left" onClick={() => setShowGa4Panel(v => !v)}>
                <span className="text-sm font-medium text-gray-700">Shared GA campaigns (multiple emails → one revenue pot)</span>
                <span className="text-xs text-gray-400">{showGa4Panel ? 'hide ↑' : 'show ↓'}</span>
              </button>
              {showGa4Panel && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {groups.filter(g => g.emails.length > 1 && g.key !== '__unmatched__').map(g => (
                    <div key={g.key} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-sm font-medium text-gray-800 truncate">{g.label}</div>
                        <div className="font-mono font-semibold text-emerald-700 text-sm flex-shrink-0">{g.rev ? fmtAUD2(g.rev.revenue) : '—'}</div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {g.emails.length} emails share this campaign total
                        {g.rev && g.rev.transactions > 0 ? ` · ${fmt(g.rev.transactions)} tx` : ''}
                        {' · '}
                        {g.emails.map(e => e.name).join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trust strip */}
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-xs text-gray-500 leading-relaxed">
            <span className="font-medium text-gray-700">How to read this: </span>
            Sends / open / click come from <span className="text-gray-700">HubSpot</span>.
            Revenue is <span className="text-gray-700">GA4 purchase revenue</span> where session medium = email
            ({revSourceLabel}), range capped to today ({rangeLabel}).
            Not HubSpot “revenue” and not Google Ads ROAS.
            Brand filter switches the GA property (PP ≠ ETZ).
            Grey dots = no utm match; amber = (not set) revenue pool.
          </div>
        </>
      )}
    </div>
  );
}
