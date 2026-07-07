'use client';

import { useState } from 'react';
import { Campaign } from '@/lib/types';
import { CAMPAIGN_COLORS, FY_MONTHS } from '@/lib/constants';
import CampaignCalendarGrid from './CampaignCalendarGrid';

interface Props {
  campaigns: Campaign[];
  selectedFY: string;
  onEdit: (campaign: Campaign) => void;
  onAddForMonth: (month: string, brand?: string) => void;
  onDelete: (id: string) => void;
}

type CalMode = 'cards' | 'grid';
type BrandFilter = 'All Brands' | 'Pascal Press' | 'Excel Test Zone';

const BRAND_TABS: BrandFilter[] = ['All Brands', 'Pascal Press', 'Excel Test Zone'];

export default function CalendarView({ campaigns, selectedFY, onEdit, onAddForMonth, onDelete }: Props) {
  const [selectedType,  setSelectedType]  = useState<string | null>(null);
  const [calMode,       setCalMode]       = useState<CalMode>('grid');
  const [selectedBrand, setSelectedBrand] = useState<BrandFilter>('All Brands');
  const months = FY_MONTHS;

  const brandFiltered   = selectedBrand === 'All Brands' ? campaigns : campaigns.filter(c => c.brand === selectedBrand);
  const visibleCampaigns = selectedType ? brandFiltered.filter(c => c.type === selectedType) : brandFiltered;

  const addForMonth = (month: string) =>
    onAddForMonth(month, selectedBrand === 'All Brands' ? undefined : selectedBrand);

  const campaignsByMonth: Record<string, Campaign[]> = {};
  for (const m of months) campaignsByMonth[m] = [];
  for (const c of visibleCampaigns) {
    if (campaignsByMonth[c.month]) campaignsByMonth[c.month].push(c);
  }

  const totalRevenue = visibleCampaigns.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalOrders  = visibleCampaigns.reduce((s, c) => s + (c.orders  || 0), 0);
  const complete     = visibleCampaigns.filter(c => c.status === 'Complete').length;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Brand tabs */}
      <div className="flex items-center gap-1 px-6 py-2 bg-white border-b border-gray-100 shrink-0">
        {BRAND_TABS.map(b => (
          <button
            key={b}
            onClick={() => setSelectedBrand(b)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              selectedBrand === b
                ? b === 'Pascal Press'     ? 'bg-blue-600 text-white'
                : b === 'Excel Test Zone'  ? 'bg-orange-500 text-white'
                :                           'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      {/* Summary + mode toggle bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 text-sm text-gray-600 shrink-0">
        <div className="flex items-center gap-5 flex-wrap">
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
              {selectedType} &#x2715;
            </span>
          )}
        </div>

        {/* View toggle: Calendar Grid vs Month Cards */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0">
          <button
            onClick={() => setCalMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              calMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
            title="Calendar grid view"
          >
            {/* Calendar icon */}
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="12" height="11" rx="1.5"/>
              <line x1="1" y1="5.5" x2="13" y2="5.5"/>
              <line x1="4.5" y1="1" x2="4.5" y2="4"/>
              <line x1="9.5" y1="1" x2="9.5" y2="4"/>
            </svg>
            Calendar
          </button>
          <button
            onClick={() => setCalMode('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              calMode === 'cards' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
            title="Month cards view"
          >
            {/* Grid icon */}
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="5" height="5" rx="1"/>
              <rect x="8" y="1" width="5" height="5" rx="1"/>
              <rect x="1" y="8" width="5" height="5" rx="1"/>
              <rect x="8" y="8" width="5" height="5" rx="1"/>
            </svg>
            Month Cards
          </button>
        </div>
      </div>

      {/* Calendar Grid mode */}
      {calMode === 'grid' && (
        <CampaignCalendarGrid
          campaigns={visibleCampaigns}
          onEdit={onEdit}
          onAddForMonth={addForMonth}
        />
      )}

      {/* Month Cards mode */}
      {calMode === 'cards' && (
        <>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {months.map(month => {
              const items = campaignsByMonth[month] || [];
              const monthComplete = items.filter(c => c.status === 'Complete').length;

              return (
                <div key={month} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow min-h-[160px] flex flex-col">
                  {/* Month header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div>
                      <span className="font-semibold text-gray-800 text-sm">{month}</span>
                      {items.length > 0 && (
                        <span className="ml-2 text-xs text-gray-400">
                          {monthComplete}/{items.length}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => addForMonth(month)}
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
                        <div
                          key={c.id}
                          className="group relative w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-white"
                          style={{ backgroundColor: c.color || CAMPAIGN_COLORS[c.type] || CAMPAIGN_COLORS['Other'] }}
                        >
                          <button className="w-full text-left" onClick={() => onEdit(c)}>
                            <div className="flex items-center justify-between gap-1 pr-4">
                              <span className="truncate">{c.name}</span>
                              {c.status === 'Complete' && (
                                <span className="shrink-0 text-white opacity-80">&#x2713;</span>
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
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm(`Delete "${c.name}"?`)) onDelete(c.id);
                            }}
                            className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-black/20 transition-opacity text-white leading-none"
                            title="Delete campaign"
                          >
                            &#xd7;
                          </button>
                        </div>
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
                    title={isActive ? 'Clear filter' : `Filter by ${type}`}
                  >
                    {type}
                    {isActive && <span className="ml-0.5 opacity-80">&#x2715;</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
