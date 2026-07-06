'use client';

import { useState, useMemo } from 'react';
import { Campaign } from '@/lib/types';
import { CAMPAIGN_COLORS } from '@/lib/constants';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// Parse "3-19 July 2026", "3–19 July 2026", "1 July – 19 August 2026"
function parseDateRange(dr: string): { start: Date; end: Date } | null {
  if (!dr) return null;
  const s = dr.replace(/[–—]/g, '-').trim();
  // "D-D Month YYYY"
  const m1 = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m1) {
    const mi = MONTH_NAMES.findIndex(n =>
      n.toLowerCase().startsWith(m1[3].toLowerCase().substring(0, 3)));
    if (mi >= 0) return { start: new Date(+m1[4], mi, +m1[1]), end: new Date(+m1[4], mi, +m1[2]) };
  }
  // "D Month - D Month YYYY"
  const m2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m2) {
    const mi1 = MONTH_NAMES.findIndex(n => n.toLowerCase().startsWith(m2[2].toLowerCase().substring(0, 3)));
    const mi2 = MONTH_NAMES.findIndex(n => n.toLowerCase().startsWith(m2[4].toLowerCase().substring(0, 3)));
    if (mi1 >= 0 && mi2 >= 0)
      return { start: new Date(+m2[5], mi1, +m2[1]), end: new Date(+m2[5], mi2, +m2[3]) };
  }
  return null;
}

function getRange(c: Campaign, year: number): { start: Date; end: Date } {
  // Prefer explicit ISO dates
  if (c.startDate && c.endDate) {
    return {
      start: new Date(c.startDate + 'T12:00:00'),
      end:   new Date(c.endDate   + 'T12:00:00'),
    };
  }
  // Fall back to parsing legacy dateRange text
  const parsed = parseDateRange(c.dateRange);
  if (parsed) return parsed;
  // Fall back to full month
  const mi = MONTH_NAMES.indexOf(c.month);
  if (mi >= 0) return { start: new Date(year, mi, 1), end: new Date(year, mi + 1, 0) };
  return { start: new Date(year, 6, 1), end: new Date(year, 6, 31) };
}

interface Props {
  campaigns: Campaign[];
  onEdit: (c: Campaign) => void;
  onAddForMonth: (month: string) => void;
}

export default function CampaignCalendarGrid({ campaigns, onEdit, onAddForMonth }: Props) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const monthName    = MONTH_NAMES[month];
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const firstDayJS   = new Date(year, month, 1).getDay();        // 0=Sun
  const firstDayMon  = (firstDayJS + 6) % 7;                     // 0=Mon

  // Build flat array of day numbers (null = padding)
  const allDays: (number | null)[] = [
    ...Array<null>(firstDayMon).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (allDays.length % 7 !== 0) allDays.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  // Campaigns visible in this month
  const visible = useMemo(() => {
    const mStart = new Date(year, month, 1);
    const mEnd   = new Date(year, month + 1, 0);
    return campaigns
      .map(c => ({ c, r: getRange(c, year) }))
      .filter(({ r }) => r.start <= mEnd && r.end >= mStart);
  }, [campaigns, year, month]);

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Month nav */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
        <button
          onClick={prev}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 text-lg font-semibold"
        >‹</button>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">{monthName} {year}</h2>
          <button
            onClick={goToday}
            className="text-xs text-blue-600 border border-blue-300 rounded-md px-2 py-0.5 hover:bg-blue-50 transition-colors"
          >Today</button>
          <button
            onClick={() => onAddForMonth(monthName)}
            className="text-xs text-white bg-blue-600 rounded-md px-2.5 py-0.5 hover:bg-blue-700 transition-colors"
          >+ Add</button>
        </div>
        <button
          onClick={next}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 text-lg font-semibold"
        >›</button>
      </div>

      <div className="p-4">
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Week rows */}
          {weeks.map((week, wi) => {
            const realDays = week.filter((d): d is number => d !== null);
            if (realDays.length === 0) return null;

            const weekStart = new Date(year, month, realDays[0]);
            const weekEnd   = new Date(year, month, realDays[realDays.length - 1]);

            // Compute bars for campaigns crossing this week
            type Bar = {
              c: Campaign;
              startCol: number;
              span: number;
              isStart: boolean;
              isEnd: boolean;
            };

            const bars: Bar[] = [];
            for (const { c, r } of visible) {
              if (r.start > weekEnd || r.end < weekStart) continue;

              const clampStart = r.start < weekStart ? weekStart : r.start;
              const clampEnd   = r.end   > weekEnd   ? weekEnd   : r.end;

              // Find startCol (first column index where day >= clampStart)
              let startCol = 0;
              for (let ci = 0; ci < 7; ci++) {
                if (week[ci] !== null) {
                  const d = new Date(year, month, week[ci] as number);
                  if (d >= clampStart) { startCol = ci; break; }
                }
              }

              // Count span (columns where day <= clampEnd)
              let span = 0;
              for (let ci = startCol; ci < 7; ci++) {
                if (week[ci] !== null && new Date(year, month, week[ci] as number) <= clampEnd) span++;
              }
              if (span < 1) span = 1;

              bars.push({
                c,
                startCol,
                span,
                isStart: r.start >= weekStart,
                isEnd:   r.end   <= weekEnd,
              });
            }

            return (
              <div key={wi} className="border-b border-gray-100 last:border-b-0">
                {/* Day numbers */}
                <div className="grid grid-cols-7">
                  {week.map((day, di) => {
                    const isToday =
                      day === today.getDate() &&
                      month === today.getMonth() &&
                      year === today.getFullYear();
                    return (
                      <div
                        key={di}
                        className={`border-r border-gray-100 last:border-r-0 h-9 flex items-start pt-1.5 px-1.5 ${
                          day === null ? 'bg-gray-50/60' : ''
                        }`}
                      >
                        {day && (
                          <span
                            className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
                              isToday ? 'bg-blue-600 text-white' : 'text-gray-500'
                            }`}
                          >
                            {day}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Campaign bars — CSS grid auto-placement handles row stacking */}
                {bars.length > 0 && (
                  <div
                    className="grid grid-cols-7 pb-2 px-px gap-y-0.5"
                    style={{ gridAutoRows: '24px' }}
                  >
                    {bars.map((bar, bi) => {
                      const color = bar.c.color || CAMPAIGN_COLORS[bar.c.type] || '#888';
                      return (
                        <button
                          key={bi}
                          onClick={() => onEdit(bar.c)}
                          title={bar.c.name + (bar.c.campaignCode ? ` [${bar.c.campaignCode}]` : '')}
                          className="h-[22px] text-white text-xs font-medium px-2 truncate hover:opacity-80 transition-opacity text-left"
                          style={{
                            gridColumn: `${bar.startCol + 1} / span ${bar.span}`,
                            backgroundColor: color,
                            borderRadius: bar.isStart && bar.isEnd
                              ? '4px'
                              : bar.isStart ? '4px 0 0 4px'
                              : bar.isEnd   ? '0 4px 4px 0'
                              : '0',
                          }}
                        >
                          {bar.isStart ? bar.c.name : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Campaign list for this month */}
      {visible.length > 0 && (
        <div className="px-6 pb-6">
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">
            {visible.length} campaign{visible.length !== 1 ? 's' : ''} in {monthName}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visible.map(({ c }) => (
              <button
                key={c.id}
                onClick={() => onEdit(c)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-white hover:opacity-80 transition-opacity"
                style={{ backgroundColor: c.color || CAMPAIGN_COLORS[c.type] || '#888' }}
              >
                {c.name}
                {c.campaignCode && (
                  <span className="opacity-75">[{c.campaignCode}]</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
