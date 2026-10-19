'use client';

import { useEffect, useMemo, useState } from 'react';

interface CouponRow { code: string; orders: number; revenue: number; discount: number | null }
interface CouponUsage {
  rows: CouponRow[];
  totalOrders: number;
  totalRevenue: number;
  couponOrders: number;
  couponRevenue: number;
  note: string;
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-AU');

/**
 * Codes that look like one-per-customer codes (the same letters followed by a number, at least 3 of them in the
 * period, e.g. ETZS334, ETZS335, ...) are grouped so a campaign reads as one line.
 */
function groupRows(rows: CouponRow[]): { label: string; orders: number; revenue: number; discount: number | null; codes: number }[] {
  const prefixCount = new Map<string, number>();
  for (const r of rows) {
    const m = /^([A-Z]{3,})\d{2,}$/.exec(r.code);
    if (m) prefixCount.set(m[1]!, (prefixCount.get(m[1]!) ?? 0) + 1);
  }
  const out = new Map<string, { label: string; orders: number; revenue: number; discount: number | null; codes: number }>();
  for (const r of rows) {
    const m = /^([A-Z]{3,})\d{2,}$/.exec(r.code);
    const grouped = m && (prefixCount.get(m[1]!) ?? 0) >= 3;
    const label = grouped ? `${m![1]}… (${prefixCount.get(m![1]!)} single-use codes)` : r.code;
    const cur = out.get(label) ?? { label, orders: 0, revenue: 0, discount: r.discount === null ? null : 0, codes: 0 };
    cur.orders += r.orders; cur.revenue += r.revenue; cur.codes += 1;
    if (r.discount !== null) cur.discount = (cur.discount ?? 0) + r.discount;
    out.set(label, cur);
  }
  return [...out.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
}

function downloadCsv(rows: CouponRow[], name: string) {
  const header = ['Code', 'Orders', 'Revenue', 'Discount given'];
  const lines = [header, ...rows.map(r => [r.code, String(r.orders), r.revenue.toFixed(2), r.discount === null ? '' : r.discount.toFixed(2)])];
  const csv = lines.map(l => l.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CouponUsagePanel({ brand, start, end, accent }: { brand: 'etz' | 'blake'; start: string; end: string; accent: string }) {
  const [data, setData] = useState<CouponUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [group, setGroup] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(`/api/coupon-usage?brand=${brand}&start=${start}&end=${end}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as CouponUsage; })
      .then(j => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : 'Failed to load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brand, start, end]);

  const lines = useMemo(() => {
    if (!data) return [];
    return group ? groupRows(data.rows) : data.rows.map(r => ({ label: r.code, orders: r.orders, revenue: r.revenue, discount: r.discount, codes: 1 }));
  }, [data, group]);

  const showDiscount = data?.rows.some(r => r.discount !== null) ?? false;
  const share = data && data.totalRevenue > 0 ? Math.round((data.couponRevenue / data.totalRevenue) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Coupon codes</p>
          <p className="text-[11px] text-gray-400">Orders and revenue by code for the selected period.</p>
        </div>
        {data && data.rows.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGroup(g => !g)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
            >
              {group ? 'Show every code' : 'Group single-use codes'}
            </button>
            <button
              onClick={() => downloadCsv(data.rows, `coupon-usage_${brand}_${start}_to_${end}.csv`)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
            >
              Export CSV
            </button>
          </div>
        )}
      </div>

      {loading && <p className="text-xs text-gray-400 py-4">Loading coupon codes…</p>}
      {!loading && error && <p className="text-xs text-red-600 py-2">{error}</p>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Orders using a code</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.couponOrders)} <span className="text-xs font-medium text-gray-400">of {NUM.format(data.totalOrders)}</span></p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Revenue from those orders</p>
              <p className="text-lg font-bold text-gray-900">{AUD.format(data.couponRevenue)} <span className="text-xs font-medium text-gray-400">{share}% of {AUD.format(data.totalRevenue)}</span></p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Different codes used</p>
              <p className="text-lg font-bold text-gray-900">{NUM.format(data.rows.length)}</p>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No coupon codes were used in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="py-1.5 pr-3">Code</th>
                    <th className="py-1.5 pr-3 text-right">Orders</th>
                    <th className="py-1.5 pr-3 text-right">Revenue</th>
                    {showDiscount && <th className="py-1.5 pr-3 text-right">Discount given</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.label} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 font-medium text-gray-800">{l.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{NUM.format(l.orders)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold" style={{ color: accent }}>{AUD.format(l.revenue)}</td>
                      {showDiscount && <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{l.discount === null ? '–' : AUD.format(l.discount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3">{data.note}</p>
        </>
      )}
    </div>
  );
}
