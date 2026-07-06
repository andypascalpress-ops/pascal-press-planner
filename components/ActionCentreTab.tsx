'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Insight {
  id:         string;
  severity:   'critical' | 'warning' | 'opportunity' | 'info';
  category:   'google-ads' | 'email' | 'bigcommerce' | 'band6' | 'seasonal' | 'budget';
  title:      string;
  body:       string;
  metric:     string;
  chatPrompt: string;
  action?:    string;
}

interface Props {
  onNavigate:    (tab: string) => void;
  onOpenChat:    (prompt: string) => void;
  onAddSpend:    (brand?: string) => void;
  onAddCampaign: () => void;
}

type Status = 'idle' | 'fetching' | 'analysing' | 'ready' | 'error';

// ─── Constants ────────────────────────────────────────────────────────────────

const PP_BUDGET  = 8300;
const ETZ_BUDGET = 3700;

const CAT_LABELS: Record<string, string> = {
  'google-ads': 'Google Ads', email: 'Email',
  bigcommerce: 'BigCommerce', band6: 'Band 6',
  seasonal: 'Seasonal', budget: 'Budget',
};

const SEV: Record<string, { left: string; badge: string; dot: string }> = {
  critical:    { left: 'border-l-red-500',   badge: 'bg-red-50 text-red-700 border-red-200',     dot: 'bg-red-500'   },
  warning:     { left: 'border-l-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200',dot: 'bg-amber-400' },
  opportunity: { left: 'border-l-blue-500',   badge: 'bg-blue-50 text-blue-700 border-blue-200',  dot: 'bg-blue-500'  },
  info:        { left: 'border-l-gray-300',   badge: 'bg-gray-50 text-gray-600 border-gray-200',  dot: 'bg-gray-400'  },
};

// ─── Rule-based fallback insights (always run client-side) ────────────────────

function computeBaselineInsights(
  spendData: any,
  emailData: any,
  band6Data: any,
): Insight[] {
  const now = new Date();
  const month = now.getMonth(); // 0-based; 6=July
  const dayOfMonth   = now.getDate();
  const daysInMonth  = new Date(now.getFullYear(), month + 1, 0).getDate();
  const pctThrough   = (dayOfMonth / daysInMonth) * 100;
  const insights: Insight[] = [];

  // ── Google Ads budget pacing from spend records ──────────────────────────
  const records: any[] = Array.isArray(spendData) ? spendData : [];
  const monthName = now.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' });
  const monthRecords = records.filter(
    r => (r.month ?? '').toLowerCase() === monthName.toLowerCase(),
  );

  const adsByBrand: Record<string, { actual: number; budget: number; revenue: number }> = {};
  for (const r of monthRecords) {
    if (!(r.channel ?? '').toLowerCase().includes('google')) continue;
    const b = r.brand ?? 'Unknown';
    if (!adsByBrand[b]) adsByBrand[b] = { actual: 0, budget: 0, revenue: 0 };
    adsByBrand[b].actual  += Number(r.actualSpend       ?? 0);
    adsByBrand[b].budget  += Number(r.budget            ?? 0);
    adsByBrand[b].revenue += Number(r.attributedRevenue ?? 0);
  }

  // Fallback to constants when Monday records are missing
  if (!adsByBrand['Pascal Press'])
    adsByBrand['Pascal Press'] = { actual: 0, budget: PP_BUDGET, revenue: 0 };
  if (!adsByBrand['Excel Test Zone'])
    adsByBrand['Excel Test Zone'] = { actual: 0, budget: ETZ_BUDGET, revenue: 0 };

  for (const [brand, s] of Object.entries(adsByBrand)) {
    if (!s.budget) continue;
    const expected = (pctThrough / 100) * s.budget;
    const diff = s.actual - expected;
    const pacing = Math.round((s.actual / s.budget) * 100);
    const roas = s.actual > 0 ? (s.revenue / s.actual).toFixed(1) : '—';
    const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

    if (s.actual === 0 && pctThrough > 5) {
      insights.push({
        id: `spend-zero-${brand.replace(/\s/g, '-').toLowerCase()}`,
        severity:   'critical',
        category:   'google-ads',
        title:      `${brand} Google Ads: no spend recorded for ${monthName}`,
        body:       `${monthName} spend shows $0 against a ${fmt(s.budget)} budget, with ${Math.round(pctThrough)}% of the month elapsed. Either no campaigns are running or spend records haven't been entered yet. Log today's spend or check Google Ads is active.`,
        metric:     `$0 of ${fmt(s.budget)} · Day ${dayOfMonth}/${daysInMonth}`,
        chatPrompt: `${brand} Google Ads shows zero spend for ${monthName} against a ${fmt(s.budget)} budget. We're on day ${dayOfMonth} of ${daysInMonth}. What campaigns should be running right now and what's the fastest way to get back on pace?`,
        action:     'Enter spend or check Ads',
      });
    } else if (diff < -300) {
      insights.push({
        id: `spend-under-${brand.replace(/\s/g, '-').toLowerCase()}`,
        severity:   'warning',
        category:   'google-ads',
        title:      `${brand} Google Ads underpacing — ${fmt(Math.abs(diff))} behind`,
        body:       `With ${Math.round(pctThrough)}% of ${monthName} elapsed, ${brand} has spent ${fmt(s.actual)} (${pacing}% of budget). Expected spend at this point: ${fmt(expected)}. Underspending now means wasted budget allocation for Term 3.`,
        metric:     `${pacing}% paced · ${fmt(Math.abs(diff))} under`,
        chatPrompt: `${brand} Google Ads is ${fmt(Math.abs(diff))} behind expected pacing in ${monthName} (spent ${fmt(s.actual)} vs expected ${fmt(expected)}). What's the best way to increase spend velocity this week without inflating CPC?`,
        action:     'Increase daily budget',
      });
    } else if (diff > 500) {
      insights.push({
        id: `spend-over-${brand.replace(/\s/g, '-').toLowerCase()}`,
        severity:   'warning',
        category:   'google-ads',
        title:      `${brand} Google Ads overpacing — ${fmt(diff)} above budget`,
        body:       `${brand} has spent ${fmt(s.actual)} (${pacing}% of budget) with only ${Math.round(pctThrough)}% of ${monthName} elapsed. At this rate the monthly budget will be exhausted early. Review campaign bids and daily caps.`,
        metric:     `${pacing}% paced · ROAS ${roas}`,
        chatPrompt: `${brand} Google Ads has overspent — ${pacing}% of budget used with only ${Math.round(pctThrough)}% of the month gone. How should I reduce daily caps or adjust bids to stay within the ${fmt(s.budget)} monthly budget without pausing campaigns?`,
        action:     'Review daily caps',
      });
    }
  }

  // ── Term 3 seasonal insights (July–September) ────────────────────────────
  if (month === 6) { // July
    insights.push({
      id: 'seasonal-term3-start',
      severity:   'opportunity',
      category:   'seasonal',
      title:      'Term 3 starts this month — peak season for NAPLAN & HSC',
      body:       `July marks the start of Term 3 in most Australian states. This is the highest-value period for Pascal Press (NAPLAN prep workbooks) and Excel Test Zone (HSC practice exams). Campaigns should be fully live and budgets maximised by mid-July.`,
      metric:     'Term 3 · July–September',
      chatPrompt: 'It\'s early July and Term 3 is starting. What specific Google Ads campaigns, keywords, and ad copy should Pascal Press and Excel Test Zone be running right now to maximise NAPLAN prep and HSC prep sales?',
      action:     'Plan Term 3 campaigns',
    });
  }
  if (month === 7) { // August — HSC trial exams
    insights.push({
      id: 'seasonal-hsc-trials',
      severity:   'opportunity',
      category:   'seasonal',
      title:      'August: HSC Trial Exams — peak ETZ revenue window',
      body:       `August is when HSC students sit trial exams, making it the strongest month for Excel Test Zone online practice papers. ETZ bids and budgets should be at their highest now. Consider remarketing to students who visited but didn't purchase.`,
      metric:     'HSC Trial season · Aug peak',
      chatPrompt: 'It\'s August — HSC trial exams are happening now. What should Excel Test Zone\'s Google Ads strategy look like this week? Which keywords, bidding strategies, and ad extensions maximise conversions for practice papers?',
      action:     'Maximise ETZ budget',
    });
  }
  if (month === 8) { // September — Back to School prep
    insights.push({
      id: 'seasonal-bts-prep',
      severity:   'opportunity',
      category:   'seasonal',
      title:      'Plan Term 4 / Back to School campaigns now',
      body:       `September is when successful publishers start planning Term 4 and Back to School campaigns (launching November–January). Begin building campaign structures and creative assets for Pascal Press Back to School workbook promotions.`,
      metric:     'BTS prep · Oct–Jan window',
      chatPrompt: 'It\'s September and we should be planning Back to School campaigns for Pascal Press. What campaign types, timings, and budgets should we prepare for the October–January Back to School season?',
      action:     'Build BTS campaign plan',
    });
  }

  // ── Email performance ────────────────────────────────────────────────────
  const emailCampaigns: any[] = emailData?.campaigns ?? emailData?.emails ?? [];
  const lowOpenEmails = emailCampaigns.filter((e: any) => {
    const rate = e.openRate ?? e.open_rate ?? 0;
    return typeof rate === 'number' && rate < 20 && (e.sends ?? e.recipients ?? 0) > 100;
  });

  if (lowOpenEmails.length > 0) {
    const worst = lowOpenEmails[0];
    const name  = worst.name ?? worst.subject ?? 'recent campaign';
    const rate  = (worst.openRate ?? worst.open_rate ?? 0).toFixed(1);
    insights.push({
      id: 'email-low-open',
      severity:   'warning',
      category:   'email',
      title:      `"${name}" open rate ${rate}% — below 20% benchmark`,
      body:       `This email campaign has a ${rate}% open rate, below the 20% educational publisher benchmark. Subject line, send time, and list segmentation are the three highest-leverage fixes. Test a curiosity or urgency-led subject line for the next send.`,
      metric:     `Open ${rate}% · ${worst.sends ?? worst.recipients ?? '?'} sent`,
      chatPrompt: `Our email campaign "${name}" has a ${rate}% open rate. What subject line approaches work best for K-12 educational products? Give me 5 alternative subject line ideas and explain why each one might lift open rates.`,
      action:     'Rewrite subject line',
    });
  }

  if (emailCampaigns.length === 0) {
    insights.push({
      id: 'email-no-campaigns',
      severity:   'info',
      category:   'email',
      title:      'No email campaigns detected this month',
      body:       `No HubSpot email campaigns were found for this month. For Term 3, Pascal Press should send at least 2–3 campaigns targeting NAPLAN prep, and ETZ should send HSC trial exam reminders to their student list.`,
      metric:     '0 campaigns this month',
      chatPrompt: 'What email campaigns should Pascal Press and Excel Test Zone be sending in Term 3 (July-September)? Give me a campaign calendar with subject lines, audience segments, and send timing for each.',
      action:     'Plan email calendar',
    });
  }

  // ── Band 6 tracking ──────────────────────────────────────────────────────
  const b6 = band6Data?.summary ?? band6Data ?? {};
  const b6Target  = Number(b6.target  ?? b6.monthlyTarget  ?? 0);
  const b6Actual  = Number(b6.actual  ?? b6.currentRevenue ?? 0);
  if (b6Target > 0 && b6Actual < b6Target * 0.5 && pctThrough > 40) {
    const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
    insights.push({
      id: 'band6-pacing-low',
      severity:   'warning',
      category:   'band6',
      title:      `Band 6 tracker: ${Math.round((b6Actual / b6Target) * 100)}% of target with month ${Math.round(pctThrough)}% done`,
      body:       `Band 6 revenue is at ${fmt(b6Actual)} against a ${fmt(b6Target)} target. At the current pace, the month-end target will be missed. Review which ETZ products are driving Band 6 conversions and increase their ad exposure.`,
      metric:     `${fmt(b6Actual)} of ${fmt(b6Target)} target`,
      chatPrompt: `Band 6 tracker is showing ${fmt(b6Actual)} of ${fmt(b6Target)} target with ${Math.round(pctThrough)}% of the month elapsed. What actions should we take this week to improve Band 6 conversion rates for Excel Test Zone?`,
      action:     'Review Band 6 products',
    });
  }

  return insights;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="bg-white rounded-xl border border-l-4 border-gray-200 border-l-gray-200 p-4 space-y-3 animate-pulse"
      style={{ animationDelay: `${index * 120}ms` }}>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-gray-200 rounded-full" />
          <div className="h-5 w-20 bg-gray-200 rounded-full" />
        </div>
        <div className="h-4 w-4 bg-gray-200 rounded" />
      </div>
      <div className="h-4 w-3/4 bg-gray-200 rounded" />
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-5/6 bg-gray-100 rounded" />
        <div className="h-3 w-2/3 bg-gray-100 rounded" />
      </div>
      <div className="flex gap-2 pt-1">
        <div className="h-7 w-28 bg-gray-200 rounded-lg" />
        <div className="h-7 w-24 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

function InsightCard({ insight, rank, onDismiss, onOpenChat }: {
  insight: Insight; rank: number;
  onDismiss: (id: string) => void;
  onOpenChat: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const s   = SEV[insight.severity] ?? SEV.info;
  const cat = CAT_LABELS[insight.category] ?? insight.category;

  return (
    <div className={`bg-white rounded-xl border border-l-4 ${s.left} border-gray-200 p-4`}>
      <div className="flex items-start gap-2 mb-2">
        <span className="text-gray-400 font-mono text-xs font-medium mt-0.5 shrink-0">#{rank}</span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>
            {insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1)}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
            {cat}
          </span>
        </div>
        <button onClick={() => onDismiss(insight.id)}
          className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0 -mt-0.5">×</button>
      </div>
      <h4 className="text-sm font-semibold text-gray-800 mb-2 leading-snug">{insight.title}</h4>
      {insight.metric && (
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1 mb-2">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
          {insight.metric}
        </div>
      )}
      <p className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {insight.body}
      </p>
      {insight.body.length > 180 && (
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-blue-500 hover:text-blue-700 mt-1">
          {expanded ? 'Show less ↑' : 'Read more ↓'}
        </button>
      )}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => onOpenChat(insight.chatPrompt)}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors">
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h2v3l3-3h7a1 1 0 001-1V3a1 1 0 00-1-1z"/>
          </svg>
          Ask Claude
        </button>
        {insight.action && (
          <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1.5 rounded-lg">
            {insight.action}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHead({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">{label}</h3>
      <span className="text-xs text-gray-400 font-medium">({count})</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActionCentreTab({ onNavigate, onOpenChat, onAddSpend, onAddCampaign }: Props) {
  const [status,      setStatus]      = useState<Status>('idle');
  const [insights,    setInsights]    = useState<Insight[]>([]);
  const [dismissed,   setDismissed]   = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ac-dismissed-v2') : null;
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [sources,     setSources]     = useState<Record<string, boolean>>({});
  const [aiLabel,     setAiLabel]     = useState('');

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('ac-dismissed-v2', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const restoreDismissed = useCallback(() => {
    setDismissed(new Set());
    try { localStorage.removeItem('ac-dismissed-v2'); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    setStatus('fetching');
    setInsights([]);
    setErrorMsg('');
    setAiLabel('');

    const month = currentMonthStr();

    const results = await Promise.allSettled([
      fetch('/api/spend').then(r => r.json()),
      fetch('/api/google-ads-campaigns').then(r => r.json()),
      fetch(`/api/hubspot-email?month=${month}`).then(r => r.json()),
      fetch('/api/band6-tracker').then(r => r.json()),
      fetch('/api/bc-performance').then(r => r.json()),
    ]);

    const [spendR, campaignsR, emailR, band6R, bcR] = results;
    const spendRes     = spendR.status     === 'fulfilled' ? spendR.value     : [];
    const campaignsRes = campaignsR.status === 'fulfilled' ? campaignsR.value : {};
    const emailRes     = emailR.status     === 'fulfilled' ? emailR.value     : {};
    const band6Res     = band6R.status     === 'fulfilled' ? band6R.value     : {};
    const bcRes        = bcR.status        === 'fulfilled' ? bcR.value        : {};

    const srcStatus = {
      'Spend':       spendR.status     === 'fulfilled' && !spendRes?.error,
      'Google Ads':  campaignsR.status === 'fulfilled' && !campaignsRes?.error,
      'Email':       emailR.status     === 'fulfilled' && !emailRes?.error,
      'Band 6':      band6R.status     === 'fulfilled' && !band6Res?.error,
      'BigCommerce': bcR.status        === 'fulfilled' && !bcRes?.error,
    };
    setSources(srcStatus);

    // ── Step 1: compute baseline rule-based insights immediately ─────────────
    const baseline = computeBaselineInsights(spendRes, emailRes, band6Res);
    setInsights(baseline);
    setStatus('analysing');

    // ── Step 2: call Claude for deeper AI insights ────────────────────────────
    try {
      const insightRes = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: { campaigns: campaignsRes, email: emailRes, band6: band6Res, spend: spendRes, bc: bcRes, sources: srcStatus },
        }),
      });

      if (insightRes.ok) {
        const { insights: aiRaw } = await insightRes.json();
        if (Array.isArray(aiRaw) && aiRaw.length > 0) {
          // Merge: AI insights first (they're richer), then any baseline items
          // whose ID isn't duplicated by an AI insight in the same category
          const aiCategories = new Set(aiRaw.map((i: Insight) => i.category));
          const dedupedBaseline = baseline.filter(b =>
            !aiCategories.has(b.category) ||
            b.id.startsWith('seasonal-') ||
            b.id.startsWith('band6-')
          );
          setInsights([...aiRaw, ...dedupedBaseline]);
          setAiLabel('AI-enhanced');
        } else {
          setAiLabel('Rule-based');
        }
      } else {
        setAiLabel('Rule-based');
      }
    } catch {
      setAiLabel('Rule-based');
    }

    setStatus('ready');
    setLastUpdated(new Date());
  }, []);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible      = insights.filter(i => !dismissed.has(i.id));
  const critical     = visible.filter(i => i.severity === 'critical' || i.severity === 'warning');
  const opps         = visible.filter(i => i.severity === 'opportunity');
  const infoItems    = visible.filter(i => i.severity === 'info');
  const isLoading    = status === 'fetching' || status === 'analysing';
  const dismissedCnt = [...dismissed].filter(id => insights.some(i => i.id === id)).length;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-orange-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
              Marketing Intelligence
              {aiLabel && (
                <span className="ml-1 text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                  {aiLabel}
                </span>
              )}
            </h2>
            {status === 'ready' && lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5">
                {fmtDate(lastUpdated)} · {fmtTime(lastUpdated)}
                {visible.length > 0 && (
                  <span className="ml-1.5">{visible.length} item{visible.length !== 1 ? 's' : ''}</span>
                )}
              </p>
            )}
            {isLoading && (
              <p className="text-xs text-blue-500 mt-0.5 animate-pulse">
                {status === 'fetching' ? 'Loading data…' : insights.length > 0 ? 'Claude is enhancing insights…' : 'Analysing…'}
              </p>
            )}
            {/* Source status pills */}
            {Object.keys(sources).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {Object.entries(sources).map(([name, ok]) => (
                  <span key={name}
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                    {ok ? '✓' : '✗'} {name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={refresh} disabled={isLoading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-6">

        {/* Loading skeletons — only shown before baseline insights are ready */}
        {isLoading && insights.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Loading campaign data…
              </span>
            </div>
            {[0, 1, 2].map(i => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* AI enhancing banner — shown while Claude runs after baseline is ready */}
        {status === 'analysing' && insights.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Claude is analysing your campaigns for deeper insights…
          </div>
        )}

        {/* Priority Actions */}
        {critical.length > 0 && (
          <section>
            <SectionHead count={critical.length} label="Priority Actions"
              icon={<svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>}
            />
            <div className="space-y-3">
              {critical.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* Opportunities */}
        {opps.length > 0 && (
          <section>
            <SectionHead count={opps.length} label="Opportunities"
              icon={<svg className="w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.298.082-.58.195-.844a3 3 0 10-4.39 0c.113.263.18.546.195.844h4z"/>
              </svg>}
            />
            <div className="space-y-3">
              {opps.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* Performance Notes */}
        {infoItems.length > 0 && (
          <section>
            <SectionHead count={infoItems.length} label="Performance Notes"
              icon={<svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
              </svg>}
            />
            <div className="space-y-3">
              {infoItems.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* Restore dismissed */}
        {dismissedCnt > 0 && (status === 'ready' || status === 'analysing') && (
          <div className="text-center py-1">
            <button onClick={restoreDismissed}
              className="text-xs text-gray-400 hover:text-gray-600 underline">
              Restore {dismissedCnt} dismissed item{dismissedCnt !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Quick Actions */}
        {(status === 'ready' || status === 'analysing') && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onOpenChat('Give me a detailed Google Ads performance breakdown for Pascal Press and Excel Test Zone this month. List each campaign by name with ROAS, CTR, and cost. Tell me which campaigns to pause, scale, or restructure, and why.')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-2.5 transition-colors">
                <div className="font-semibold text-gray-700 mb-0.5">🎯 Google Ads Breakdown</div>
                <div className="text-gray-500">Campaign-by-campaign ROAS</div>
              </button>
              <button onClick={() => onOpenChat('Analyse our HubSpot email campaigns from this month. Which subject lines worked best? Which audience segments have the highest open rate? Give me 3 concrete changes to improve open rates and click-through rates.')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-2.5 transition-colors">
                <div className="font-semibold text-gray-700 mb-0.5">📧 Email Deep Dive</div>
                <div className="text-gray-500">Subject lines + segments</div>
              </button>
              <button onClick={() => onOpenChat('Based on our BigCommerce sales data and current Term 3 period, which products should we be prioritising in Google Ads? Are there any product bundles, promotions, or ad campaigns I should create? Which products are underperforming and why?')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-2.5 transition-colors">
                <div className="font-semibold text-gray-700 mb-0.5">🛒 Product Intelligence</div>
                <div className="text-gray-500">What to push in ads</div>
              </button>
              <button onClick={() => onNavigate('calendar')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-2.5 transition-colors">
                <div className="font-semibold text-gray-700 mb-0.5">📅 Campaign Calendar</div>
                <div className="text-gray-500">View & plan campaigns</div>
              </button>
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
