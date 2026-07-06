'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'opportunity' | 'info';

interface InsightAction {
  label: string;
  type:  'navigate' | 'open-chat' | 'add-spend' | 'add-campaign';
  value?: string;
}
interface Insight {
  id:       string;
  severity: Severity;
  category: string;
  title:    string;
  body:     string;
  metric?:  string;
  actions:  InsightAction[];
}
interface EmailCampaign { openRate: number; clickRate: number; sends: number; name: string; }
interface EmailData { campaigns: EmailCampaign[]; connected: boolean; avgOpenRate: number; avgClickRate: number; }
interface Band6Data { connected: boolean; revenue: number; orders: number; units: number; target: number; daysRemaining: number; }
interface SpendRecord { brand: string; channel: string; month: string; fy: string; budget: number; actualSpend: number; }

interface Props {
  onNavigate:    (tab: string) => void;
  onOpenChat:    (prompt: string) => void;
  onAddSpend:    (brand?: string) => void;
  onAddCampaign: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymToName(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  return MONTH_NAMES[(m ?? 1) - 1] ?? '';
}
function dayPct(): number {
  const now = new Date();
  return now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
function severityOrder(s: Severity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : s === 'opportunity' ? 2 : 3;
}
function severityStyle(s: Severity) {
  return {
    critical:    { border: 'border-red-200',   bg: 'bg-red-50',    icon: '🔴', headColor: 'text-red-700',   badge: 'bg-red-100 text-red-800',    btn: 'border-red-200 hover:bg-red-50' },
    warning:     { border: 'border-amber-200', bg: 'bg-amber-50',  icon: '🟡', headColor: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', btn: 'border-amber-200 hover:bg-amber-50' },
    opportunity: { border: 'border-blue-200',  bg: 'bg-blue-50',   icon: '🔵', headColor: 'text-blue-700',  badge: 'bg-blue-100 text-blue-800',   btn: 'border-blue-200 hover:bg-blue-50' },
    info:        { border: 'border-gray-200',  bg: 'bg-gray-50',   icon: 'ℹ️', headColor: 'text-gray-600',  badge: 'bg-gray-100 text-gray-700',   btn: 'border-gray-200 hover:bg-gray-100' },
  }[s];
}

// ── Rule engine ───────────────────────────────────────────────────────────────

function computeInsights(
  spendRecords: SpendRecord[],
  emailData:    EmailData | null,
  band6Data:    Band6Data | null,
): Insight[] {
  const insights: Insight[] = [];
  const ym       = currentYM();
  const monthName = ymToName(ym);
  const dp       = dayPct();

  // ── Google Ads budget pacing ──
  for (const brand of ['Pascal Press', 'Excel Test Zone'] as const) {
    const budget = MONTHLY_GOOGLE_BUDGETS[brand] ?? 0;
    if (budget <= 0) continue;
    const short  = brand === 'Pascal Press' ? 'PP' : 'ETZ';
    const record = spendRecords.find(r =>
      r.brand === brand &&
      r.channel === 'Google Ads' &&
      (r.month === monthName || r.month?.toLowerCase().startsWith(monthName.toLowerCase()))
    );
    const actual  = record?.actualSpend ?? 0;
    const spendP  = actual / budget;

    if (dp > 0.05 && actual === 0) {
      insights.push({
        id: `${short}-google-zero`,
        severity: 'warning',
        category: 'budget',
        title: `No ${short} Google Ads spend recorded for ${monthName}`,
        body: `No Google Ads spend has been logged for ${brand} this month. If campaigns are running, sync from Google Ads or add the actual spend manually.`,
        metric: `Budget: ${AUD.format(budget)}/mo · ${Math.round(dp * 100)}% of month elapsed`,
        actions: [
          { label: 'View Finance', type: 'navigate', value: 'finance' },
          { label: 'Add Spend', type: 'add-spend', value: brand },
        ],
      });
    } else if (actual > 0 && spendP > dp + 0.15) {
      const projected = actual / dp;
      insights.push({
        id: `${short}-google-over`,
        severity: 'critical',
        category: 'budget',
        title: `${short} Google Ads is overspending`,
        body: `${brand} has spent ${AUD.format(actual)} (${Math.round(spendP * 100)}% of budget) with only ${Math.round(dp * 100)}% of the month elapsed. Projected month-end spend: ~${AUD.format(Math.round(projected))}.`,
        metric: `${AUD.format(actual)} / ${AUD.format(budget)} · ${Math.round(spendP * 100)}% of budget used`,
        actions: [
          { label: 'View Finance', type: 'navigate', value: 'finance' },
          { label: 'Ask Claude', type: 'open-chat', value: `${brand} Google Ads has spent ${AUD.format(actual)} (${Math.round(spendP * 100)}%) of the ${AUD.format(budget)} monthly budget with only ${Math.round(dp * 100)}% of the month elapsed. What should we do to avoid overspending?` },
        ],
      });
    } else if (actual > 0 && spendP < dp - 0.20) {
      insights.push({
        id: `${short}-google-under`,
        severity: 'warning',
        category: 'budget',
        title: `${short} Google Ads is underpacing`,
        body: `${brand} has spent ${AUD.format(actual)} (${Math.round(spendP * 100)}%) but ${Math.round(dp * 100)}% of the month is gone. Around ${AUD.format(Math.round(budget - actual))} may go unspent.`,
        metric: `${AUD.format(actual)} / ${AUD.format(budget)} · ${Math.round(spendP * 100)}% spent`,
        actions: [
          { label: 'View Finance', type: 'navigate', value: 'finance' },
          { label: 'Ask Claude', type: 'open-chat', value: `${brand} Google Ads is underpacing — ${Math.round(spendP * 100)}% spent with ${Math.round(dp * 100)}% of the month gone. Should I increase bids, expand targeting, or reallocate the budget?` },
        ],
      });
    }
  }

  // ── Email performance ──
  if (emailData?.connected && emailData.campaigns.length > 0) {
    const avgOpen  = emailData.avgOpenRate  ?? 0;
    const avgClick = emailData.avgClickRate ?? 0;

    if (avgOpen > 0 && avgOpen < 0.15) {
      insights.push({
        id: 'email-open-critical',
        severity: 'critical',
        category: 'email',
        title: 'Email open rates critically low',
        body: `Average open rate is ${(avgOpen * 100).toFixed(1)}% — well below the 20% benchmark. Test shorter subject lines, personalisation, and different send times.`,
        metric: `${(avgOpen * 100).toFixed(1)}% avg open rate (benchmark: 20%)`,
        actions: [
          { label: 'View Email', type: 'navigate', value: 'email' },
          { label: 'Ask Claude', type: 'open-chat', value: `Our email open rate is ${(avgOpen * 100).toFixed(1)}%, well below 20%. Give me 5 specific subject line improvements for our next Pascal Press campaign targeting teachers and parents.` },
        ],
      });
    } else if (avgOpen > 0 && avgOpen < 0.20) {
      insights.push({
        id: 'email-open-warning',
        severity: 'warning',
        category: 'email',
        title: 'Email open rate below 20% benchmark',
        body: `Average open rate is ${(avgOpen * 100).toFixed(1)}%. Small tweaks to subject lines or send timing could lift this above 20%.`,
        metric: `${(avgOpen * 100).toFixed(1)}% avg open rate (benchmark: 20%)`,
        actions: [
          { label: 'View Email', type: 'navigate', value: 'email' },
          { label: 'Ask Claude', type: 'open-chat', value: `Our email open rate is ${(avgOpen * 100).toFixed(1)}%. Suggest subject line A/B test ideas for our next Pascal Press email campaign.` },
        ],
      });
    }

    if (avgClick > 0 && avgClick < 0.015) {
      insights.push({
        id: 'email-click-warning',
        severity: 'warning',
        category: 'email',
        title: 'Email click rate below 2% benchmark',
        body: `Average click rate is ${(avgClick * 100).toFixed(2)}%. Review CTA placement, button copy, and offer clarity to drive more clicks.`,
        metric: `${(avgClick * 100).toFixed(2)}% avg click rate (benchmark: 2%)`,
        actions: [
          { label: 'View Email', type: 'navigate', value: 'email' },
          { label: 'Ask Claude', type: 'open-chat', value: `Our email click rate is ${(avgClick * 100).toFixed(2)}%, below the 2% benchmark. What specific CTA, layout, and content changes would improve it for educational product emails?` },
        ],
      });
    }

    if (avgOpen >= 0.20 && avgClick >= 0.02) {
      insights.push({
        id: 'email-performing',
        severity: 'opportunity',
        category: 'email',
        title: 'Email performance above benchmark — build on it',
        body: `Open rate ${(avgOpen * 100).toFixed(1)}% and click rate ${(avgClick * 100).toFixed(2)}% are both above benchmark. Consider increasing send frequency or applying what's working to the other brand.`,
        metric: `${(avgOpen * 100).toFixed(1)}% opens · ${(avgClick * 100).toFixed(2)}% clicks`,
        actions: [
          { label: 'View Email', type: 'navigate', value: 'email' },
          { label: 'Ask Claude', type: 'open-chat', value: `Our emails are performing well with ${(avgOpen * 100).toFixed(1)}% open rate and ${(avgClick * 100).toFixed(2)}% click rate. How can we scale this success and apply it to more campaigns?` },
        ],
      });
    }
  }

  // ── Band 6 pacing ──
  if (band6Data?.connected && band6Data.target > 0) {
    const TOTAL  = 153; // July 1 → Nov 30
    const elapsed = Math.max(1, TOTAL - band6Data.daysRemaining);
    const expPct  = elapsed / TOTAL;
    const actPct  = band6Data.revenue / band6Data.target;
    const needed  = band6Data.daysRemaining > 0 ? (band6Data.target - band6Data.revenue) / band6Data.daysRemaining : 0;
    const actual  = band6Data.revenue / elapsed;

    if (actPct < expPct * 0.6 && elapsed > 7) {
      insights.push({
        id: 'band6-critical',
        severity: 'critical',
        category: 'band6',
        title: '60 Days to Band 6 significantly behind target',
        body: `${AUD.format(band6Data.revenue)} raised (${Math.round(actPct * 100)}% of ${AUD.format(band6Data.target)} goal). You need ${AUD.format(Math.round(needed))}/day vs current ${AUD.format(Math.round(actual))}/day. A targeted promotion could close the gap.`,
        metric: `${AUD.format(band6Data.revenue)} / ${AUD.format(band6Data.target)} · ${band6Data.daysRemaining} days left`,
        actions: [
          { label: 'View Overview', type: 'navigate', value: 'overview' },
          { label: 'Create Promo', type: 'open-chat', value: `60 Days to Band 6 is significantly behind target — ${AUD.format(band6Data.revenue)} raised of ${AUD.format(band6Data.target)} goal with ${band6Data.daysRemaining} days left. Design a promotional campaign for HSC students to boost sales this week.` },
        ],
      });
    } else if (actPct < expPct * 0.85 && elapsed > 7) {
      insights.push({
        id: 'band6-warning',
        severity: 'warning',
        category: 'band6',
        title: '60 Days to Band 6 slightly behind pace',
        body: `${AUD.format(band6Data.revenue)} raised (${Math.round(actPct * 100)}%). You need ${AUD.format(Math.round(needed))}/day to reach ${AUD.format(band6Data.target)} by November.`,
        metric: `${AUD.format(band6Data.revenue)} / ${AUD.format(band6Data.target)} · ${band6Data.daysRemaining} days left`,
        actions: [
          { label: 'View Overview', type: 'navigate', value: 'overview' },
          { label: 'Ask Claude', type: 'open-chat', value: `60 Days to Band 6 is slightly behind pace — ${AUD.format(band6Data.revenue)} of ${AUD.format(band6Data.target)} goal with ${band6Data.daysRemaining} days left. What marketing tactics would you recommend to accelerate sales?` },
        ],
      });
    } else if (actPct > expPct * 1.2 && elapsed > 3) {
      insights.push({
        id: 'band6-opportunity',
        severity: 'opportunity',
        category: 'band6',
        title: '60 Days to Band 6 ahead of target',
        body: `${AUD.format(band6Data.revenue)} raised at ${AUD.format(Math.round(actual))}/day — ahead of the ${AUD.format(Math.round(needed))}/day needed for ${AUD.format(band6Data.target)} by November.`,
        metric: `${AUD.format(band6Data.revenue)} / ${AUD.format(band6Data.target)} · ${Math.round(actPct * 100)}% of goal`,
        actions: [
          { label: 'View Overview', type: 'navigate', value: 'overview' },
          { label: 'Scale Up?', type: 'open-chat', value: `60 Days to Band 6 is ahead of target at ${AUD.format(band6Data.revenue)}. Should we increase ad spend or run a bundle promotion to maximise revenue before the November deadline?` },
        ],
      });
    } else if (elapsed <= 7) {
      insights.push({
        id: 'band6-early',
        severity: 'info',
        category: 'band6',
        title: '60 Days to Band 6 — early days',
        body: `${AUD.format(band6Data.revenue)} raised across ${band6Data.orders} order${band6Data.orders !== 1 ? 's' : ''} so far. Check back in a week for a reliable pacing assessment.`,
        metric: `${AUD.format(band6Data.revenue)} / ${AUD.format(band6Data.target)} · ${band6Data.daysRemaining} days left`,
        actions: [
          { label: 'View Overview', type: 'navigate', value: 'overview' },
        ],
      });
    }
  }

  return insights;
}

// ── Insight card ──────────────────────────────────────────────────────────────

function InsightCard({
  insight,
  onAction,
  onDismiss,
}: {
  insight:   Insight;
  onAction:  (a: InsightAction) => void;
  onDismiss: (id: string) => void;
}) {
  const s = severityStyle(insight.severity);
  return (
    <div className={`relative rounded-xl border ${s.border} ${s.bg} p-4 shadow-sm`}>
      <button
        onClick={() => onDismiss(insight.id)}
        className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 text-xl leading-none"
        title="Dismiss"
      >×</button>
      <div className="flex items-start gap-3 pr-7">
        <span className="text-base leading-none mt-0.5 shrink-0">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-sm ${s.headColor}`}>{insight.title}</h3>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{insight.body}</p>
          {insight.metric && (
            <span className={`inline-block mt-2 text-xs font-medium px-2.5 py-0.5 rounded-full ${s.badge}`}>
              {insight.metric}
            </span>
          )}
          {insight.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {insight.actions.map(action => (
                <button
                  key={action.label}
                  onClick={() => onAction(action)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border bg-white transition-colors text-gray-700 ${s.btn}`}
                >
                  {action.type === 'open-chat' ? '✨ ' : ''}{action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ActionCentreTab({ onNavigate, onOpenChat, onAddSpend, onAddCampaign }: Props) {
  const [spendRecords, setSpendRecords] = useState<SpendRecord[]>([]);
  const [emailData,    setEmailData]    = useState<EmailData | null>(null);
  const [band6Data,    setBand6Data]    = useState<Band6Data | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [aiInsights,   setAiInsights]   = useState<Insight[] | null>(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiError,      setAiError]      = useState('');
  const [dismissed,    setDismissed]    = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ac-dismissed') ?? '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    const ym = currentYM();
    Promise.all([
      fetch('/api/spend').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/hubspot-email?month=${ym}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/band6-tracker').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([spend, email, band6]) => {
      setSpendRecords(Array.isArray(spend) ? spend : []);
      setEmailData(email);
      setBand6Data(band6);
    }).finally(() => setLoading(false));
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem('ac-dismissed', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const handleAction = useCallback((action: InsightAction) => {
    if (action.type === 'navigate')    onNavigate(action.value ?? 'overview');
    if (action.type === 'open-chat')   onOpenChat(action.value ?? '');
    if (action.type === 'add-spend')   onAddSpend(action.value);
    if (action.type === 'add-campaign') onAddCampaign();
  }, [onNavigate, onOpenChat, onAddSpend, onAddCampaign]);

  const loadAiInsights = async () => {
    setAiLoading(true); setAiError('');
    try {
      const ym = currentYM();
      const metrics = {
        month:   ym,
        dayPct:  Math.round(dayPct() * 100),
        email:   emailData ? {
          campaigns:    emailData.campaigns.length,
          avgOpenRate:  Math.round((emailData.avgOpenRate ?? 0) * 1000) / 10,
          avgClickRate: Math.round((emailData.avgClickRate ?? 0) * 1000) / 10,
          connected:    emailData.connected,
        } : null,
        band6: band6Data ? {
          revenue:      band6Data.revenue,
          target:       band6Data.target,
          orders:       band6Data.orders,
          units:        band6Data.units,
          daysRemaining: band6Data.daysRemaining,
          percentToGoal: Math.round((band6Data.revenue / band6Data.target) * 100),
        } : null,
        googleAds: {
          ppBudget:  MONTHLY_GOOGLE_BUDGETS['Pascal Press'],
          etzBudget: MONTHLY_GOOGLE_BUDGETS['Excel Test Zone'],
          ppActual:  spendRecords.find(r => r.brand === 'Pascal Press'  && r.channel === 'Google Ads')?.actualSpend ?? 0,
          etzActual: spendRecords.find(r => r.brand === 'Excel Test Zone' && r.channel === 'Google Ads')?.actualSpend ?? 0,
        },
      };
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics }),
      });
      if (!res.ok) throw new Error('Claude insights API failed');
      const data = await res.json();
      setAiInsights(Array.isArray(data.insights) ? data.insights : []);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Failed to load AI insights');
    } finally { setAiLoading(false); }
  };

  const ruleInsights = useMemo(
    () => computeInsights(spendRecords, emailData, band6Data),
    [spendRecords, emailData, band6Data],
  );

  const allInsights = [...ruleInsights, ...(aiInsights ?? [])]
    .filter(i => !dismissed.has(i.id))
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  const byGroup = {
    critical:    allInsights.filter(i => i.severity === 'critical'),
    warning:     allInsights.filter(i => i.severity === 'warning'),
    opportunity: allInsights.filter(i => i.severity === 'opportunity'),
    info:        allInsights.filter(i => i.severity === 'info'),
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Analysing your marketing data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4 md:py-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Action Centre</h2>
          <p className="text-sm text-gray-500">
            {allInsights.length === 0
              ? 'All clear — no issues detected'
              : `${allInsights.length} item${allInsights.length !== 1 ? 's' : ''} need${allInsights.length === 1 ? 's' : ''} attention`}
            {dismissed.size > 0 && <span className="text-gray-400"> · {dismissed.size} dismissed</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {dismissed.size > 0 && (
            <button
              onClick={() => { setDismissed(new Set()); try { localStorage.removeItem('ac-dismissed'); } catch {} }}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-200 rounded-lg bg-white"
            >
              Restore {dismissed.size} dismissed
            </button>
          )}
          <button
            onClick={loadAiInsights}
            disabled={aiLoading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {aiLoading
              ? <><span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin inline-block mr-1" />Analysing…</>
              : <>✨ {aiInsights ? 'Refresh' : 'Get'} AI Insights</>}
          </button>
        </div>
      </div>

      {aiError && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{aiError}</div>
      )}

      {allInsights.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">✅</div>
          <h3 className="font-semibold text-gray-700 mb-1">All clear — no issues detected</h3>
          <p className="text-sm text-gray-400 mb-6">Click "Get AI Insights" for strategic recommendations from Claude.</p>
          <button
            onClick={loadAiInsights}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            ✨ Get AI Insights
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {byGroup.critical.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3">🔴 Critical — Action Required</h3>
              <div className="space-y-3">{byGroup.critical.map(i => <InsightCard key={i.id} insight={i} onAction={handleAction} onDismiss={dismiss} />)}</div>
            </section>
          )}
          {byGroup.warning.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3">🟡 Warnings — Review Soon</h3>
              <div className="space-y-3">{byGroup.warning.map(i => <InsightCard key={i.id} insight={i} onAction={handleAction} onDismiss={dismiss} />)}</div>
            </section>
          )}
          {byGroup.opportunity.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">🔵 Opportunities</h3>
              <div className="space-y-3">{byGroup.opportunity.map(i => <InsightCard key={i.id} insight={i} onAction={handleAction} onDismiss={dismiss} />)}</div>
            </section>
          )}
          {byGroup.info.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ℹ️ Info</h3>
              <div className="space-y-3">{byGroup.info.map(i => <InsightCard key={i.id} insight={i} onAction={handleAction} onDismiss={dismiss} />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
