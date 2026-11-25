'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Sales {
  orders: number; revenue: number; refunds: number; discounts: number; discountedOrders: number;
  byDay: Record<string, { revenue: number; orders: number }>;
  bySource: { source: string; orders: number; revenue: number }[];
  byDiscountCode: { code: string; orders: number; revenue: number }[];
  byCampaign?: { campaign: string; channel: string; orders: number; revenue: number }[];
}
interface AdsBlock {
  configured?: boolean; error?: string | null; spend?: number; priorSpend?: number | null; paidRevenue?: number; paidOrders?: number; roas?: number | null; unattributedRevenue?: number;
  campaigns?: { id: string; name: string; spend: number; clicks: number; impressions: number; revenue: number; orders: number; roas: number | null }[];
  unmatched?: { campaign: string; orders: number; revenue: number }[];
}
interface GoogleAdsBlock {
  configured?: boolean; error?: string | null; spend?: number; priorSpend?: number | null; paidRevenue?: number; paidOrders?: number; roas?: number | null;
  shoppingMixedRevenue?: number; shoppingMixedOrders?: number; googleConvValue?: number;
  campaigns?: { name: string; spend: number; clicks: number; conversions: number; convValue: number; roas: number | null }[];
}
interface Item { title: string; units: number | null; revenue: number }
interface Resp { ads?: AdsBlock; googleAds?: GoogleAdsBlock; configured?: boolean; error?: string; priorSource?: 'orders' | 'report' | null; priorError?: string | null; period?: { start: string; end: string }; comparison?: { start: string; end: string } | null; current?: Sales; prior?: Sales | null; products?: Item[] | null; priorProducts?: Item[] | null; productsError?: string | null }

type RangeKey = 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7 days' }, { key: 'last30', label: 'Last 30 days' },
  { key: 'mtd', label: 'This month' }, { key: 'lastmonth', label: 'Last month' },
];

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function addDays(ymd: string, n: number): string { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000) + 1;
const shortDay = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m! - 1]}`; };
const minusYear = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y! - 1, m! - 1, d!, 12)).toISOString().slice(0, 10); };

function rangeDates(key: RangeKey): { start: string; end: string } {
  const today = sydneyToday();
  switch (key) {
    case 'yesterday': { const y = addDays(today, -1); return { start: y, end: y }; }
    case 'last7': return { start: addDays(today, -6), end: today };
    case 'last30': return { start: addDays(today, -29), end: today };
    case 'mtd': return { start: `${today.slice(0, 7)}-01`, end: today };
    case 'lastmonth': {
      const [y, m] = today.split('-').map(Number);
      const first = new Date(Date.UTC(y!, m! - 2, 1, 12)), last = new Date(Date.UTC(y!, m! - 1, 0, 12));
      return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
    }
  }
}

/** Change against the comparison period, as a small pill. Hidden when there is nothing sensible to compare with. */
function Delta({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev == null || prev <= 0) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p > 500) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">no comparison (store was barely trading)</span>;
  const up = p >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(p)}%
    </span>
  );
}

function Icon({ name }: { name: 'orders' | 'basket' | 'tag' | 'net' }) {
  const paths = {
    orders: 'M3 6h18M3 12h18M3 18h12',
    basket: 'M5 9h14l-1.2 9.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 9Zm4-4 3-3 3 3',
    tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm5-5.5h.01',
    net: 'M12 2v20M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  } as const;
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function Stat({ label, value, sub, icon, color, delta }: { label: string; value: string; sub?: string; icon: 'orders' | 'basket' | 'tag' | 'net'; color: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}><Icon name={icon} /></span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-2xl font-bold tabular-nums text-gray-900">{value}</span>{delta}</div>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {note && <p className="mb-3 mt-0.5 text-xs text-gray-400">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

/** One ranked row: label, share-of-total bar, and values on the right. */
function BarRow({ rank, label, tag, tagTone, value, share, color, extra, extra2 }: { rank: number; label: React.ReactNode; tag?: string; tagTone?: string; value: string; share: number; color: string; extra?: string; extra2?: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums text-gray-300">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-gray-800">{label}</span>
          {tag && <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline ${tagTone ?? 'bg-gray-100 text-gray-500'}`}>{tag}</span>}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: color, opacity: 0.85 }} /></div>
      </div>
      {extra && <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-500">{extra}</span>}
      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">{value}</span>
      {extra2 !== undefined && <span className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-400">{extra2}</span>}
    </li>
  );
}

const channelTone = (ch: string) =>
  ch.includes('paid') ? 'bg-emerald-50 text-emerald-700'
  : ch.includes('Shopping (') ? 'bg-violet-50 text-violet-700'
  : ch.includes('organic search') || ch.includes('Shopping listings') ? 'bg-sky-50 text-sky-700'
  : ch.includes('no ad tag') ? 'bg-amber-50 text-amber-700'
  : ch === 'Direct' ? 'bg-slate-100 text-slate-600'
  : 'bg-gray-100 text-gray-500';

interface OverlapProduct { itemId: string; title: string; campaigns: string[]; cost: number; clicks: number; conversions: number; convValue: number }
interface OverlapResp {
  error?: string;
  pp?: { totalCost: number; products: number; error: string | null };
  esg?: { totalCost: number; products: number; error: string | null };
  pairs?: { pp: OverlapProduct; esg: OverlapProduct; match: 'exact' | 'close'; ppSales?: { revenue: number; units: number } | null; esgSales?: { revenue: number; units: number | null } | null }[];
  sales?: { pp: number; esg: number; ppError: string | null; esgError: string | null };
  overlapCost?: { pp: number; esg: number };
  ppInternal?: { title: string; campaigns: { name: string; cost: number }[]; cost: number }[];
  ppInternalCost?: number;
}

/** Products both stores advertise on Google Shopping: the two accounts bid against each other for these. */
function ShoppingOverlapSection({ start, end }: { start: string; end: string }) {
  const [d, setD] = useState<OverlapResp | null>(null);
  const [withSales, setWithSales] = useState<OverlapResp | null>(null);
  const [salesState, setSalesState] = useState<'loading' | 'done' | 'too-long' | 'error'>('loading');
  const [showAll, setShowAll] = useState(false);
  const tooLong = daysBetween(start, end) > 35;
  useEffect(() => {
    let cancelled = false;
    setD(null); setWithSales(null); setSalesState(tooLong ? 'too-long' : 'loading');
    fetch(`/api/shopping-overlap?start=${start}&end=${end}`)
      .then(r => r.json() as Promise<OverlapResp>)
      .then(j => { if (!cancelled) setD(j); })
      .catch(e => { if (!cancelled) setD({ error: e instanceof Error ? e.message : 'Failed to load' }); });
    // store sales take longer (every Pascal Press order's line items), so they arrive second and fill the table in
    if (!tooLong) {
      fetch(`/api/shopping-overlap?start=${start}&end=${end}&sales=1`)
        .then(r => r.json() as Promise<OverlapResp>)
        .then(j => { if (!cancelled) { if (j.error) setSalesState('error'); else { setWithSales(j); setSalesState('done'); } } })
        .catch(() => { if (!cancelled) setSalesState('error'); });
    }
    return () => { cancelled = true; };
  }, [start, end, tooLong]);
  const salesOf = new Map((withSales?.pairs ?? []).map(x => [`${x.pp.itemId}|${x.esg.itemId}`, x]));
  const salesCell = (v: number | undefined) => salesState === 'done' ? (v != null ? AUD.format(v) : '–') : salesState === 'loading' ? <span className="inline-block h-3 w-12 animate-pulse rounded bg-gray-100" /> : '–';
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');
  const pairs = d?.pairs ?? [];
  const shown = showAll ? pairs : pairs.slice(0, 15);
  return (
    <Section title="Google Shopping overlap with Pascal Press" note="Products both stores advertise on Google Shopping in this period. Paired by product title, so check any 'close' match by eye.">
      {!d ? <div className="h-24 animate-pulse rounded-xl bg-gray-100" /> : d.error ? <p className="text-sm text-red-600">{d.error}</p> : (
        <>
          {(d.pp?.error || d.esg?.error) && <p className="mb-3 text-sm text-red-600">{d.pp?.error ? `Pascal Press: ${d.pp.error}. ` : ''}{d.esg?.error ? `Excel Study Guides: ${d.esg.error}` : ''}</p>}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Products in both</p><p className="text-xl font-bold tabular-nums text-gray-900">{pairs.length}</p><p className="text-xs text-gray-400">of {d.esg?.products ?? 0} ESG / {d.pp?.products ?? 0} PP products shown</p></div>
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Pascal Press spend on them</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(d.overlapCost?.pp ?? 0)}</p><p className="text-xs text-gray-400">{pct(d.overlapCost?.pp ?? 0, d.pp?.totalCost ?? 0)} of its {AUD.format(d.pp?.totalCost ?? 0)} Shopping spend</p></div>
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">ESG spend on them</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(d.overlapCost?.esg ?? 0)}</p><p className="text-xs text-gray-400">{pct(d.overlapCost?.esg ?? 0, d.esg?.totalCost ?? 0)} of its {AUD.format(d.esg?.totalCost ?? 0)} Shopping spend</p></div>
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Combined on the same books</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format((d.overlapCost?.pp ?? 0) + (d.overlapCost?.esg ?? 0))}</p><p className="text-xs text-gray-400">both accounts in the same auctions</p></div>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3 sm:grid-cols-3">
            {salesState === 'too-long' ? <p className="text-xs text-gray-500 sm:col-span-3">Store sales for these products can be shown for up to 35 days at a time. Pick a shorter range to see them.</p>
              : salesState === 'error' ? <p className="text-xs text-amber-700 sm:col-span-3">Could not read store sales for these products. Spend figures above are still correct.</p>
              : (() => {
                const s = withSales?.sales; const ppCost = d.overlapCost?.pp ?? 0, esgCost = d.overlapCost?.esg ?? 0, cost = ppCost + esgCost;
                const tot = s ? s.pp + s.esg : null;
                return (<>
                  <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Pascal Press sales of these books</p><p className="text-lg font-bold tabular-nums text-gray-900">{s ? AUD.format(s.pp) : salesCell(undefined)}</p><p className="text-xs text-gray-400">{s && ppCost > 0 ? `${(s.pp / ppCost).toFixed(1)}x its spend on them` : 'BigCommerce, all channels'}</p></div>
                  <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">ESG sales of these books</p><p className="text-lg font-bold tabular-nums text-gray-900">{s ? AUD.format(s.esg) : salesCell(undefined)}</p><p className="text-xs text-gray-400">{s && esgCost > 0 ? `${(s.esg / esgCost).toFixed(1)}x its spend on them` : 'Shopify, all channels'}</p></div>
                  <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Combined sales</p><p className="text-lg font-bold tabular-nums text-gray-900">{tot != null ? AUD.format(tot) : salesCell(undefined)}</p><p className="text-xs text-gray-400">{tot != null && cost > 0 ? `${(tot / cost).toFixed(1)}x the combined ${AUD.format(cost)} spend` : 'ex GST and shipping'}</p></div>
                </>);
              })()}
          </div>
          {pairs.length === 0 ? <p className="text-sm text-gray-400">No products advertised by both stores in this period.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead><tr className="text-left text-[11px] text-gray-400">
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 text-right font-medium">PP spend</th><th className="py-1 text-right font-medium">PP clicks</th><th className="py-1 text-right font-medium">PP sales</th>
                  <th className="py-1 text-right font-medium">ESG spend</th><th className="py-1 text-right font-medium">ESG clicks</th><th className="py-1 text-right font-medium">ESG sales</th>
                </tr></thead>
                <tbody>{shown.map(x => (
                  <tr key={`${x.pp.itemId}|${x.esg.itemId}`} className="border-t border-gray-50 align-top">
                    <td className="py-1.5 pr-3 text-gray-800">
                      {x.pp.title}
                      {x.match === 'close' && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">close match</span>}
                      {x.match === 'close' && <p className="text-[11px] text-gray-400">ESG: {x.esg.title}</p>}
                    </td>
                    <td className="py-1.5 text-right text-gray-700">{AUD.format(x.pp.cost)}</td><td className="py-1.5 text-right text-gray-500">{x.pp.clicks.toLocaleString()}</td><td className="py-1.5 text-right font-medium text-gray-900">{salesCell(salesOf.get(`${x.pp.itemId}|${x.esg.itemId}`)?.ppSales?.revenue)}</td>
                    <td className="py-1.5 text-right text-gray-700">{AUD.format(x.esg.cost)}</td><td className="py-1.5 text-right text-gray-500">{x.esg.clicks.toLocaleString()}</td><td className="py-1.5 text-right font-medium text-gray-900">{salesCell(salesOf.get(`${x.pp.itemId}|${x.esg.itemId}`)?.esgSales?.revenue)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {pairs.length > 15 && <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs font-semibold text-blue-600 hover:underline">{showAll ? 'Show fewer' : `Show all ${pairs.length}`}</button>}
            </div>
          )}
          {(d.ppInternal ?? []).length > 0 && (
            <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <p className="text-xs font-semibold text-gray-700">Also: Pascal Press runs {(d.ppInternal ?? []).length}{(d.ppInternal ?? []).length >= 40 ? '+' : ''} products in two or more of its own Shopping campaigns ({AUD.format(d.ppInternalCost ?? 0)} on those products)</p>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-500">
                {(d.ppInternal ?? []).slice(0, 8).map(x => <li key={x.title}><span className="text-gray-700">{x.title}</span>: {x.campaigns.map(c => `${c.name.replace(/^Pascal Press\s*-\s*/, '')} ${AUD.format(c.cost)}`).join(' · ')}</li>)}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">Spend and conversions are as Google Ads reports them for Shopping (including Performance Max product ads). Sales are what each book sold on that store in the period from every channel (not only Shopping ads), before GST and shipping: BigCommerce for Pascal Press, Shopify for Excel Study Guides.</p>
        </>
      )}
    </Section>
  );
}

export default function EsgPanel({ color }: { color: string }) {
  const [range, setRange] = useState<RangeKey>('mtd');
  const [yoy, setYoy] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const { start, end, compStart, compEnd } = useMemo(() => {
    const r = rangeDates(range);
    if (yoy) return { ...r, compStart: minusYear(r.start), compEnd: minusYear(r.end) };
    const len = daysBetween(r.start, r.end);
    return { ...r, compStart: addDays(r.start, -len), compEnd: addDays(r.start, -1) };
  }, [range, yoy]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/esg-sales?start=${start}&end=${end}&compStart=${compStart}&compEnd=${compEnd}`)
      .then(async res => {
        const json = (await res.json()) as Resp;
        if (!cancelled) setData(res.status === 401 ? { error: 'Please sign in to the planner again.' } : json);
      })
      .catch(e => { if (!cancelled) setData({ error: e instanceof Error ? e.message : 'Failed to load' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [start, end, compStart, compEnd]);

  const c = data?.current, p = data?.prior;
  const aov = c && c.orders > 0 ? c.revenue / c.orders : 0, aovPrev = p && p.orders > 0 ? p.revenue / p.orders : null;
  const chart = useMemo(() => {
    if (!c) return [];
    const out: { date: string; revenue: number; orders: number }[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, revenue: c.byDay[d]?.revenue ?? 0, orders: c.byDay[d]?.orders ?? 0 });
    return out;
  }, [c, start, end]);
  const best = useMemo(() => chart.reduce((a, b) => (b.revenue > a.revenue ? b : a), { date: '', revenue: 0, orders: 0 }), [chart]);

  const sources = c?.bySource ?? [];
  const srcMax = Math.max(1, ...sources.map(s => s.revenue));
  const items = data?.products ?? [];
  const itemMax = Math.max(1, ...items.map(i => i.revenue));
  const prevItems = new Map((data?.priorProducts ?? []).map(x => [x.title, x]));
  const showUnits = items.some(i => i.units != null);
  const gradId = 'esgFill';
  // revenue after ad spend: all Shopify revenue less Meta and Google Ads spend
  const metaOk = Boolean(data?.ads?.configured && !data.ads.error);
  const gOk = Boolean(data?.googleAds?.configured && !data.googleAds.error);
  const metaSpend = metaOk ? (data?.ads?.spend ?? 0) : 0;
  const googleSpend = gOk ? (data?.googleAds?.spend ?? 0) : 0;
  const adSpend = metaSpend + googleSpend;
  const showNet = Boolean(c && adSpend > 0);
  const netNow = (c?.revenue ?? 0) - adSpend;
  const priorAd = (metaOk ? data?.ads?.priorSpend : 0) ?? null;
  const priorG = (gOk ? data?.googleAds?.priorSpend : 0) ?? null;
  const netPrev = p && priorAd != null && priorG != null ? p.revenue - priorAd - priorG : null;
  const spendWords = [metaSpend > 0 ? `${AUD.format(metaSpend)} Facebook & Instagram` : '', googleSpend > 0 ? `${AUD.format(googleSpend)} Google Ads` : ''].filter(Boolean).join(' + ');
  const g = data?.googleAds;

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${range === r.key ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
              style={range === r.key ? { background: color } : undefined}>{r.label}</button>
          ))}
        </div>
        <button type="button" role="switch" aria-checked={yoy} onClick={() => setYoy(v => !v)}
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:border-gray-300">
          <span className="relative inline-block h-4 w-7 rounded-full transition-colors" style={{ background: yoy ? color : '#d1d5db' }}>
            <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: yoy ? 14 : 2 }} />
          </span>
          Compare with same dates last year
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />)}</div>
        </div>
      )}
      {!loading && data?.configured === false && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Shopify is not connected yet: the store settings are missing in Vercel.</div>}
      {!loading && data?.error && data.configured !== false && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load Shopify sales: {data.error}</div>}

      {!loading && c && (
        <>
          {/* hero: revenue + daily trend */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="p-5 pb-0" style={{ background: `linear-gradient(180deg, ${color}12 0%, transparent 100%)` }}>
              <p className="text-xs font-medium text-gray-500">
                Excel Study Guides · {start === end ? shortDay(start) : `${shortDay(start)} – ${shortDay(end)}`}
                <span className="text-gray-400"> · {yoy ? 'vs same dates last year' : 'vs previous period'}</span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="text-4xl font-bold tabular-nums tracking-tight text-gray-900">{AUD.format(c.revenue)}</span>
                <Delta cur={c.revenue} prev={p?.revenue} />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {p ? `Previous: ${AUD.format(p.revenue)}` : 'Revenue after refunds, including GST and shipping'}
                {best.revenue > 0 && chart.length > 1 && <> · Best day {shortDay(best.date)} ({AUD.format(best.revenue)})</>}
              </p>
            </div>
            <div role="img" aria-label="Daily revenue for the selected period" className="px-2 pb-2">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chart} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis width={46} tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: unknown) => [AUD.format(Number(v)), 'Revenue']} labelFormatter={(l: unknown) => shortDay(String(l))} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }} />
                  <Area type="monotone" dataKey="revenue" stroke={color} strokeWidth={2.5} fill={`url(#${gradId})`} dot={chart.length <= 31 ? { r: 2.5, fill: color, strokeWidth: 0 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {yoy && !p && <p className="text-xs text-amber-700">Last year&rsquo;s figures could not be loaded{data?.priorError ? `: ${data.priorError}` : '.'}</p>}
          {p && data?.priorSource === 'report' && <p className="text-xs text-gray-400">Last year&rsquo;s revenue, orders and discounts come from Shopify&rsquo;s sales report (no source or discount-code detail for last year).</p>}

          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${showNet ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            <Stat label="Orders" value={String(c.orders)} icon="orders" color={color} delta={<Delta cur={c.orders} prev={p?.orders} />} sub={p ? `Previous: ${p.orders}` : undefined} />
            <Stat label="Average order" value={AUD.format(aov)} icon="basket" color={color} delta={<Delta cur={aov} prev={aovPrev} />} sub={aovPrev != null ? `Previous: ${AUD.format(aovPrev)}` : undefined} />
            <Stat label="Discounts given" value={AUD.format(c.discounts)} icon="tag" color={color}
              sub={`${c.discountedOrders} of ${c.orders} orders used a code${c.refunds > 0 ? ` · ${AUD.format(c.refunds)} refunded` : ''}`} />
            {showNet && (
              <Stat label="Revenue after ad spend" value={AUD.format(netNow)} icon="net" color={color}
                delta={<Delta cur={netNow} prev={netPrev} />}
                sub={`${AUD.format(c.revenue)} revenue less ${spendWords} spend${netPrev != null ? ` · Previous: ${AUD.format(netPrev)}` : ''}`} />
            )}
          </div>

          {g?.configured && (
            <Section title="Google Ads" note="Google Ads spend by campaign against the sales Shopify credits to paid Google visits (last click)">
              {g.error ? <p className="text-sm text-red-600">Could not read the Google Ads account: {g.error}</p> : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ad spend</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(g.spend ?? 0)}</p>{g.priorSpend != null && <p className="text-xs text-gray-400">Previous: {AUD.format(g.priorSpend)}</p>}</div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Paid Google revenue</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(g.paidRevenue ?? 0)}</p><p className="text-xs text-gray-400">{g.paidOrders ?? 0} orders (Shopify)</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">ROAS</p><p className="text-xl font-bold tabular-nums text-gray-900">{g.roas != null ? `${g.roas}x` : '–'}</p><p className="text-xs text-gray-400">paid Google revenue / spend</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Google-reported value</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(g.googleConvValue ?? 0)}</p><p className="text-xs text-gray-400">{(g.spend ?? 0) > 0 && (g.googleConvValue ?? 0) > 0 ? `${((g.googleConvValue ?? 0) / (g.spend ?? 1)).toFixed(1)}x by Google's own count` : "Google's own conversion count"}</p></div>
                  </div>
                  {(g.campaigns ?? []).length === 0 ? <p className="text-sm text-gray-400">No Google Ads spend in this period.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <thead><tr className="text-left text-[11px] text-gray-400"><th className="py-1 font-medium">Campaign</th><th className="py-1 text-right font-medium">Spend</th><th className="py-1 text-right font-medium">Clicks</th><th className="py-1 text-right font-medium">Conversions</th><th className="py-1 text-right font-medium">Conv. value (Google)</th><th className="py-1 text-right font-medium">ROAS (Google)</th></tr></thead>
                        <tbody>{(g.campaigns ?? []).map(r => (
                          <tr key={r.name} className="border-t border-gray-50">
                            <td className="py-1.5 pr-3 text-gray-800">{r.name}</td>
                            <td className="py-1.5 text-right text-gray-600">{AUD.format(r.spend)}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-600">{r.conversions}</td>
                            <td className="py-1.5 text-right font-medium text-gray-900">{AUD.format(r.convValue)}</td>
                            <td className="py-1.5 text-right text-gray-700">{r.roas != null ? `${r.roas}x` : '–'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {(g.shoppingMixedRevenue ?? 0) > 0 && (
                    <p className="mt-3 text-[11px] text-gray-400">Not counted above: {AUD.format(g.shoppingMixedRevenue ?? 0)} ({g.shoppingMixedOrders ?? 0} orders) from Google Shopping clicks that Shopify cannot split between free listings and Shopping ads. Some of it is paid, so Google ROAS is somewhere between the Shopify and Google figures.</p>
                  )}
                </>
              )}
            </Section>
          )}

          {data?.ads?.configured && (
            <Section title="Facebook & Instagram ads" note="Meta spend by campaign against the sales Shopify credits to paid Facebook visits (last click)">
              {data.ads.error ? <p className="text-sm text-red-600">Could not read the Meta ad account: {data.ads.error}</p> : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ad spend</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(data.ads.spend ?? 0)}</p>{data.ads.priorSpend != null && <p className="text-xs text-gray-400">Previous: {AUD.format(data.ads.priorSpend)}</p>}</div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Paid Facebook revenue</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format(data.ads.paidRevenue ?? 0)}</p><p className="text-xs text-gray-400">{data.ads.paidOrders ?? 0} orders</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">ROAS</p><p className="text-xl font-bold tabular-nums text-gray-900">{data.ads.roas != null ? `${data.ads.roas}x` : '–'}</p><p className="text-xs text-gray-400">revenue inc GST / spend</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">After ad spend</p><p className="text-xl font-bold tabular-nums text-gray-900">{AUD.format((data.ads.paidRevenue ?? 0) - (data.ads.spend ?? 0))}</p><p className="text-xs text-gray-400">paid revenue less spend</p></div>
                  </div>
                  {(data.ads.campaigns ?? []).length === 0 ? <p className="text-sm text-gray-400">No Meta spend in this period.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <thead><tr className="text-left text-[11px] text-gray-400"><th className="py-1 font-medium">Campaign</th><th className="py-1 text-right font-medium">Spend</th><th className="py-1 text-right font-medium">Clicks</th><th className="py-1 text-right font-medium">Orders</th><th className="py-1 text-right font-medium">Revenue</th><th className="py-1 text-right font-medium">ROAS</th></tr></thead>
                        <tbody>{(data.ads.campaigns ?? []).map(r => (
                          <tr key={r.id} className="border-t border-gray-50">
                            <td className="py-1.5 pr-3 text-gray-800">{r.name}</td>
                            <td className="py-1.5 text-right text-gray-600">{AUD.format(r.spend)}</td>
                            <td className="py-1.5 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-600">{r.orders}</td>
                            <td className="py-1.5 text-right font-medium text-gray-900">{AUD.format(r.revenue)}</td>
                            <td className="py-1.5 text-right text-gray-700">{r.roas != null ? `${r.roas}x` : '–'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {((data.ads.unmatched ?? []).length > 0 || (data.ads.unattributedRevenue ?? 0) > 0) && (
                    <p className="mt-3 text-[11px] text-gray-400">
                      {(data.ads.unmatched ?? []).length > 0 && <>Paid Facebook sales under campaign tags that match no Meta campaign: {(data.ads.unmatched ?? []).map(u => `${u.campaign} (${AUD.format(u.revenue)})`).join(', ')}. </>}
                      {(data.ads.unattributedRevenue ?? 0) > 0 && <>Paid Facebook revenue with no campaign tag: {AUD.format(data.ads.unattributedRevenue ?? 0)}.</>}
                    </p>
                  )}
                </>
              )}
            </Section>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Where sales came from" note="Paid, organic and direct, from the visit that led to each order">
              {sources.length === 0 ? <p className="text-sm text-gray-400">No orders in this period.</p> : (
                <ul className="divide-y divide-gray-50">
                  {sources.map((s, i) => (
                    <BarRow key={s.source} rank={i + 1} label={s.source} value={AUD.format(s.revenue)} extra={`${s.orders} orders`} share={s.revenue / srcMax} color={color}
                      tag={s.source.includes('paid') ? 'paid' : s.source.includes('Shopping (') ? 'ads + free' : s.source.includes('Shopping listings') ? 'free listing' : s.source.includes('organic') ? 'organic' : s.source.includes('no ad tag') ? 'check tags' : undefined} tagTone={channelTone(s.source)} />
                  ))}
                </ul>
              )}
            </Section>

            <div className="space-y-5">
              <Section title="Campaigns" note="Orders whose link carried a campaign name">
                {!c.byCampaign || c.byCampaign.length === 0 ? <p className="text-sm text-gray-400">No orders came through links with a campaign name in this period.</p> : (
                  <ul className="divide-y divide-gray-50">
                    {c.byCampaign.map((s, i) => (
                      <BarRow key={s.channel + s.campaign} rank={i + 1} label={s.campaign} tag={s.channel.replace(/ – .*/, '')} tagTone={channelTone(s.channel)}
                        value={AUD.format(s.revenue)} extra={`${s.orders} orders`} share={s.revenue / Math.max(1, ...c.byCampaign!.map(x => x.revenue))} color={color} />
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-gray-400">Google Ads clicks are recognised as paid by their click ID even without a campaign name.</p>
              </Section>

              <Section title="Discount codes">
                {c.byDiscountCode.length === 0 ? <p className="text-sm text-gray-400">No discount codes used in this period.</p> : (
                  <ul className="divide-y divide-gray-50">
                    {c.byDiscountCode.map((s, i) => (
                      <BarRow key={s.code} rank={i + 1} label={<span className="font-mono text-xs">{s.code}</span>} value={AUD.format(s.revenue)} extra={`${s.orders} orders`}
                        share={s.revenue / Math.max(1, ...c.byDiscountCode.map(x => x.revenue))} color={color} />
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>

          <Section title="Revenue by item" note="Top 25 by revenue after discounts and refunds, before GST and shipping, so the total is lower than the revenue above">
            {!data?.products ? <p className="text-sm text-gray-400">Item sales could not be loaded{data?.productsError ? `: ${data.productsError}` : '.'}</p>
              : items.length === 0 ? <p className="text-sm text-gray-400">No item sales in this period.</p> : (
                <>
                  <div className="mb-1 flex items-center gap-3 pl-8 pr-0 text-[11px] font-medium text-gray-400">
                    <span className="flex-1">Item</span>
                    {showUnits && <span className="w-14 text-right">Units</span>}
                    <span className="w-20 text-right">Revenue</span>
                    {data.priorProducts && <span className="w-20 text-right">{yoy ? 'Last year' : 'Previous'}</span>}
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {items.map((it, i) => (
                      <BarRow key={it.title} rank={i + 1} label={it.title} value={AUD.format(it.revenue)} share={it.revenue / itemMax} color={color}
                        extra={showUnits ? String(it.units ?? '') : undefined}
                        extra2={data.priorProducts ? (prevItems.get(it.title) ? AUD.format(prevItems.get(it.title)!.revenue) : '–') : undefined} />
                    ))}
                  </ul>
                </>
              )}
          </Section>

          <ShoppingOverlapSection start={start} end={end} />

          <p className="text-[11px] text-gray-400">
            Revenue is each order&rsquo;s total including GST and shipping, less refunds; cancelled and test orders are left out.
          </p>
        </>
      )}
    </div>
  );
}
