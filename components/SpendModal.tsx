'use client';

import { useState, useEffect } from 'react';
import { SpendRecord } from '@/lib/types';
import { SPEND_CHANNELS, SPEND_BRANDS, FY_MONTHS } from '@/lib/constants';

interface Props {
  record?: SpendRecord | null;
  defaultBrand?: string;
  defaultFY?: string;
  onSave: (data: Omit<SpendRecord, 'id'>) => void;
  onClose: () => void;
}

const EMPTY: Omit<SpendRecord, 'id'> = {
  brand: 'Pascal Press',
  channel: 'Google Ads',
  month: 'January',
  fy: 'FY26',
  budget: 0,
  actualSpend: 0,
  attributedRevenue: 0,
  indirectRevenue: 0,
  notes: '',
};

export default function SpendModal({ record, defaultBrand, defaultFY, onSave, onClose }: Props) {
  const [form, setForm] = useState<Omit<SpendRecord, 'id'>>(EMPTY);

  useEffect(() => {
    if (record) {
      const { id: _id, ...rest } = record;
      setForm(rest);
    } else {
      setForm({ ...EMPTY, brand: defaultBrand || EMPTY.brand, fy: defaultFY || EMPTY.fy });
    }
  }, [record, defaultBrand, defaultFY]);

  const set = (field: keyof typeof form, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {record ? 'Edit Spend Record' : 'New Spend Record'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="p-6 space-y-4">

          {/* Brand + Channel */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <select required value={form.brand} onChange={e => set('brand', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {SPEND_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel *</label>
              <select required value={form.channel} onChange={e => set('channel', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {SPEND_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Month + FY */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
              <select required value={form.month} onChange={e => set('month', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {FY_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year *</label>
              <select required value={form.fy} onChange={e => set('fy', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="FY25">FY25</option>
                <option value="FY26">FY26</option>
                <option value="FY27">FY27</option>
              </select>
            </div>
          </div>

          {/* Budget + Actual Spend */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget ($)</label>
              <input type="number" min="0" step="0.01" value={form.budget || ''}
                onChange={e => set('budget', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Actual Spend ($)</label>
              <input type="number" min="0" step="0.01" value={form.actualSpend || ''}
                onChange={e => set('actualSpend', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>

          {/* Attributed Revenue + Indirect Revenue */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attributed Revenue ($)</label>
              <input type="number" step="0.01" value={form.attributedRevenue || ''}
                onChange={e => set('attributedRevenue', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Indirect Revenue ($)</label>
              <input type="number" step="0.01" value={form.indirectRevenue || ''}
                onChange={e => set('indirectRevenue', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="e.g. June is partial month (TD)" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
              {record ? 'Save Changes' : 'Add Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
