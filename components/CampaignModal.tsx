'use client';

import { useState, useEffect } from 'react';
import { Campaign } from '@/lib/types';
import { CAMPAIGN_TYPES, FY_MONTHS } from '@/lib/constants';

interface Props {
  campaign?: Campaign | null;
  defaultMonth?: string;
  defaultFY?: string;
  onSave: (data: Omit<Campaign, 'id'>) => void;
  onClose: () => void;
}

const EMPTY: Omit<Campaign, 'id'> = {
  name: '',
  campaignCode: '',
  promoCode: '',
  type: 'Storewide Sale',
  month: 'July',
  dateRange: '',
  revenue: 0,
  orders: 0,
  unitsSold: 0,
  fy: 'FY26',
  brand: 'Pascal Press',
  status: 'Planned',
  notes: '',
};

const LS_KEY = 'pp_custom_campaign_types';

export default function CampaignModal({ campaign, defaultMonth, defaultFY, onSave, onClose }: Props) {
  const [form, setForm] = useState<Omit<Campaign, 'id'>>(EMPTY);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  // Load custom types from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setCustomTypes(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    if (campaign) {
      const { id: _id, ...rest } = campaign;
      setForm(rest);
    } else {
      setForm({
        ...EMPTY,
        month: defaultMonth || EMPTY.month,
        fy: defaultFY || EMPTY.fy,
      });
    }
  }, [campaign, defaultMonth, defaultFY]);

  const set = (field: keyof typeof form, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // All campaign types: built-in (minus Other) + custom + Other
  const allTypes = [
    ...CAMPAIGN_TYPES.filter(t => t !== 'Other'),
    ...customTypes,
    'Other',
  ];

  const handleTypeChange = (val: string) => {
    if (val === '__add__') {
      setAddingType(true);
    } else {
      set('type', val);
    }
  };

  const confirmNewType = () => {
    const t = newTypeName.trim();
    if (!t) { setAddingType(false); return; }
    if (!allTypes.includes(t)) {
      const updated = [...customTypes, t];
      setCustomTypes(updated);
      try { localStorage.setItem(LS_KEY, JSON.stringify(updated)); } catch {}
    }
    set('type', t);
    setAddingType(false);
    setNewTypeName('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {campaign ? 'Edit Campaign' : 'New Campaign'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Campaign Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
            <input
              required
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Back to School Term 1"
            />
          </div>

          {/* Row: Type + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Type *</label>
              <select
                required
                value={addingType ? '__add__' : form.type}
                onChange={e => handleTypeChange(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="__add__">＋ Add new type…</option>
              </select>
              {addingType && (
                <div className="flex gap-2 mt-2">
                  <input
                    autoFocus
                    type="text"
                    value={newTypeName}
                    onChange={e => setNewTypeName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmNewType(); }
                      if (e.key === 'Escape') { setAddingType(false); setNewTypeName(''); }
                    }}
                    placeholder="New type name…"
                    className="flex-1 border border-blue-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={confirmNewType}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                  >Add</button>
                  <button
                    type="button"
                    onClick={() => { setAddingType(false); setNewTypeName(''); }}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"
                  >Cancel</button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value as 'Planned' | 'Complete')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Planned">Planned</option>
                <option value="Complete">Complete</option>
              </select>
            </div>
          </div>

          {/* Row: Month + FY */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
              <select
                required
                value={form.month}
                onChange={e => set('month', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FY_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year *</label>
              <select
                required
                value={form.fy}
                onChange={e => set('fy', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="FY25">FY25</option>
                <option value="FY26">FY26</option>
                <option value="FY27">FY27</option>
              </select>
            </div>
          </div>

          {/* Row: Brand + Campaign Code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <input
                type="text"
                value={form.brand}
                onChange={e => set('brand', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Pascal Press"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Code</label>
              <input
                type="text"
                value={form.campaignCode}
                onChange={e => set('campaignCode', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. MATHS15"
              />
            </div>
          </div>

          {/* Row: Promo Code + Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code</label>
              <input
                type="text"
                value={form.promoCode}
                onChange={e => set('promoCode', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. PP5755"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
              <input
                type="text"
                value={form.dateRange}
                onChange={e => set('dateRange', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="3–19 July 2026"
              />
            </div>
          </div>

          {/* Row: Revenue + Orders + Units Sold */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revenue ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.revenue || ''}
                onChange={e => set('revenue', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Orders</label>
              <input
                type="number"
                min="0"
                value={form.orders || ''}
                onChange={e => set('orders', parseInt(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Units Sold</label>
              <input
                type="number"
                min="0"
                value={form.unitsSold || ''}
                onChange={e => set('unitsSold', parseInt(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {campaign ? 'Save Changes' : 'Add Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
