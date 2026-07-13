'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types (mirror API) ──────────────────────────────────────────────────────

type ProductBrand = 'Pascal Press' | 'Blake Education' | 'Excel Test Zone' | 'Excel HSC Copilot';
type RangeKey = '30d' | '60d' | '90d' | 'mtd' | 'lastmonth';
type BrandFilter = 'All' | ProductBrand;

interface ProductMetrics { revenue: number; orders: number; units: number; aov: number; }
interface ProductRow {
  name: string;
  brand: ProductBrand;
  current: ProductMetrics;
  lastYear: ProductMetrics;
  yoyRevenuePct: number | null;
  yoyOrdersPct: number | null;
  yoyUnitsPct: number | null;
  status: 'hot' | 'steady' | 'soft' | 'cold' | 'new' | 'dead';
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

function RankRow({ row, rank, maxRev }: { row: ProductRow; rank: number; maxRev: number }) {
  const pct = maxRev > 0 ? Math.min(row.current.revenue / maxRev, 1) : 0;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="w-5 text-xs text-gray-400 font-mono pt-0.5">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 truncate max-w-[220px]" title={row.name}>{row.name}</span>
          <StatusPill status={row.status} />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${BRAND_SOFT[row.brand]}`}>
            {BRAND_SHORT[row.brand]}
          </span>
          <span className="text-[11px] text-gray-400">{fmt(row.current.units)} units · {fmt(row.current.orders)} orders</span>
        </div>
        <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-400/80 rounded-full" style={{ width: `${Math.max(pct * 100, 2)}%` }} />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-gray-900 tabular-nums">{AUD2.format(row.current.revenue)}</div>
        <div className="mt-0.5"><Yoy pct={row.yoyRevenuePct} /></div>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function ProductPerformanceTab() {
  const [data, setData] = useState<ProductPerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [brand, setBrand] = useState<BrandFilter>('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'revenue' | 'units' | 'yoy' | 'name'>('revenue');
  const [showAll, setShowAll] = useState(false);
  const [panel, setPanel] = useState<'winners' | 'losers' | 'declining'>('winners');

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
        top: data.combined.top,
        bottom: data.combined.bottom,
        declining: data.combined.declining,
        products: data.combined.products,
        sourceLabel: 'PP BigCommerce · Blake BC · ETZ/HSC Stripe',
      };
    }
    const s = data.byBrand[brand];
    return {
      summary: s.summary,
      top: s.top,
      bottom: s.bottom,
      declining: s.declining,
      products: s.products,
      sourceLabel: s.source === 'bigcommerce' ? 'BigCommerce orders'
        : s.source === 'stripe' ? 'Stripe charges (by description)'
        : 'Not connected',
    };
  }, [data, brand]);

  const filteredTable = useMemo(() => {
    if (!active) return [];
    let rows = active.products.filter(r => r.current.revenue > 0 || r.current.units > 0 || r.lastYear.revenue > 0);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'units') return b.current.units - a.current.units;
      if (sort === 'yoy') return (b.yoyRevenuePct ?? -9999) - (a.yoyRevenuePct ?? -9999);
      return b.current.revenue - a.current.revenue;
    });
    return rows;
  }, [active, query, sort]);

  const visible = showAll ? filteredTable : filteredTable.slice(0, 25);
  const maxRev = Math.max(...(active?.top.map(r => r.current.revenue) ?? [1]), 1);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4 md:py-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Product Performance</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            What&apos;s selling vs soft — by brand · YoY comparison
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
          <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
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

          {/* Winners / Losers / Declining */}
          <div className="bg-white border border-gray-200 rounded-xl mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
              {([
                ['winners', 'What\'s selling', 'bg-emerald-600'],
                ['losers', 'What\'s not', 'bg-red-500'],
                ['declining', 'Biggest YoY drops', 'bg-amber-500'],
              ] as const).map(([id, label, activeCls]) => (
                <button
                  key={id}
                  onClick={() => setPanel(id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    panel === id ? `${activeCls} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-[11px] text-gray-400 ml-auto">
                {panel === 'winners' && 'Highest revenue this period'}
                {panel === 'losers' && 'Lowest revenue among products with sales'}
                {panel === 'declining' && 'Sold last year and this year — biggest % falls'}
              </span>
            </div>
            <div className="px-4 py-1 max-h-[420px] overflow-y-auto">
              {(panel === 'winners' ? active.top : panel === 'losers' ? active.bottom : active.declining).length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">No products in this list for the selected filters.</div>
              ) : (
                (panel === 'winners' ? active.top : panel === 'losers' ? active.bottom : active.declining).map((row, i) => (
                  <RankRow key={`${row.brand}-${row.name}`} row={row} rank={i + 1} maxRev={maxRev} />
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
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                />
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as typeof sort)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="revenue">Revenue</option>
                  <option value="units">Units</option>
                  <option value="yoy">YoY %</option>
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
                    <th className="text-left px-3 py-2.5 font-medium">Brand</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                    <th className="text-right px-3 py-2.5 font-medium">Revenue</th>
                    <th className="text-right px-3 py-2.5 font-medium">YoY</th>
                    <th className="text-right px-3 py-2.5 font-medium">Units</th>
                    <th className="text-right px-3 py-2.5 font-medium">Orders</th>
                    <th className="text-right px-4 py-2.5 font-medium">AOV</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => (
                    <tr key={`${row.brand}-${row.name}`} className="border-t border-gray-50 hover:bg-gray-50/80">
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-3 py-2.5 max-w-[260px]">
                        <div className="font-medium text-gray-800 truncate" title={row.name}>{row.name}</div>
                        <div className="text-[11px] text-gray-400">LY {AUD2.format(row.lastYear.revenue)}</div>
                      </td>
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
                      <td className="px-4 py-2.5 text-right font-mono text-gray-600">{AUD2.format(row.current.aov)}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">No products match.</td>
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

          {/* Legend / trust */}
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-xs text-gray-500 leading-relaxed">
            <span className="font-medium text-gray-700">How to read this: </span>
            <span className="font-semibold text-emerald-700">Hot</span> = revenue up ≥25% YoY ·
            <span className="font-semibold text-red-600"> Cold</span> = down ≥25% ·
            <span className="font-semibold text-amber-700"> Soft</span> = down but milder ·
            <span className="font-semibold text-blue-700"> New</span> = no LY sales.
            {' '}PP & Blake use BigCommerce order lines; ETZ & HSC use Stripe charge descriptions (product-level naming depends on Stripe metadata/description).
            Abandoned carts stay under Actions for now — ask if you want them moved here.
          </div>
        </>
      )}
    </div>
  );
}
