'use client';

import { useEffect, useState } from 'react';

interface Product { productId: number; name: string; downloads: number; orders: number; revenue: number }
interface Period { start: string; end: string; downloads: number; orders: number; subscriptions: number; products: Product[]; failedOrders: number }
interface Data { current: Period; prior: Period }

const NUM = new Intl.NumberFormat('en-AU');
const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

function change(cur: number, prior: number): { text: string; good: boolean } | null {
  if (prior <= 0) return cur > 0 ? { text: 'new', good: true } : null;
  const p = Math.round(((cur - prior) / prior) * 100);
  return { text: `${p >= 0 ? '+' : ''}${p}%`, good: p >= 0 };
}

function Badge({ cur, prior }: { cur: number; prior: number }) {
  const c = change(cur, prior);
  if (!c) return null;
  return <span className={`ml-1.5 text-[11px] font-semibold ${c.good ? 'text-green-600' : 'text-red-500'}`}>{c.text}</span>;
}

function downloadCsv(rows: Product[], name: string) {
  const lines = [['Product', 'Downloads', 'Orders', 'Revenue'], ...rows.map(r => [r.name, String(r.downloads), String(r.orders), r.revenue.toFixed(2)])];
  const csv = lines.map(l => l.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function BlakeDownloadsPanel({ start, end, compStart, compEnd, comparisonLabel, accent }: {
  start: string; end: string; compStart: string; compEnd: string; comparisonLabel: string; accent: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(`/api/blake-downloads-period?start=${start}&end=${end}&compStart=${compStart}&compEnd=${compEnd}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Data; })
      .then(j => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : 'Failed to load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [start, end, compStart, compEnd]);

  const priorBy = new Map((data?.prior.products ?? []).map(p => [p.productId, p]));
  const rows = data ? (showAll ? data.current.products : data.current.products.slice(0, 10)) : [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">PDF downloads</p>
          <p className="text-[11px] text-gray-400">Digital products downloaded in the selected period, {comparisonLabel.replace(/^vs /, 'compared with ')}.</p>
        </div>
        {data && data.current.products.length > 0 && (
          <button
            onClick={() => downloadCsv(data.current.products, `blake-pdf-downloads_${start}_to_${end}.csv`)}
            className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
          >
            Export CSV
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-gray-400 py-4">Loading PDF downloads…</p>}
      {!loading && error && <p className="text-xs text-red-600 py-2">{error}</p>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">PDFs downloaded</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.current.downloads)}<Badge cur={data.current.downloads} prior={data.prior.downloads} /></p>
              <p className="text-[11px] text-gray-400">prev {NUM.format(data.prior.downloads)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Orders with a PDF</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.current.orders)}<Badge cur={data.current.orders} prior={data.prior.orders} /></p>
              <p className="text-[11px] text-gray-400">prev {NUM.format(data.prior.orders)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Different PDFs downloaded</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.current.products.length)}</p>
              <p className="text-[11px] text-gray-400">prev {NUM.format(data.prior.products.length)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Subscriptions started</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.current.subscriptions)}<Badge cur={data.current.subscriptions} prior={data.prior.subscriptions} /></p>
              <p className="text-[11px] text-gray-400">prev {NUM.format(data.prior.subscriptions)} (not counted as PDFs)</p>
            </div>
          </div>

          {data.current.products.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No PDFs were downloaded in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="py-1.5 pr-3">PDF</th>
                    <th className="py-1.5 pr-3 text-right">Downloads</th>
                    <th className="py-1.5 pr-3 text-right">Previous period</th>
                    <th className="py-1.5 pr-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => {
                    const prev = priorBy.get(p.productId);
                    return (
                      <tr key={p.productId} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 font-medium text-gray-800">{p.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums font-semibold" style={{ color: accent }}>{NUM.format(p.downloads)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{prev ? NUM.format(prev.downloads) : '–'}<Badge cur={p.downloads} prior={prev?.downloads ?? 0} /></td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{AUD.format(p.revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.current.products.length > 10 && (
                <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-800">
                  {showAll ? 'Show top 10' : `Show all ${NUM.format(data.current.products.length)} PDFs`}
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3">
            A download is one unit of a digital product on a valid order (cancelled, refunded and unpaid orders are left out). Revenue includes GST.
            {data.current.failedOrders + data.prior.failedOrders > 0 ? ` ${data.current.failedOrders + data.prior.failedOrders} orders could not be read and are missing.` : ''}
          </p>
        </>
      )}
    </div>
  );
}
