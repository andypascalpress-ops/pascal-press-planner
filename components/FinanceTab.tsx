'use client';

import { useState, useMemo } from 'react';
import { SpendRecord } from '@/lib/types';
import { SPEND_BRANDS, SPEND_CHANNELS, FY_MONTHS, ANNUAL_BUDGETS } from '@/lib/constants';
import FinanceDashboard from './FinanceDashboard';

type SpendBrand = typeof SPEND_BRANDS[number];

interface Props {
  records: SpendRecord[];
  selectedFY: string;
  saving: boolean;
  syncing: boolean;
  lastSynced?: string;
  onEdit: (record: SpendRecord) => void;
  onDelete: (id: string) => void;
  onAdd: (brand: SpendBrand) => void;
  onSyncGoogleAds: () => void;
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const monthOrder = Object.fromEntries(FY_MONTHS.map((m, i) => [m, i]));

export default function FinanceTab({ records, selectedFY, saving, syncing, lastSynced, onEdit, onDelete, onAdd, onSyncGoogleAds }: Props) {
  const [view, setView] = useState<'dashboard' | 'table'>('dashboard');
  const [brand, setBrand] = useState<SpendBrand>('Pascal Press');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterChannel, setFilterChannel] = useState('');

  const filtered = useMemo(() =>
    records
      .filter(r => r.brand === brand)
      .filter(r => selectedFY === 'All' || r.fy === selectedFY)
      .filter(r => !filterMonth || r.month === filterMonth)
      .filter(r => !filterChannel || r.channel === filterChannel)
      .sort((a, b) => {
        const mo = (monthOrder[a.month] ?? 99) - (monthOrder[b.month] ?? 99);
        if (mo !== 0) return mo;
        return (a.channel || '').localeCompare(b.channel || '');
      }),
    [records, brand, selectedFY, filterMonth, filterChannel]
  );

  const totalBudget     = filtered.reduce((s, r) => s + (r.budget || 0), 0);
  const totalSpend      = filtered.reduce((s, r) => s + (r.actualSpend || 0), 0);
  const totalAttributed = filtered.reduce((s, r) => s + (r.attributedRevenue || 0), 0);
  const totalIndirect   = filtered.reduce((s, r) => s + (r.indirectRevenue || 0), 0);
  const totalRevenue    = totalAttributed + totalIndirect;
  const roas            = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const annualBudget    = ANNUAL_BUDGETS[brand] ?? 0;
  const budgetUsed      = annualBudget > 0 ? totalSpend / annualBudget : 0;

  const kpis = [
    { label: 'Annual Budget',      value: AUD.format(annualBudget),    sub: annualBudget > 0 ? `${(budgetUsed * 100).toFixed(0)}% used` : '', color: 'text-blue-700' },
    { label: 'Actual Spend',       value: AUD.format(totalSpend),      sub: '',                                                                 color: 'text-gray-900' },
    { label: 'Attributed Revenue', value: AUD.format(totalAttributed), sub: 'direct channel',                                                  color: 'text-green-700' },
    { label: 'Indirect Revenue',   value: AUD.format(totalIndirect),   sub: 'unattributed',                                                    color: 'text-emerald-600' },
    { label: 'ROAS',               value: roas > 0 ? `${roas.toFixed(1)}x` : '—', sub: totalSpend > 0 ? `${AUD.format(totalRevenue)} total rev` : '', color: roas >= 3 ? 'text-green-700' : roas >= 1 ? 'text-yellow-600' : 'text-red-600' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar: view toggle always visible */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setView('dashboard')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'dashboard' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 4a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V4zM2 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3zM11 4a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V4zM11 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z"/>
            </svg>
            Dashboard
          </button>
          <button
            onClick={() => setView('table')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd"/>
            </svg>
            Detail Table
          </button>
        </div>

        {/* Table-only controls */}
        {view === 'table' && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {SPEND_BRANDS.map(b => (
                <button key={b} onClick={() => setBrand(b)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${brand === b ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {b}
                </button>
              ))}
            </div>
            <button
              onClick={onSyncGoogleAds}
              disabled={syncing || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <><svg className="animate-spin h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Syncing…</>
              ) : (
                <><svg className="h-3.5 w-3.5 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/></svg>Sync Google Ads</>
              )}
            </button>
            {lastSynced && <span className="text-xs text-gray-400">Last synced {new Date(lastSynced).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => onAdd(brand)} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
              + Add Record
            </button>
          </div>
        )}
      </div>

      {/* Dashboard view */}
      {view === 'dashboard' && (
        <FinanceDashboard
          records={records}
          syncing={syncing}
          lastSynced={lastSynced}
          onSyncGoogleAds={onSyncGoogleAds}
        />
      )}

      {/* Table view */}
      {view === 'table' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-5 gap-3 px-6 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
            {kpis.map(k => (
              <div key={k.label} className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">{k.label}</div>
                <div className={`text-base font-semibold leading-tight ${k.color}`}>{k.value}</div>
                {k.sub && <div className="text-xs text-gray-400 mt-0.5">{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-3 px-6 py-2.5 bg-white border-b border-gray-200 shrink-0">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Months</option>
              {FY_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Channels</option>
              {SPEND_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="ml-auto flex items-center text-sm text-gray-500">{filtered.length} records</div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Month</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">FY</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Budget</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actual Spend</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Attributed Rev</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Indirect Rev</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Cost:Sales</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-gray-400 text-sm">
                      No spend records for {brand}{selectedFY !== 'All' ? ` · ${selectedFY}` : ''}. Click &quot;+ Add Record&quot; to start.
                    </td>
                  </tr>
                ) : filtered.map(r => {
                  const totalRev = (r.attributedRevenue || 0) + (r.indirectRevenue || 0);
                  const ratio = r.actualSpend > 0 && totalRev > 0 ? r.actualSpend / totalRev : null;
                  const budgetOver = r.budget > 0 && r.actualSpend > r.budget;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.channel}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.month}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.fy}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700">{r.budget > 0 ? AUD.format(r.budget) : '—'}</td>
                      <td className={`px-4 py-3 text-sm text-right font-medium ${budgetOver ? 'text-red-600' : 'text-gray-700'}`}>
                        {r.actualSpend > 0 ? AUD.format(r.actualSpend) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-green-700">
                        {r.attributedRevenue > 0 ? AUD.format(r.attributedRevenue) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-emerald-600">
                        {r.indirectRevenue !== 0 ? AUD.format(r.indirectRevenue) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {ratio !== null ? (
                          <span className={`font-medium ${ratio < 0.15 ? 'text-green-700' : ratio < 0.3 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {(ratio * 100).toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => onEdit(r)} title="Edit"
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors text-sm">✎</button>
                          <button onClick={() => { if (window.confirm('Delete this spend record?')) onDelete(r.id); }} title="Delete"
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors text-sm">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-gray-50 border-t-2 border-gray-300 sticky bottom-0">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Totals ({filtered.length})</td>
                    <td className="px-4 py-2.5 text-sm text-right font-semibold text-blue-700">{totalBudget > 0 ? AUD.format(totalBudget) : '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-semibold text-gray-900">{totalSpend > 0 ? AUD.format(totalSpend) : '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-semibold text-green-700">{totalAttributed > 0 ? AUD.format(totalAttributed) : '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-semibold text-emerald-600">{totalIndirect !== 0 ? AUD.format(totalIndirect) : '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-semibold text-gray-700">{roas > 0 ? `${roas.toFixed(1)}x` : '—'}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
