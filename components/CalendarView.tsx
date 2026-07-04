'use client';

import { useState } from 'react';
import { Campaign } from '@/lib/types';
import { CAMPAIGN_COLORS, FY_MONTHS } from '@/lib/constants';

interface Props {
  campaigns: Campaign[];
  selectedFY: string;
  onEdit: (campaign: Campaign) => void;
  onAddForMonth: (month: string) => void;
}

export default function CalendarView({ campaigns, selectedFY, onEdit, onAddForMonth }: Props) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const months = FY_MONTHS;

  const visibleCampaigns = selectedType ? campaigns.filter(c => c.type === selectedType) : campaigns;

  const campaignsByMonth: Record<string, Campaign[]> = {};
  for (const m of months) campaignsByMonth[m] = [];

  for (const c of visibleCampaigns) {
    if (campaignsByMonth[c.month]) {
      campaignsByMonth[c.month].push(c);
    }
  }

  const totalRevenue = visibleCampaigns.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalOrders = visibleCampaigns.reduce((s, c) => s + (c.orders || 0), 0);
  const complete = visibleCampaigns.filter(c => c.status === 'Complete').length;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Summary bar */}
      <div className="flex items-center gap-6 px-6 py-3 bg-white border-b border-gray-200 text-sm text-gray-600">
        <span><strong className="text-gray-900">{visibleCampaigns.length}</strong> campaigns</span>
        <span><strong className="text-gray-900">{complete}</strong> complete</span>
        {totalRevenue > 0 && (
          <span>Revenue: <strong className="text-gray-900">${totalRevenue.toLocaleString()}</strong></span>
        )}
        {totalOrders > 0 && (
          <span>Orders: <strong className="text-gray-900">{totalOrders.toLocaleString()}</strong></span>
        )}
        {selectedType && (
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-white cursor-pointer hover:opacity-80"
            style={{ backgroundColor: CAMPAIGN_COLORS[selectedType] || '#888' }}
            onClick={() => setSelectedType(null)}
            title="Clear filter"
          >
            {selectedType} ✕
          </span>
        )}
      </div>

      {/* Calendar grid */}
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {months.map(month => {
          const items = campaignsByMonth[month] || [];
          const complete = items.filter(c => c.status === 'Complete').length;

          return (
            <div key={month} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow min-h-[160px] flex flex-col">
              {/* Month header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
                  <span className="font-semibold text-gray-800 text-sm">{month}</span>
                  {items.length > 0 && (
                    <span className="ml-2 text-xs text-gray-400">
                      {complete}/{items.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onAddForMonth(month)}
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-600 text-gray-400 text-lg leading-none transition-colors"
                  title={`Add campaign for ${month}`}
                >
                  +
                </button>
              </div>

              {/* Campaign chips */}
              <div className="p-3 flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-64">
                {items.length === 0 ? (
                  <p className="text-xs text-gray-300 italic text-center mt-4">No campaigns</p>
                ) : (
                  items.map(c => (
                    <button
                      key={c.id}
                      onClick={() => onEdit(c)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 active:opacity-75"
                      style={{ backgroundColor: CAMPAIGN_COLORS[c.type] || CAMPAIGN_COLORS['Other'] }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{c.name}</span>
                        {c.status === 'Complete' && (
                          <span className="shrink-0 text-white opacity-80">✓</span>
                        )}
                      </div>
                      {(c.revenue > 0 || c.orders > 0) && (
                        <div className="mt-0.5 text-white opacity-75 text-xs">
                          {c.revenue > 0 && `$${c.revenue.toLocaleString()}`}
                          {c.revenue > 0 && c.orders > 0 && ' · '}
                          {c.orders > 0 && `${c.orders.toLocaleString()} orders`}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend / Type filter */}
      <div className="px-6 pb-6">
        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Campaign Types</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CAMPAIGN_COLORS).map(([type, color]) => {
            const isActive = selectedType === type;
            return (
              <button
                key={type}
                onClick={() => setSelectedType(isActive ? null : type)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs text-white transition-all"
                style={{
                  backgroundColor: color,
                  opacity: selectedType && !isActive ? 0.35 : 1,
                  outline: isActive ? '2px solid white' : 'none',
                  outlineOffset: '1px',
                  boxShadow: isActive ? `0 0 0 3px ${color}` : 'none',
                }}
                title={isActive ? `Clear filter` : `Filter by ${type}`}
              >
                {type}
                {isActive && <span className="ml-0.5 opacity-80">✕</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
