'use client';

import { useState, useEffect, useCallback } from 'react';
import { Campaign, FYFilter, ViewMode, SpendRecord } from '@/lib/types';
import { SpendBrand } from '@/lib/constants';
import CalendarView from '@/components/CalendarView';
import ListView from '@/components/ListView';
import ChatPanel from '@/components/ChatPanel';
import CampaignModal from '@/components/CampaignModal';
import FinanceTab from '@/components/FinanceTab';
import SpendModal from '@/components/SpendModal';
import EmailTab from '@/components/EmailTab';

export default function Home() {
  // ── Campaign state ──
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Spend state ──
  const [spendRecords, setSpendRecords] = useState<SpendRecord[]>([]);
  const [spendLoading, setSpendLoading] = useState(false);
  const [spendError, setSpendError] = useState('');

  // ── UI state ──
  const [selectedFY, setSelectedFY] = useState<FYFilter>('FY26');
  const [view, setView] = useState<ViewMode>('calendar');
  const [chatOpen, setChatOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | undefined>();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // ── Campaign modal state ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [defaultMonth, setDefaultMonth] = useState<string | undefined>();

  // ── Spend modal state ──
  const [spendModalOpen, setSpendModalOpen] = useState(false);
  const [editingSpend, setEditingSpend] = useState<SpendRecord | null>(null);
  const [defaultSpendBrand, setDefaultSpendBrand] = useState<string | undefined>();

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch campaigns ──
  const fetchCampaigns = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/campaigns');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setCampaigns(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch spend records ──
  const fetchSpendRecords = useCallback(async () => {
    setSpendLoading(true);
    try {
      setSpendError('');
      const res = await fetch('/api/spend');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSpendRecords(await res.json());
    } catch (err) {
      setSpendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpendLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  // Lazy-load spend records when Finance tab is first opened
  useEffect(() => {
    if (view === 'finance' && spendRecords.length === 0 && !spendLoading && !spendError) {
      fetchSpendRecords();
    }
  }, [view, spendRecords.length, spendLoading, spendError, fetchSpendRecords]);

  const filteredCampaigns = selectedFY === 'All'
    ? campaigns
    : campaigns.filter(c => c.fy === selectedFY);

  // ── Campaign CRUD ──

  const handleSave = async (data: Omit<Campaign, 'id'>) => {
    setSaving(true);
    try {
      if (editingCampaign) {
        const res = await fetch(`/api/campaigns/${editingCampaign.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const updated: Campaign = await res.json();
        if (!res.ok) throw new Error((updated as { error?: string }).error || 'Update failed');
        setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? updated : c));
        showToast('Campaign updated');
      } else {
        const res = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const created: Campaign = await res.json();
        if (!res.ok) throw new Error((created as { error?: string }).error || 'Create failed');
        setCampaigns(prev => [...prev, created]);
        showToast('Campaign added');
      }
      closeModal();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      setCampaigns(prev => prev.filter(c => c.id !== id));
      showToast('Campaign deleted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkComplete = async (id: string) => {
    const campaign = campaigns.find(c => c.id === id);
    if (!campaign) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Complete' }),
      });
      const updated: Campaign = await res.json();
      if (!res.ok) throw new Error((updated as { error?: string }).error || 'Update failed');
      setCampaigns(prev => prev.map(c => c.id === id ? updated : c));
      showToast(`"${campaign.name}" marked complete`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Spend CRUD ──

  const handleSpendSave = async (data: Omit<SpendRecord, 'id'>) => {
    setSaving(true);
    try {
      if (editingSpend) {
        const res = await fetch(`/api/spend/${editingSpend.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const updated: SpendRecord = await res.json();
        if (!res.ok) throw new Error((updated as { error?: string }).error || 'Update failed');
        setSpendRecords(prev => prev.map(r => r.id === editingSpend.id ? updated : r));
        showToast('Record updated');
      } else {
        const res = await fetch('/api/spend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const created: SpendRecord = await res.json();
        if (!res.ok) throw new Error((created as { error?: string }).error || 'Create failed');
        setSpendRecords(prev => [...prev, created]);
        showToast('Record added');
      }
      closeSpendModal();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSpendDelete = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/spend/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      setSpendRecords(prev => prev.filter(r => r.id !== id));
      showToast('Record deleted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Google Ads sync ──

  const handleSyncGoogleAds = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync-google-ads', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Sync failed');
      setLastSynced(d.syncedAt);
      await fetchSpendRecords(); // reload updated records
      const skippedNote = d.skipped?.length ? ` (${d.skipped.length} rows not matched)` : '';
      showToast(`Google Ads synced — ${d.updated} records updated${skippedNote}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSyncing(false);
    }
  };

  // ── Modal helpers ──

  const openAddModal = (month?: string) => {
    setEditingCampaign(null);
    setDefaultMonth(month);
    setModalOpen(true);
  };

  const openEditModal = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setDefaultMonth(undefined);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingCampaign(null);
    setDefaultMonth(undefined);
  };

  const openAddSpendModal = (brand: SpendBrand) => {
    setEditingSpend(null);
    setDefaultSpendBrand(brand);
    setSpendModalOpen(true);
  };

  const openEditSpendModal = (record: SpendRecord) => {
    setEditingSpend(record);
    setDefaultSpendBrand(undefined);
    setSpendModalOpen(true);
  };

  const closeSpendModal = () => {
    setSpendModalOpen(false);
    setEditingSpend(null);
    setDefaultSpendBrand(undefined);
  };

  // ── Summary stats ──
  const completeCount = filteredCampaigns.filter(c => c.status === 'Complete').length;
  const totalRevenue  = filteredCampaigns.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalOrders   = filteredCampaigns.reduce((s, c) => s + (c.orders || 0), 0);
  const topCampaigns  = [...filteredCampaigns].sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 3);
  const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  const FMT = new Intl.NumberFormat('en-AU');

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 shadow-sm z-30 shrink-0">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold leading-none">PP</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900 leading-tight">Pascal Press</h1>
              <p className="text-xs text-gray-500 leading-tight">Marketing Campaign Planner</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* FY Selector */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {(['FY25', 'FY26', 'FY27', 'All'] as FYFilter[]).map(fy => (
                <button
                  key={fy}
                  onClick={() => setSelectedFY(fy)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedFY === fy ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {fy}
                </button>
              ))}
            </div>

            {/* View Toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => setView('calendar')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'calendar' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="12" height="11" rx="1.5"/>
                  <line x1="1" y1="5.5" x2="13" y2="5.5"/>
                  <line x1="4.5" y1="1" x2="4.5" y2="4"/>
                  <line x1="9.5" y1="1" x2="9.5" y2="4"/>
                </svg>
                Calendar
              </button>
              <button
                onClick={() => setView('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="4" y1="3.5" x2="13" y2="3.5"/>
                  <line x1="4" y1="7" x2="13" y2="7"/>
                  <line x1="4" y1="10.5" x2="13" y2="10.5"/>
                  <circle cx="1.5" cy="3.5" r="0.8" fill="currentColor" stroke="none"/>
                  <circle cx="1.5" cy="7" r="0.8" fill="currentColor" stroke="none"/>
                  <circle cx="1.5" cy="10.5" r="0.8" fill="currentColor" stroke="none"/>
                </svg>
                List
              </button>
              <button
                onClick={() => setView('finance')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'finance' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="7" width="3" height="6" rx="0.5"/>
                  <rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
                  <rect x="10" y="1" width="3" height="12" rx="0.5"/>
                </svg>
                Finance
              </button>
              <button
                onClick={() => setView('email')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${view === 'email' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2.5" width="12" height="9" rx="1"/>
                  <polyline points="1,2.5 7,8 13,2.5"/>
                </svg>
                Email
              </button>
            </div>

            {/* Add Campaign (hidden on Finance and Email tabs) */}
            {view !== 'finance' && view !== 'email' && (
              <button
                onClick={() => openAddModal()}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                + Add Campaign
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={() => {
                if (view === 'finance') { setSpendLoading(true); fetchSpendRecords(); }
                else if (view !== 'email') { setLoading(true); fetchCampaigns(); }
              }}
              title="Refresh data"
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3"/>
                <polyline points="13.5 2 13.5 5.5 10 5.5"/>
              </svg>
            </button>

            {/* Claude Chat */}
            <button
              onClick={() => setChatOpen(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
                chatOpen ? 'bg-blue-700 text-white border-blue-700' : 'text-blue-700 border-blue-700 hover:bg-blue-50'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 0.5l1.2 3.8 3.8 0-3.1 2.2 1.2 3.8L7 8.1 3.9 10.3l1.2-3.8L2 4.3l3.8 0z"/>
              </svg>
              Claude AI
            </button>
          </div>
        </div>

        {/* ── Sub-stats bar (campaign views only) ── */}
        {view !== 'finance' && view !== 'email' && !loading && !error && (
          <div className="flex items-center gap-5 px-6 py-2 border-t border-gray-100 text-sm text-gray-600 flex-wrap">
            <span><strong className="text-gray-900">{filteredCampaigns.length}</strong> campaigns</span>
            <span><strong className="text-gray-900">{completeCount}</strong> complete</span>
            {totalRevenue > 0 && <span>Revenue: <strong className="text-green-700">{AUD.format(totalRevenue)}</strong></span>}
            {totalOrders > 0 && <span>Orders: <strong className="text-gray-900">{FMT.format(totalOrders)}</strong></span>}
            {topCampaigns.length > 0 && totalRevenue > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-gray-400 text-xs uppercase tracking-wide font-medium">Top 3:</span>
                {topCampaigns.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-1">
                    <span className="text-gray-400 text-xs">{i + 1}.</span>
                    <strong className="text-gray-900 truncate max-w-[180px]">{c.name}</strong>
                    <span className="text-green-700">{AUD.format(c.revenue)}</span>
                  </span>
                ))}
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Body ── */}
      <main className="flex-1 overflow-hidden flex">
        <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${chatOpen ? 'mr-[420px]' : ''}`}>

          {/* Campaign views */}
          {view !== 'finance' && view !== 'email' && (
            loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderWidth: 3 }} />
                  <p className="text-sm text-gray-500">Loading campaigns from Monday.com…</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-lg text-center">
                  <div className="text-3xl mb-3">⚠️</div>
                  <h3 className="font-semibold text-red-800 mb-2">Could not load campaigns</h3>
                  <p className="text-sm text-red-600 mb-4 font-mono">{error}</p>
                  <button
                    onClick={() => { setLoading(true); fetchCampaigns(); }}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : view === 'calendar' ? (
              <CalendarView
                campaigns={filteredCampaigns}
                selectedFY={selectedFY}
                onEdit={openEditModal}
                onAddForMonth={openAddModal}
                onDelete={handleDelete}
              />
            ) : (
              <ListView
                campaigns={filteredCampaigns}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onMarkComplete={handleMarkComplete}
              />
            )
          )}

          {/* Finance view */}
          {view === 'finance' && (
            spendLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderWidth: 3 }} />
                  <p className="text-sm text-gray-500">Loading spend data from Monday.com…</p>
                </div>
              </div>
            ) : spendError ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-lg text-center">
                  <div className="text-3xl mb-3">⚠️</div>
                  <h3 className="font-semibold text-red-800 mb-2">Could not load spend data</h3>
                  <p className="text-sm text-red-600 mb-4 font-mono">{spendError}</p>
                  {spendError.includes('spend-board') && (
                    <p className="text-sm text-red-700 mb-4">
                      Run <code className="bg-red-100 px-1 rounded">POST /api/spend-board</code> to create the spend board first.
                    </p>
                  )}
                  <button
                    onClick={() => fetchSpendRecords()}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <FinanceTab
                records={spendRecords}
                selectedFY={selectedFY}
                saving={saving}
                syncing={syncing}
                lastSynced={lastSynced}
                onEdit={openEditSpendModal}
                onDelete={handleSpendDelete}
                onAdd={openAddSpendModal}
                onSyncGoogleAds={handleSyncGoogleAds}
              />
            )
          )}

          {/* Email view */}
          {view === 'email' && <EmailTab />}
        </div>
      </main>

      {/* ── Chat Panel ── */}
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} onCampaignCreated={fetchCampaigns} />

      {/* ── Campaign Modal ── */}
      {modalOpen && (
        <CampaignModal
          campaign={editingCampaign}
          defaultMonth={defaultMonth}
          defaultFY={selectedFY !== 'All' ? selectedFY : 'FY26'}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}

      {/* ── Spend Modal ── */}
      {spendModalOpen && (
        <SpendModal
          record={editingSpend}
          defaultBrand={defaultSpendBrand}
          defaultFY={selectedFY !== 'All' ? selectedFY : 'FY26'}
          onSave={handleSpendSave}
          onClose={closeSpendModal}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
