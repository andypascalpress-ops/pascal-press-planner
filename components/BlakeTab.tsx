'use client';

import { useState, useEffect } from 'react';
import type { BlakeDownloadsData, BlakeSubscriptionsData } from '@/lib/blake-data';

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-AU', { month: 'short', year: '2-digit' });
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className ?? ''}`} />;
}

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Subscriptions section ─────────────────────────────────────────────────────
function SubscriptionsSection({ data }: { data: BlakeSubscriptionsData | null }) {
  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20" /><Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">
        Could not connect to Blake BigCommerce store. Check <code>BIGCOMMERCE_BLAKE_STORE_HASH</code> and <code>BIGCOMMERCE_BLAKE_ACCESS_TOKEN</code>.
      </div>
    );
  }

  const maxCount = Math.max(...data.months.map(m => m.count), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Total subscriptions (12 months)"
          value={data.totalCount.toLocaleString()}
          sub="orders for product #1072"
        />
        <StatTile
          label="Total revenue (12 months)"
          value={AUD.format(data.totalRevenue)}
          sub="from subscription orders"
        />
      </div>

      {/* Monthly bar chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly subscription orders</h3>
        <div className="space-y-2">
          {data.months.map((m) => (
            <div key={m.month} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-12 shrink-0 text-right">{monthLabel(m.month)}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${(m.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-800 w-6 text-right">{m.count}</span>
              <span className="text-xs text-gray-400 w-20 text-right">{AUD.format(m.revenue)}</span>
            </div>
          ))}
        </div>
        {data.totalCount === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No orders for product #1072 in the last 12 months.</p>
        )}
      </div>

      {/* Monthly table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2.5">Month</th>
              <th className="text-right text-xs font-semibold text-gray-500 px-4 py-2.5">Orders</th>
              <th className="text-right text-xs font-semibold text-gray-500 px-4 py-2.5">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {[...data.months].reverse().map((m, i) => (
              <tr key={m.month} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="px-4 py-2 text-gray-700 font-medium">{monthLabel(m.month)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {m.count > 0 ? m.count : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {m.revenue > 0 ? AUD.format(m.revenue) : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Downloads section ─────────────────────────────────────────────────────────
function DownloadsSection({ data }: { data: BlakeDownloadsData | null }) {
  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">
        Could not fetch digital product downloads from Blake BigCommerce.
      </div>
    );
  }

  if (data.topProducts.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400">
        No digital products found in the Blake store.
      </div>
    );
  }

  const maxDownloads = data.topProducts[0]?.downloads ?? 1;
  const totalDownloads = data.totalPurchases;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Total PDF purchases (12 months)"
          value={totalDownloads.toLocaleString()}
          sub={`across ${data.topProducts.length} products`}
        />
        <StatTile
          label="Top download"
          value={data.topProducts[0]?.downloads.toLocaleString() ?? '—'}
          sub={data.topProducts[0]?.name.slice(0, 40) ?? ''}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Top downloads (cumulative)</h3>
          <p className="text-xs text-gray-400 mt-0.5">Total times each file has been downloaded</p>
        </div>
        <div className="divide-y divide-gray-50">
          {data.topProducts.map((p, i) => (
            <div key={p.productId} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs text-gray-400 w-5 shrink-0 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{p.name}</p>
                <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-400 rounded-full"
                    style={{ width: `${(p.downloads / maxDownloads) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-sm font-semibold text-gray-900 tabular-nums w-16 text-right shrink-0">
                {p.downloads.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

type Section = 'subscriptions' | 'downloads';

export default function BlakeTab() {
  const [section, setSection]         = useState<Section>('subscriptions');
  const [subsData, setSubsData]       = useState<BlakeSubscriptionsData | null>(null);
  const [dlData, setDlData]           = useState<BlakeDownloadsData | null>(null);
  const [subsError, setSubsError]     = useState(false);
  const [dlError, setDlError]         = useState(false);

  useEffect(() => {
    fetch('/api/blake-subscriptions')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setSubsData)
      .catch(() => setSubsError(true));

    fetch('/api/blake-downloads')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setDlData)
      .catch(() => setDlError(true));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">B</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900">Blake Education</h1>
            <p className="text-xs text-gray-500">Subscriptions & Downloads</p>
          </div>
        </div>

        {/* Section tabs */}
        <div className="max-w-3xl mx-auto px-4 flex gap-1 pb-0">
          {([
            { id: 'subscriptions', label: 'Subscriptions', sub: 'Product #1072' },
            { id: 'downloads',     label: 'File Downloads', sub: 'Digital products' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                section === t.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              <span className="text-[10px] text-gray-400 hidden sm:inline">{t.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-5">
        {section === 'subscriptions' && (
          subsError
            ? <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">Failed to load subscription data.</div>
            : <SubscriptionsSection data={subsData} />
        )}
        {section === 'downloads' && (
          dlError
            ? <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">Failed to load download data.</div>
            : <DownloadsSection data={dlData} />
        )}
      </div>
    </div>
  );
}
