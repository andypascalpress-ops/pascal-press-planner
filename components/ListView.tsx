'use client';

import { useState } from 'react';
import { Campaign } from '@/lib/types';
import { CAMPAIGN_COLORS, CAMPAIGN_TYPES, FY_MONTHS } from '@/lib/constants';

type SortKey = keyof Campaign;
type SortDir = 'asc' | 'desc';

interface Props {
  campaigns: Campaign[];
  onEdit: (campaign: Campaign) => void;
  onDelete: (id: string) => void;
  onMarkComplete: (id: string) => void;
}

const FMT = new Intl.NumberFormat('en-AU');
const CURRENCY = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

export default function ListView({ campaigns, onEdit, onDelete, onMarkComplete }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('month');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [search, setSearch] = useState('');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const monthOrder = Object.fromEntries(FY_MONTHS.map((m, i) => [m, i]));

  const filtered = campaigns
    .filter(c => !filterType || c.type === filterType)
    .filter(c => !filterStatus || c.status === filterStatus)
    .filter(c => !filterBrand || c.brand.toLowerCase().includes(filterBrand.toLowerCase()))
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.promoCode?.toLowerCase().includes(search.toLowerCase()) ||
      c.type?.toLowerCase().includes(search.toLowerCase()));

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = a[sortKey] as string | number;
    let bv: string | number = b[sortKey] as string | number;

    if (sortKey === 'month') {
      av = monthOrder[av as string] ?? 99;
      bv = monthOrder[bv as string] ?? 99;
    }

    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    const as = String(av).toLowerCase();
    const bs = String(bv).toLowerCase();
    return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
  });

  const totalRevenue = filtered.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalOrders = filtered.reduce((s, c) => s + (c.orders || 0), 0);
  const totalUnits = filtered.reduce((s, c) => s + (c.unitsSold || 0), 0);

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className="ml-1 text-gray-400 text-xs">
      {sortKey === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const Th = ({ col, label, className = '' }: { col: SortKey; label: string; className?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 whitespace-nowrap select-none ${className}`}
    >
      {label}<SortIcon col={col} />
    </th>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 px-6 py-3 bg-white border-b border-gray-200">
        <input
          type="text"
          placeholder="Search campaigns…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Types</option>
          {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="Planned">Planned</option>
          <option value="Complete">Complete</option>
        </select>
        <input
          type="text"
          placeholder="Filter brand…"
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
        />
        <div className="ml-auto flex gap-4 text-sm text-gray-600 items-center">
          <span><strong className="text-gray-900">{sorted.length}</strong> rows</span>
          {totalRevenue > 0 && <span>Revenue: <strong className="text-green-700">{CURRENCY.format(totalRevenue)}</strong></span>}
          {totalOrders > 0 && <span>Orders: <strong className="text-gray-900">{FMT.format(totalOrders)}</strong></span>}
          {totalUnits > 0 && <span>Units: <strong className="text-gray-900">{FMT.format(totalUnits)}</strong></span>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
            <tr>
              <Th col="name"      label="Campaign Name" />
              <Th col="type"      label="Type" />
              <Th col="month"     label="Month" />
              <Th col="fy"        label="FY" />
              <Th col="brand"     label="Brand" />
              <Th col="status"    label="Status" />
              <Th col="revenue"   label="Revenue" className="text-right" />
              <Th col="orders"    label="Orders" className="text-right" />
              <Th col="unitsSold" label="Units" className="text-right" />
              <Th col="promoCode" label="Promo" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-16 text-gray-400 text-sm">
                  No campaigns match your filters.
                </td>
              </tr>
            ) : sorted.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs">
                  <div className="truncate" title={c.name}>{c.name}</div>
                  {c.dateRange && <div className="text-xs text-gray-400 truncate">{c.dateRange}</div>}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap"
                    style={{ backgroundColor: CAMPAIGN_COLORS[c.type] || CAMPAIGN_COLORS['Other'] }}
                  >
                    {c.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{c.month}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{c.fy}</td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-[120px]">
                  <span className="truncate block" title={c.brand}>{c.brand}</span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    c.status === 'Complete'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-700 whitespace-nowrap">
                  {c.revenue > 0 ? CURRENCY.format(c.revenue) : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-700 whitespace-nowrap">
                  {c.orders > 0 ? FMT.format(c.orders) : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-700 whitespace-nowrap">
                  {c.unitsSold > 0 ? FMT.format(c.unitsSold) : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 font-mono">{c.promoCode || '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-1">
                    {c.status !== 'Complete' && (
                      <button
                        onClick={() => onMarkComplete(c.id)}
                        title="Mark Complete"
                        className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors text-sm"
                      >
                        ✓
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(c)}
                      title="Edit"
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors text-sm"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${c.name}"?`)) onDelete(c.id);
                      }}
                      title="Delete"
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors text-sm"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
