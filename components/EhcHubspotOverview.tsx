'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Weekly { week: string; freeTrial: number; newPaid: number; newZero: number; other: number; total: number }
interface Overview {
  connected: boolean; error?: string; generatedAt: string;
  stages: { label: string; count: number }[];
  weekly: Weekly[];
  trialCreation: { lastFreeTrialWeek: string | null; weeksWithoutFreeTrials: number };
  dealTypes: Record<string, { current: number; previous: number }>;
  vouchers: number;
  deals30d: { total: number; sources: { source: string; label: string; count: number }[] };
  paidSubscriptions: { deals: number; subjects: { subject: string; count: number }[] };
}

const NUM = new Intl.NumberFormat('en-AU');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m! - 1]}`; };

// Validated categorical palette (colour-blind safe, 3:1 contrast on white).
const C_TRIAL = '#d97706';
const C_PAID = '#047857';
const C_ZERO = '#2563eb';

function WeeklyTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload: Weekly }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const w = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-gray-900">Week of {short(w.week)}</p>
      <p className="mt-1 text-gray-600">Free Trial <span className="font-semibold text-gray-900">{NUM.format(w.freeTrial)}</span></p>
      <p className="text-gray-600">New Deal, paid <span className="font-semibold text-gray-900">{NUM.format(w.newPaid)}</span></p>
      <p className="text-gray-600">New Deal, $0 <span className="font-semibold text-gray-900">{NUM.format(w.newZero)}</span></p>
      <p className="mt-1 border-t border-gray-100 pt-1 text-gray-600">All new deals <span className="font-semibold text-gray-900">{NUM.format(w.total)}</span></p>
    </div>
  );
}

function BarList({ rows, color }: { rows: { label: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-2 text-xs">
          <span className="truncate text-gray-600" title={r.label}>{r.label}</span>
          <span className="h-2 rounded-full bg-gray-100">
            <span className="block h-2 rounded-full" style={{ width: `${Math.max(r.count / max * 100, r.count > 0 ? 1.5 : 0)}%`, background: color }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-gray-900">{NUM.format(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function EhcHubspotOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ehc-hubspot-overview')
      .then(async res => {
        const json = await res.json() as Overview;
        if (!res.ok || !json.connected) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const trialGap = data && data.trialCreation.weeksWithoutFreeTrials >= 2 && data.trialCreation.lastFreeTrialWeek;
  const firstAfter = data && data.trialCreation.lastFreeTrialWeek
    ? data.weekly.find(w => w.week > data.trialCreation.lastFreeTrialWeek!) : undefined;
  const nd = data?.dealTypes['New Deal'];
  const ndChange = nd && nd.previous > 0 ? Math.round(((nd.current - nd.previous) / nd.previous) * 100) : null;
  const offline = data?.deals30d.sources.find(s => s.source === 'OFFLINE')?.count ?? 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">HubSpot deals — Excel HSC Copilot</p>
        <p className="mt-0.5 text-xs text-gray-500">The same figures as the HubSpot &ldquo;Excel HSC Copilot (Deals)&rdquo; dashboard, always current. Counts only, refreshed every 30 minutes.</p>
      </div>

      {loading && <div className="h-64 animate-pulse rounded-lg bg-gray-50" />}
      {!loading && error && <p className="py-8 text-center text-sm text-gray-400">Could not load HubSpot deals ({error}).</p>}

      {data && (
        <div className="space-y-5">
          {trialGap && (
            <div role="status" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
              <span aria-hidden="true" className="mt-0.5 text-amber-600">&#9888;</span>
              <p>
                <span className="font-semibold">No &ldquo;Free Trial&rdquo; deals have been created since the week of {short(data.trialCreation.lastFreeTrialWeek!)}</span>
                {' '}({data.trialCreation.weeksWithoutFreeTrials} weeks).
                {firstAfter && <> In the same week, $0 &ldquo;New Deal&rdquo; records jumped to {NUM.format(firstAfter.newZero)} a week, so free sign-ups now appear to be recorded that way.</>}
                {' '}Any HubSpot report filtered on trial stages or the Free Trial type shows &ldquo;No data&rdquo;, and so does the Trials card above. Worth confirming with whoever owns the EHC sync.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">Paid active subscriptions</p>
              <p className="text-xl font-bold text-gray-900">{NUM.format(data.paidSubscriptions.deals)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">New Deals, last 365 days</p>
              <p className="text-xl font-bold text-gray-900">{nd ? NUM.format(nd.current) : '–'}</p>
              {ndChange !== null && nd && <p className="text-[11px] text-gray-500">{ndChange >= 0 ? '+' : ''}{ndChange}% vs {NUM.format(nd.previous)} the year before</p>}
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">Deals created, last 30 days</p>
              <p className="text-xl font-bold text-gray-900">{NUM.format(data.deals30d.total)}</p>
              <p className="text-[11px] text-gray-500">{NUM.format(offline)} came from the system sync (&ldquo;Offline&rdquo; source)</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">Vouchers used (all time)</p>
              <p className="text-xl font-bold text-gray-900">{NUM.format(data.vouchers)}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-gray-700">New deals per week, by type</p>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C_TRIAL }} />Free Trial</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C_PAID }} />New Deal, paid</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C_ZERO }} />New Deal, $0</span>
            </div>
            <div role="img" aria-label="Stacked bars of new EHC deals per week by type over the last 14 weeks.">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.weekly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="week" tickFormatter={short} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis width={34} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<WeeklyTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="freeTrial" stackId="deals" fill={C_TRIAL} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="newPaid" stackId="deals" fill={C_PAID} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="newZero" stackId="deals" fill={C_ZERO} stroke="#fff" strokeWidth={1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-700">Deals by current stage (all time)</p>
              <BarList rows={data.stages} color="#64748b" />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-700">Paid active subscriptions by subject</p>
              <BarList rows={data.paidSubscriptions.subjects.slice(0, 12).map(s => ({ label: s.subject, count: s.count }))} color={C_PAID} />
              <p className="mt-2 text-[11px] text-gray-400">Active subscriptions with a payment. A subscription covering several subjects counts once per subject.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
