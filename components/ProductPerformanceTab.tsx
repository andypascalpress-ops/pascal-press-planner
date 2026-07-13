'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types (mirror API) ──────────────────────────────────────────────────────

type ProductBrand = 'Pascal Press' | 'Blake Education' | 'Excel Test Zone' | 'Excel HSC Copilot';
type RangeKey = '30d' | '60d' | '90d' | 'mtd' | 'lastmonth';
type BrandFilter = 'All' | ProductBrand;
type ProductBucket = 'hot' | 'breakout' | 'steady' | 'low_volume' | 'declining' | 'dead' | 'cold';

interface ProductMetrics { revenue: number; orders: number; units: number; aov: number; }
interface ProductRow {
  name: string;
  rawName?: string;
  brand: ProductBrand;
  category: string;
  current: ProductMetrics;
  lastYear: ProductMetrics;
  yoyRevenuePct: number | null;
  yoyOrdersPct: number | null;
  yoyUnitsPct: number | null;
  status: 'hot' | 'steady' | 'soft' | 'cold' | 'new' | 'dead';
  bucket: ProductBucket;
  action: string;
  attentionScore: number;
  abandonedCarts?: number;
  abandonedValue?: number;
  abandonedUnits?: number;
}
interface Pareto {
  top10Revenue: number;
  top10SharePct: number;
  top20SharePct: number;
  productsFor80Pct: number;
}
interface ProductBuckets {
  winners: ProductRow[];
  breakouts: ProductRow[];
  declining: ProductRow[];
  cold: ProductRow[];
  lowVolume: ProductRow[];
  dead: ProductRow[];
  needsAttention: ProductRow[];
}
interface BrandSlice {
  brand: ProductBrand;
  source: 'bigcommerce' | 'stripe' | 'none';
  connected: boolean;
  summary: {
    revenue: number; units: number; orders: number; productsSold: number;
    lyRevenue: number; yoyRevenuePct: number | null;
    topProduct: string | null; topRevenue: number;
  };
  products: ProductRow[];
  top: ProductRow[];
  bottom: ProductRow[];
  declining: ProductRow[];
  buckets: ProductBuckets;
  pareto: Pareto;
  categories: string[];
}
interface ProductPerfData {
  connected: boolean;
  range: RangeKey;
  rangeLabel: string;
  currentLabel: string;
  lyLabel: string;
  byBrand: Record<ProductBrand, BrandSlice>;
  combined: {
    summary: BrandSlice['summary'];
    top: ProductRow[];
    bottom: ProductRow[];
    declining: ProductRow[];
    products: ProductRow[];
    buckets: ProductBuckets;
    pareto: Pareto;
    categories: string[];
  };
  meta: {
    notes: string[];
    sources: { brand: ProductBrand; source: string; connected: boolean }[];
    sampledOrdersNote?: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30d', label: 'Last 30 days' },
  { key: '60d', label: 'Last 60 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'lastmonth', label: 'Last month' },
];

const BRANDS: ProductBrand[] = [
  'Pascal Press', 'Excel Test Zone', 'Excel HSC Copilot', 'Blake Education',
];

const BRAND_SHORT: Record<ProductBrand, string> = {
  'Pascal Press': 'PP',
  'Excel Test Zone': 'ETZ',
  'Excel HSC Copilot': 'HSC',
  'Blake Education': 'Blake',
};

const BRAND_COLOR: Record<ProductBrand, string> = {
  'Pascal Press': 'bg-blue-600',
  'Excel Test Zone': 'bg-emerald-600',
  'Excel HSC Copilot': 'bg-teal-600',
  'Blake Education': 'bg-purple-600',
};

const BRAND_SOFT: Record<ProductBrand, string> = {
  'Pascal Press': 'bg-blue-50 border-blue-100 text-blue-800',
  'Excel Test Zone': 'bg-emerald-50 border-emerald-100 text-emerald-800',
  'Excel HSC Copilot': 'bg-teal-50 border-teal-100 text-teal-800',
  'Blake Education': 'bg-purple-50 border-purple-100 text-purple-800',
};

const STATUS_STYLE: Record<ProductRow['status'], string> = {
  hot: 'bg-emerald-100 text-emerald-800',
  steady: 'bg-slate-100 text-slate-700',
  soft: 'bg-amber-100 text-amber-800',
  cold: 'bg-red-100 text-red-700',
  new: 'bg-blue-100 text-blue-700',
  dead: 'bg-gray-100 text-gray-500',
};

const STATUS_OPTIONS: ProductRow['status'][] = ['hot', 'steady', 'soft', 'cold', 'new', 'dead'];

type PanelKey = 'needsAttention' | 'winners' | 'breakouts' | 'declining' | 'dead' | 'lowVolume';

const PANELS: { key: PanelKey; label: string; hint: string; activeCls: string }[] = [
  { key: 'needsAttention', label: 'Needs attention', hint: 'Ranked by urgency: dead, cold, declining & soft demand', activeCls: 'bg-red-600' },
  { key: 'winners', label: 'Winners / Hot', hint: 'Highest revenue this period', activeCls: 'bg-emerald-600' },
  { key: 'breakouts', label: 'Breakouts (New)', hint: 'No sales last year, meaningful revenue now', activeCls: 'bg-blue-600' },
  { key: 'declining', label: 'Declining', hint: 'Sold last year & this year — biggest % falls', activeCls: 'bg-amber-500' },
  { key: 'dead', label: 'Dead catalog', hint: 'Earned last year, $0 this period', activeCls: 'bg-gray-700' },
  { key: 'lowVolume', label: 'Low volume', hint: 'Sold, but bottom-tier revenue', activeCls: 'bg-slate-600' },
];

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const AUD2 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
const fmt = (n: number) => n.toLocaleString('en-AU');

// ─── Small UI pieces ─────────────────────────────────────────────────────────

function Yoy({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-300 text-xs">—</span>;
  const up = pct >= 0;
  return (
    <span className={`text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function StatusPill({ status }: { status: ProductRow['status'] }) {
  const label = status === 'hot' ? 'Hot'
    : status === 'steady' ? 'Steady'
    : status === 'soft' ? 'Soft'
    : status === 'cold' ? 'Cold'
    : status === 'new' ? 'New'
    : 'No sales';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
      {category}
    </span>
  );
}

function AbandonedBadge({ row }: { row: ProductRow }) {
  if (!row.abandonedCarts) return null;
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-100"
      title={`${row.abandonedCarts} abandoned carts · ${AUD2.format(row.abandonedValue ?? 0)} at risk`}
    >
      {row.abandonedCarts} cart{row.abandonedCarts === 1 ? '' : 's'} · {AUD.format(row.abandonedValue ?? 0)}
    </span>
  );
}

function AttentionRow({ row, rank }: { row: ProductRow; rank: number }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="w-5 text-xs text-gray-400 font-mono pt-0.5">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 truncate max-w-[240px]" title={row.name}>{row.name}</span>
          <StatusPill status={row.status} />
          <CategoryChip category={row.category} />
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${BRAND_SOFT[row.brand]}`}>
            {BRAND_SHORT[row.brand]}
          </span>
          <span className="text-[11px] text-gray-400">
            {fmt(row.current.units)} units · LY {AUD.format(row.lastYear.revenue)}
          </span>
          <AbandonedBadge row={row} />
        </div>
        <div className="text-[11px] text-gray-600 mt-1.5 italic">{row.action}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-gray-900 tabular-nums">{AUD2.format(row.current.revenue)}</div>
        <div className="mt-0.5"><Yoy pct={row.yoyRevenuePct} /></div>
      </div>
    </div>
  );
}

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: ProductRow[], filename: string) {
  const header = ['Product', 'Category', 'Brand', 'Status', 'Bucket', 'Revenue', 'YoY %', 'Units', 'Orders', 'AOV', 'LY Revenue', 'Abandoned Carts', 'Abandoned Value', 'Action'];
  const lines = rows.map(r => [
    r.name, r.category, r.brand, r.status, r.bucket,
    r.current.revenue, r.yoyRevenuePct ?? '', r.current.units, r.current.orders, r.current.aov,
    r.lastYear.revenue, r.abandonedCarts ?? '', r.abandonedValue ?? '', r.action,
  ].map(csvEscape).join(','));
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function ProductPerformanceTab() {
  const [data, setData] = useState<ProductPerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [brand, setBrand] = useState<BrandFilter>('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'revenue' | 'units' | 'yoy' | 'attention' | 'name' | 'abandoned'>('attention');
  const [showAll, setShowAll] = useState(false);
  const [panel, setPanel] = useState<PanelKey>('needsAttention');
  const [category, setCategory] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | ProductRow['status']>('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/product-performance?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ProductPerfData = await res.json();
      if (!json.connected) throw new Error('No product data sources connected');
      setData(json);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => {
    if (!data) return null;
    if (brand === 'All') {
      return {
        summary: data.combined.summary,
        products: data.combined.products,
        buckets: data.combined.buckets,
        pareto: data.combined.pareto,
        categories: data.combined.categories,
        sourceLabel: 'PP BigCommerce · Blake BC · ETZ/HSC Stripe',
      };
    }
    const s = data.byBrand[brand];
    return {
      summary: s.summary,
      products: s.products,
      buckets: s.buckets,
      pareto: s.pareto,
      categories: s.categories,
      sourceLabel: s.source === 'bigcommerce' ? 'BigCommerce orders'
        : s.source === 'stripe' ? 'Stripe charges (names normalized)'
        : 'Not connected',
    };
  }, [data, brand]);

  // Reset category filter if it no longer exists for the selected brand
  useEffect(() => {
    if (active && category !== 'All' && !active.categories.includes(category)) {
      setCategory('All');
    }
  }, [active, category]);

  const panelRows = useMemo<ProductRow[]>(() => {
    if (!active) return [];
    return active.buckets[panel] ?? [];
  }, [active, panel]);

  const filteredTable = useMemo(() => {
    if (!active) return [];
    let rows = active.products.filter(r => r.current.revenue > 0 || r.current.units > 0 || r.lastYear.revenue > 0);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
    }
    if (category !== 'All') rows = rows.filter(r => r.category === category);
    if (statusFilter !== 'All') rows = rows.filter(r => r.status === statusFilter);
    rows = [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'units') return b.current.units - a.current.units;
      if (sort === 'yoy') return (b.yoyRevenuePct ?? -9999) - (a.yoyRevenuePct ?? -9999);
      if (sort === 'attention') return b.attentionScore - a.attentionScore;
      if (sort === 'abandoned') return (b.abandonedCarts ?? 0) - (a.abandonedCarts ?? 0);
      return b.current.revenue - a.current.revenue;
    });
    return rows;
  }, [active, query, sort, category, statusFilter]);

  const visible = showAll ? filteredTable : filteredTable.slice(0, 25);

  const exportName = `product-performance_${brand === 'All' ? 'all' : BRAND_SHORT[brand as ProductBrand]}_${range}.csv`;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4 md:py-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Product Performance</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            What needs attention · clean names · buckets · YoY
            {data ? ` · ${data.currentLabel}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['All', ...BRANDS] as BrandFilter[]).map(b => (
              <button
                key={b}
                onClick={() => { setBrand(b); setShowAll(false); }}
                className={`px-2.5 py-1.5 font-medium transition-colors ${
                  brand === b
                    ? b === 'All' ? 'bg-gray-800 text-white'
                      : `${BRAND_COLOR[b as ProductBrand]} text-white`
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {b === 'All' ? 'All' : BRAND_SHORT[b as ProductBrand]}
              </button>
            ))}
          </div>
          <button
            onClick={() => downloadCsv(filteredTable, exportName)}
            disabled={!data || filteredTable.length === 0}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-gray-400 disabled:opacity-40"
          >
            Export CSV
          </button>
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">↻</button>
        </div>
      </div>

      {/* Range */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              range === r.key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-white border border-gray-100 rounded-xl animate-pulse" />)}
          <p className="text-center text-xs text-gray-400 py-2">Loading product sales across brands…</p>
        </div>
      )}

      {!loading && (error || !data || !active) && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-gray-700 font-medium mb-1">Could not load product performance</div>
          {error && <div className="text-sm text-red-500 mb-3">{error}</div>}
          <button onClick={load} className="text-sm text-blue-600 font-medium">Retry</button>
        </div>
      )}

      {!loading && data && active && (
        <>
          {/* Period strip */}
          <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-xs mb-4">
            <span className="font-semibold text-gray-700">{data.rangeLabel}</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-600"><span className="font-medium text-gray-800">This period</span> {data.currentLabel}</span>
            <span className="text-gray-300">vs</span>
            <span className="text-gray-500"><span className="font-medium">Last year</span> {data.lyLabel}</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-400">{active.sourceLabel}</span>
          </div>

          {/* Summary */}
          <div className="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">At a glance · {brand === 'All' ? 'All brands' : brand}</div>
              <Yoy pct={active.summary.yoyRevenuePct} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-gray-100">
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Product revenue</div>
                <div className="text-2xl font-bold text-gray-900">{AUD.format(active.summary.revenue)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{AUD.format(active.summary.lyRevenue)} LY</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Units sold</div>
                <div className="text-2xl font-bold text-gray-900">{fmt(active.summary.units)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{fmt(active.summary.orders)} line sales</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-xs text-gray-500 mb-1">Products selling</div>
                <div className="text-2xl font-bold text-gray-900">{fmt(active.summary.productsSold)}</div>
                <div className="text-xs text-gray-400 mt-0.5">with ≥1 sale</div>
              </div>
              <div className="px-5 py-4 md:col-span-2">
                <div className="text-xs text-gray-500 mb-1">Top product</div>
                <div className="text-sm font-semibold text-gray-900 truncate" title={active.summary.topProduct ?? ''}>
                  {active.summary.topProduct ?? '—'}
                </div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">
                  {active.summary.topRevenue > 0 ? AUD2.format(active.summary.topRevenue) : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Pareto strip */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 text-xs text-indigo-900 mb-5">
            <span className="font-semibold uppercase tracking-wide text-indigo-500 text-[10px]">Revenue concentration</span>
            <span>
              <span className="font-bold text-base">{active.pareto.top10SharePct}%</span> from top 10 products
              <span className="text-indigo-400"> ({AUD.format(active.pareto.top10Revenue)})</span>
            </span>
            <span>Top 20 = <span className="font-bold">{active.pareto.top20SharePct}%</span></span>
            <span>
              <span className="font-bold">{active.pareto.productsFor80Pct}</span> product{active.pareto.productsFor80Pct === 1 ? '' : 's'} drive ~80% of revenue
            </span>
          </div>

          {/* Brand scorecards — only when All */}
          {brand === 'All' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
              {BRANDS.map(b => {
                const s = data.byBrand[b];
                return (
                  <button
                    key={b}
                    onClick={() => setBrand(b)}
                    className={`text-left rounded-xl border p-4 transition-shadow hover:shadow-sm ${
                      s.connected ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded text-white ${BRAND_COLOR[b]}`}>
                        {BRAND_SHORT[b]}
                      </span>
                      <span className="text-[10px] text-gray-400 uppercase">
                        {s.connected ? s.source : 'offline'}
                      </span>
                    </div>
                    <div className="text-xl font-bold text-gray-900">{AUD.format(s.summary.revenue)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Yoy pct={s.summary.yoyRevenuePct} />
                      <span className="text-[11px] text-gray-400">{fmt(s.summary.productsSold)} products</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-2 truncate" title={s.summary.topProduct ?? ''}>
                      Top: {s.summary.topProduct ?? '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Bucket panels */}
          <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
              {PANELS.map(p => {
                const count = active.buckets[p.key]?.length ?? 0;
                return (
                  <button
                    key={p.key}
                    onClick={() => setPanel(p.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                      panel === p.key ? `${p.activeCls} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {p.label}
                    <span className={`ml-1.5 ${panel === p.key ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-1.5 border-b border-gray-50">
              <span className="text-[11px] text-gray-400">{PANELS.find(p => p.key === panel)?.hint}</span>
            </div>
            <div className="px-4 py-1 max-h-[460px] overflow-y-auto">
              {panelRows.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">Nothing in this bucket for the selected filters.</div>
              ) : (
                panelRows.map((row, i) => (
                  <AttentionRow key={`${row.brand}-${row.name}`} row={row} rank={i + 1} />
                ))
              )}
            </div>
          </div>

          {/* Full table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">All products</div>
                <div className="text-xs text-gray-500 mt-0.5">{filteredTable.length} shown · sorted by {sort}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search products…"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                />
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white max-w-[140px]"
                >
                  <option value="All">All categories</option>
                  {active.categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="All">All status</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'dead' ? 'No sales' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as typeof sort)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="attention">Attention</option>
                  <option value="revenue">Revenue</option>
                  <option value="units">Units</option>
                  <option value="yoy">YoY %</option>
                  <option value="abandoned">Abandoned</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                    <th className="text-left px-3 py-2.5 font-medium">Product</th>
                    <th className="text-left px-3 py-2.5 font-medium">Category</th>
                    <th className="text-left px-3 py-2.5 font-medium">Brand</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                    <th className="text-right px-3 py-2.5 font-medium">Revenue</th>
                    <th className="text-right px-3 py-2.5 font-medium">YoY</th>
                    <th className="text-right px-3 py-2.5 font-medium">Units</th>
                    <th className="text-right px-3 py-2.5 font-medium">Orders</th>
                    <th className="text-right px-3 py-2.5 font-medium">Abandoned</th>
                    <th className="text-left px-4 py-2.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => (
                    <tr key={`${row.brand}-${row.name}`} className="border-t border-gray-50 hover:bg-gray-50/80">
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-3 py-2.5 max-w-[240px]">
                        <div className="font-medium text-gray-800 truncate" title={row.name}>{row.name}</div>
                        <div className="text-[11px] text-gray-400">LY {AUD2.format(row.lastYear.revenue)}</div>
                      </td>
                      <td className="px-3 py-2.5"><CategoryChip category={row.category} /></td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${BRAND_SOFT[row.brand]}`}>
                          {BRAND_SHORT[row.brand]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><StatusPill status={row.status} /></td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">{AUD2.format(row.current.revenue)}</td>
                      <td className="px-3 py-2.5 text-right"><Yoy pct={row.yoyRevenuePct} /></td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmt(row.current.units)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmt(row.current.orders)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                        {row.abandonedCarts ? (
                          <span title={`${AUD2.format(row.abandonedValue ?? 0)} at risk`}>{row.abandonedCarts}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px]">
                        <span className="text-[11px] text-gray-500 truncate block" title={row.action}>{row.action}</span>
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-400">No products match.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredTable.length > 25 && (
              <div className="px-5 py-3 border-t border-gray-100 text-center">
                <button onClick={() => setShowAll(v => !v)} className="text-sm text-blue-600 font-medium">
                  {showAll ? 'Show less' : `Show all ${filteredTable.length} products`}
                </button>
              </div>
            )}
          </div>

          {/* Trust strip */}
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-xs text-gray-500 leading-relaxed space-y-2">
            <div>
              <span className="font-medium text-gray-700">Sources: </span>
              {data.meta.sources.map((s, i) => (
                <span key={s.brand}>
                  {i > 0 && <span className="text-gray-300"> · </span>}
                  <span className="font-medium text-gray-600">{BRAND_SHORT[s.brand]}</span> {s.source}
                  {!s.connected && <span className="text-red-400"> (offline)</span>}
                </span>
              ))}
            </div>
            {data.meta.sampledOrdersNote && (
              <div><span className="font-medium text-gray-700">Sampling: </span>{data.meta.sampledOrdersNote}</div>
            )}
            {data.meta.notes.map((n, i) => (
              <div key={i} className="text-gray-400">{n}</div>
            ))}
            <div className="pt-1 border-t border-gray-100">
              <span className="font-medium text-gray-700">Status legend: </span>
              <span className="font-semibold text-emerald-700">Hot</span> up ≥25% YoY ·
              <span className="font-semibold text-red-600"> Cold</span> down ≥25% ·
              <span className="font-semibold text-amber-700"> Soft</span> down but milder ·
              <span className="font-semibold text-blue-700"> New</span> no LY sales ·
              <span className="font-semibold text-gray-500"> No sales</span> earned LY, $0 now.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
