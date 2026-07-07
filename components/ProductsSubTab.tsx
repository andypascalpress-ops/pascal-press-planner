'use client';

import { useCallback, useEffect, useState } from 'react';

interface ProductMetrics { revenue: number; orders: number; units: number; aov: number; }
interface ProductRow {
  name:          string;
  current:       ProductMetrics;
  lastYear:      ProductMetrics;
  yoyRevenuePct: number | null;
  yoyOrdersPct:  number | null;
  yoyUnitsPct:   number | null;
}
interface ProductYOYData {
  connected:      boolean;
  rangeLabel:     string;
  currentLabel:   string;
  lyLabel:        string;
  topProducts:    ProductRow[];
  bottomProducts: ProductRow[];
}

type RangeKey = '30d' | '60d' | '90d' | 'mtd' | 'lastmonth';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30d',       label: 'Last 30 days' },
  { key: '60d',       label: 'Last 60 days' },
  { key: '90d',       label: 'Last 90 days' },
  { key: 'mtd',       label: 'Month to date' },
  { key: 'lastmonth', label: 'Last month' },
];

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString('en-AU');

function YoyBadge({ pct, isNew }: { pct: number | null; isNew?: boolean }) {
  if (isNew) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">NEW</span>;
  if (pct === null) return <span className="text-gray-300 text-xs">—</span>;
  const up = pct >= 0;
  return (
    <span className={`text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function MetricCell({
  current, ly, yoy, fmt, isNew,
}: { current: number; ly: number; yoy: number | null; fmt: (n: number) => string; isNew?: boolean }) {
  return (
    <td className="px-3 py-2.5 text-right align-top">
      <div className="font-semibold text-gray-900 text-sm leading-tight">{fmt(current)}</div>
      <div className="text-xs text-gray-400 mt-0.5 leading-tight">{fmt(ly)} LY</div>
      <div className="mt-0.5"><YoyBadge pct={yoy} isNew={isNew} /></div>
    </td>
  );
}

function ProductTable({ rows, view, currentLabel, lyLabel }: {
  rows: ProductRow[]; view: 'top' | 'bottom';
  currentLabel: string; lyLabel: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 italic py-6 text-center">No product data available.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-6">#</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Product</th>
            {(['Revenue', 'Orders', 'Units', 'AOV'] as const).map(h => (
              <th key={h} className="px-3 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <div>{h}</div>
                <div className="font-normal text-gray-300 normal-case">{currentLabel.split('–')[0]?.trim() ?? 'This period'}</div>
                <div className="font-normal text-gray-300 normal-case">{lyLabel.split('–')[0]?.trim() ?? 'Last year'}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isNew = row.lastYear.revenue === 0 && row.current.revenue > 0;
            const rowBg = view === 'bottom'
              ? (i < 5 ? 'bg-red-50/40' : '')
              : (i < 5 ? 'bg-emerald-50/30' : '');
            return (
              <tr key={row.name} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${rowBg}`}>
                <td className="px-3 py-2.5 text-[11px] text-gray-400 font-medium">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-gray-800 text-sm leading-tight max-w-[180px] truncate" title={row.name}>{row.name}</div>
                  {isNew && <span className="text-[10px] text-blue-500">New this period</span>}
                </td>
                <MetricCell current={row.current.revenue} ly={row.lastYear.revenue} yoy={row.yoyRevenuePct} fmt={AUD.format.bind(AUD)} isNew={isNew && row.yoyRevenuePct === null} />
                <MetricCell current={row.current.orders}  ly={row.lastYear.orders}  yoy={row.yoyOrdersPct}  fmt={fmtNum} />
                <MetricCell current={row.current.units}   ly={row.lastYear.units}   yoy={row.yoyUnitsPct}   fmt={fmtNum} />
                <MetricCell current={row.current.aov}     ly={row.lastYear.aov}     yoy={null}               fmt={AUD.format.bind(AUD)} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductsSubTab() {
  const [data,    setData]    = useState<ProductYOYData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [view,    setView]    = useState<'top' | 'bottom'>('bottom');
  const [range,   setRange]   = useState<RangeKey>('30d');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bc-product-yoy?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ProductYOYData = await res.json();
      if (!json.connected) throw new Error('BigCommerce not connected');
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-400">Could not load product data.</p>
        {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
        <button onClick={load} className="mt-3 text-xs text-blue-500 underline">Retry</button>
      </div>
    );
  }

  const rows = view === 'top' ? data.topProducts : data.bottomProducts;

  return (
    <div className="space-y-4">

      {/* Range selector */}
      <div className="flex flex-wrap gap-1.5 items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                range === r.key
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={load} className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 shrink-0">
          ↻ Refresh
        </button>
      </div>

      {/* Period comparison header */}
      <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-800 shrink-0" />
          <span className="font-semibold text-gray-700">This period:</span>
          <span className="text-gray-500">{data.currentLabel}</span>
        </div>
        <span className="text-gray-300">vs</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
          <span className="font-semibold text-gray-500">Last year:</span>
          <span className="text-gray-400">{data.lyLabel}</span>
        </div>
      </div>

      {/* Top / Bottom toggle */}
      <div className="flex gap-1.5">
        {(['bottom', 'top'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              view === v
                ? v === 'bottom' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {v === 'top' ? '▲ Top 30' : '▼ Bottom 30'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Revenue', currVal: rows.reduce((s, r) => s + r.current.revenue, 0), lyVal: rows.reduce((s, r) => s + r.lastYear.revenue, 0), fmt: (n: number) => AUD.format(n) },
          { label: 'Orders',  currVal: rows.reduce((s, r) => s + r.current.orders,  0), lyVal: rows.reduce((s, r) => s + r.lastYear.orders,  0), fmt: fmtNum },
          { label: 'Units',   currVal: rows.reduce((s, r) => s + r.current.units,   0), lyVal: rows.reduce((s, r) => s + r.lastYear.units,   0), fmt: fmtNum },
        ].map(card => {
          const yoy = card.lyVal > 0 ? Math.round(((card.currVal - card.lyVal) / card.lyVal) * 10) / 10 : null;
          const up  = yoy !== null && yoy >= 0;
          return (
            <div key={card.label} className="bg-gray-50 rounded-lg p-2.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{card.label}</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5 leading-tight">{card.fmt(card.currVal)}</p>
              <p className="text-xs text-gray-400 leading-tight">{card.fmt(card.lyVal)} LY</p>
              {yoy !== null && (
                <p className={`text-[11px] font-bold mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
                  {up ? '▲' : '▼'} {Math.abs(yoy)}%
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Table */}
      <ProductTable rows={rows} view={view} currentLabel={data.currentLabel} lyLabel={data.lyLabel} />

      <p className="text-[10px] text-gray-400 text-center">
        Based on up to 40 orders per period · BigCommerce data
      </p>
    </div>
  );
}
