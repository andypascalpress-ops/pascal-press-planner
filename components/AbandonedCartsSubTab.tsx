'use client';

import { useCallback, useEffect, useState } from 'react';

interface ProductEntry { name: string; units: number; carts: number; value: number; }
interface SourceEntry  { label: string; count: number; }
interface Buckets { under20: number; t20_50: number; t50_100: number; t100_200: number; over200: number; }
interface AbandonedData {
  connected: boolean; days: number; start: string; today: string;
  totalCarts: number; totalValue: number; avgValue: number;
  buckets: Buckets; guestCount: number; registeredCount: number;
  topProducts: ProductEntry[]; sources: SourceEntry[];
}

const AUD  = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const AUD2 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.max(pct * 100, 2)}%` }} />
    </div>
  );
}

export default function AbandonedCartsSubTab() {
  const [days,    setDays]    = useState<30 | 60 | 90>(30);
  const [data,    setData]    = useState<AbandonedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/bc-abandoned-carts?days=${d}`);
      const json: AbandonedData = await res.json();
      if (!json.connected) { setError('BigCommerce not connected.'); setData(null); }
      else setData(json);
    } catch { setError('Failed to load abandoned cart data.'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading abandoned cart data…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-red-400 text-sm">{error ?? 'No data.'}</div>;

  const bucketLabels: { key: keyof Buckets; label: string }[] = [
    { key: 'under20',  label: 'Under $20'  },
    { key: 't20_50',   label: '$20–$50'    },
    { key: 't50_100',  label: '$50–$100'   },
    { key: 't100_200', label: '$100–$200'  },
    { key: 'over200',  label: 'Over $200'  },
  ];
  const maxBucket    = Math.max(...Object.values(data.buckets), 1);
  const maxSource    = Math.max(...data.sources.map(s => s.count), 1);
  const maxProdCarts = Math.max(...data.topProducts.map(p => p.carts), 1);
  const guestPct     = data.totalCarts > 0 ? Math.round((data.guestCount / data.totalCarts) * 100) : 0;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Abandoned Carts</h2>
          <p className="text-xs text-gray-500 mt-0.5">{data.start} to {data.today}</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
          {([30, 60, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 transition-colors ${days === d ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Abandoned Carts"  value={data.totalCarts.toLocaleString('en-AU')} />
        <KpiCard label="Total Cart Value" value={AUD.format(data.totalValue)} />
        <KpiCard label="Avg Cart Value"   value={AUD2.format(data.avgValue)} />
        <KpiCard label="Guest Carts"      value={`${guestPct}%`} sub={`${data.guestCount} of ${data.totalCarts}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Cart Value Distribution</h3>
          <div className="space-y-3">
            {bucketLabels.map(({ key, label }) => {
              const count = data.buckets[key];
              return (
                <div key={key} className="grid grid-cols-[80px_1fr_40px] items-center gap-2">
                  <span className="text-xs text-gray-600 text-right">{label}</span>
                  <Bar pct={count / maxBucket} colour="bg-indigo-400" />
                  <span className="text-xs text-gray-500 text-right">{count}</span>
                </div>
              );
            })}
          </div>
          {data.avgValue > 100 && (
            <p className="mt-4 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">
              ⚠ High avg cart value ({AUD2.format(data.avgValue)}) — customers may be experiencing price shock at checkout.
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Abandoned Cart Sources</h3>
          <div className="space-y-3">
            {data.sources.map(s => (
              <div key={s.label} className="grid grid-cols-[120px_1fr_40px] items-center gap-2">
                <span className="text-xs text-gray-600 text-right truncate">{s.label}</span>
                <Bar pct={s.count / maxSource} colour="bg-violet-400" />
                <span className="text-xs text-gray-500 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.topProducts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Most Frequently Abandoned Products</h3>
          <p className="text-xs text-gray-400 mb-4">Based on a sample of up to 60 recent abandoned carts</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left py-2 pr-3 font-medium">Product</th>
                  <th className="text-right py-2 px-3 font-medium">Carts</th>
                  <th className="text-right py-2 px-3 font-medium">Units</th>
                  <th className="text-right py-2 font-medium">Lost Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.topProducts.map((p, i) => (
                  <tr key={p.name} className="hover:bg-gray-50">
                    <td className="py-2 pr-3 text-gray-800 font-medium max-w-[240px] truncate">
                      <span className="text-gray-400 text-xs mr-2">{i + 1}.</span>{p.name}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${(p.carts / maxProdCarts) * 100}%` }} />
                        </div>
                        <span className="text-gray-700 font-semibold w-6 text-right">{p.carts}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600">{p.units}</td>
                    <td className="py-2 text-right text-gray-700 font-medium">{AUD2.format(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">Recommended actions</h4>
        <ul className="text-xs text-blue-700 space-y-1.5">
          <li>• <strong>Abandoned cart emails</strong> — set up a 3-email sequence in HubSpot (1h, 24h, 72h after abandonment).</li>
          <li>• <strong>Guest checkout friction</strong> — {guestPct}% of carts are from guests. Ensure no account creation is required before payment.</li>
          <li>• <strong>High-value carts</strong> — consider a free shipping or discount trigger for carts over $100.</li>
          <li>• <strong>Product review</strong> — the most abandoned products may have pricing, availability, or description issues worth reviewing.</li>
        </ul>
      </div>
    </div>
  );
}
