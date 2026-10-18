'use client';

/**
 * Month-range picker with one-click quarter buttons (financial-year quarters: Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun).
 * Used by Business Units and Product Performance so both filter periods the same way.
 * Values are 'YYYY-MM' month keys; the From month is the 1st and the To month runs to its last day (or today).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthRange { from: string; to: string }

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const idx = y! * 12 + (m! - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

/** The most recent financial-year quarters, newest first (the first may still be in progress). */
export function recentQuarters(count = 6): { label: string; from: string; to: string; inProgress: boolean }[] {
  const nowKey = currentMonthKey();
  const [y, m] = nowKey.split('-').map(Number);
  // quarter start months are 1, 4, 7, 10
  const qStartMonth = Math.floor((m! - 1) / 3) * 3 + 1;
  let start = `${y}-${String(qStartMonth).padStart(2, '0')}`;
  const out: { label: string; from: string; to: string; inProgress: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const to = addMonths(start, 2);
    const [sy] = start.split('-').map(Number);
    const [ty] = to.split('-').map(Number);
    const label = sy === ty
      ? `${MONTHS[Number(start.slice(5)) - 1]}–${MONTHS[Number(to.slice(5)) - 1]} ${ty}`
      : `${MONTHS[Number(start.slice(5)) - 1]} ${sy}–${MONTHS[Number(to.slice(5)) - 1]} ${ty}`;
    out.push({ label, from: start, to, inProgress: to >= nowKey });
    start = addMonths(start, -3);
  }
  return out;
}

/** Start and end dates (YYYY-MM-DD) for a month range; the end is capped at today. */
export function monthRangeToDates(r: MonthRange, today: string): { start: string; end: string } {
  const [y, m] = r.to.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { start: `${r.from}-01`, end: last > today ? today : last };
}

export default function MonthRangePicker({
  value, onChange, accent = '#111827',
}: { value: MonthRange; onChange: (r: MonthRange) => void; accent?: string }) {
  const nowKey = currentMonthKey();
  const options = Array.from({ length: 37 }, (_, i) => addMonths(nowKey, -i));
  const quarters = recentQuarters(6);

  const setFrom = (from: string) => onChange({ from, to: from > value.to ? from : value.to });
  const setTo = (to: string) => onChange({ from: to < value.from ? to : value.from, to });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Quarter</p>
        <div className="flex flex-wrap gap-1.5">
          {quarters.map(q => {
            const active = value.from === q.from && value.to === q.to;
            return (
              <button
                key={q.from}
                onClick={() => onChange({ from: q.from, to: q.to })}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
                style={active ? { backgroundColor: accent } : undefined}
              >
                {q.label}{q.inProgress ? ' (so far)' : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">From month</span>
          <select value={value.from} onChange={e => setFrom(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-800">
            {options.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">To month</span>
          <select value={value.to} onChange={e => setTo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-800">
            {options.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
        </label>
        <p className="text-xs text-gray-400 pb-1.5">Pick one month for a single month, or a range such as Jul to Sep. Compared with the same months last year.</p>
      </div>
    </div>
  );
}
