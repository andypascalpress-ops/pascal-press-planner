'use client';

import { useState, useEffect, useCallback } from 'react';
import ProductsSubTab from './ProductsSubTab';
import AbandonedCartsSubTab from './AbandonedCartsSubTab';

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
type SubTab = 'actions' | 'products' | 'carts';

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
  campaignsData: any,
  bcData: any,
): Insight[] {
  const now = new Date();
  const month = now.getMonth(); // 0-based; 6=July
  const dayOfMonth   = now.getDate();
  const daysInMonth  = new Date(now.getFullYear(), month + 1, 0).getDate();
  const pctThrough   = (dayOfMonth / daysInMonth) * 100;
  const insights: Insight[] = [];
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
  const pctStr = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

  // ── Google Ads: budget pacing ─────────────────────────────────────────────
  const records: any[] = Array.isArray(spendData) ? spendData : [];
  const monthName = now.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' });
  const monthRecords = records.filter(r => (r.month ?? '').toLowerCase() === monthName.toLowerCase());

  const adsByBrand: Record<string, { actual: number; budget: number; revenue: number }> = {};
  for (const r of monthRecords) {
    if (!(r.channel ?? '').toLowerCase().includes('google')) continue;
    const b = r.brand ?? 'Unknown';
    if (!adsByBrand[b]) adsByBrand[b] = { actual: 0, budget: 0, revenue: 0 };
    adsByBrand[b].actual  += Number(r.actualSpend       ?? 0);
    adsByBrand[b].budget  += Number(r.budget            ?? 0);
    adsByBrand[b].revenue += Number(r.attributedRevenue ?? 0);
  }
  if (!adsByBrand['Pascal Press'])    adsByBrand['Pascal Press']    = { actual: 0, budget: PP_BUDGET,  revenue: 0 };
  if (!adsByBrand['Excel Test Zone']) adsByBrand['Excel Test Zone'] = { actual: 0, budget: ETZ_BUDGET, revenue: 0 };

  for (const [brand, s] of Object.entries(adsByBrand)) {
    if (!s.budget) continue;
    const expected = (pctThrough / 100) * s.budget;
    const diff     = s.actual - expected;
    const pacing   = Math.round((s.actual / s.budget) * 100);
    const roas     = s.actual > 0 ? (s.revenue / s.actual).toFixed(1) : '—';

    if (diff < -300 && s.actual > 0) {
      insights.push({
        id: `spend-under-${brand.replace(/\s/g, '-').toLowerCase()}`,
        severity: 'warning', category: 'google-ads',
        title:   `${brand} Google Ads underpacing — ${fmt(Math.abs(diff))} behind`,
        body:    `With ${Math.round(pctThrough)}% of ${monthName} elapsed, ${brand} has spent ${fmt(s.actual)} (${pacing}% of budget). Expected: ${fmt(expected)}. Increase daily budgets or add new ad groups to recover spend.`,
        metric:  `${pacing}% paced · ${fmt(Math.abs(diff))} under · ROAS ${roas}`,
        chatPrompt: `${brand} Google Ads is ${fmt(Math.abs(diff))} behind expected pacing (spent ${fmt(s.actual)} vs expected ${fmt(expected)}). What's the best way to increase spend velocity this week without inflating CPC?`,
        action:  'Increase daily budget',
      });
    } else if (diff > 500) {
      insights.push({
        id: `spend-over-${brand.replace(/\s/g, '-').toLowerCase()}`,
        severity: 'warning', category: 'google-ads',
        title:   `${brand} Google Ads overpacing — ${fmt(diff)} above budget`,
        body:    `${brand} has spent ${fmt(s.actual)} (${pacing}% of budget) with only ${Math.round(pctThrough)}% of ${monthName} elapsed. At this rate the monthly budget will be exhausted early.`,
        metric:  `${pacing}% paced · ROAS ${roas}`,
        chatPrompt: `${brand} Google Ads has overspent — ${pacing}% of budget used with only ${Math.round(pctThrough)}% of the month gone. How do I reduce daily caps or adjust bids to stay within the ${fmt(s.budget)} monthly budget without pausing campaigns?`,
        action:  'Review daily caps',
      });
    }
  }

  // ── Google Ads: campaign-level issues ─────────────────────────────────────
  const allCamps: any[] = [
    ...(campaignsData?.pp?.campaigns  ?? []).map((c: any) => ({ ...c, brand: 'Pascal Press' })),
    ...(campaignsData?.etz?.campaigns ?? []).map((c: any) => ({ ...c, brand: 'Excel Test Zone' })),
  ];

  // Zero conversions with meaningful spend
  for (const c of allCamps.filter(c => (c.conversions ?? 0) === 0 && (c.cost ?? 0) > 150).slice(0, 2)) {
    const shortName = (c.name ?? 'Unknown').slice(0, 50);
    insights.push({
      id: `ads-zero-conv-${(c.name ?? '').replace(/\W/g, '-').toLowerCase().slice(0, 24)}`,
      severity: 'warning', category: 'google-ads',
      title:   `"${shortName}" — ${fmt(c.cost)} spent, 0 conversions`,
      body:    `This campaign has spent ${fmt(c.cost)} this month with zero conversions. Check the landing page, keyword match types, and bid strategy. Consider pausing until fixed or restructuring ad groups.`,
      metric:  `${fmt(c.cost)} spend · 0 conv · CTR ${pctStr((c.ctr ?? 0) * 100)}`,
      chatPrompt: `Our Google Ads campaign "${c.name}" (${c.brand}) spent ${fmt(c.cost)} with 0 conversions this month. CTR is ${pctStr((c.ctr ?? 0) * 100)}. What are the most likely causes — is it a landing page, keyword, or bid issue?`,
      action:  'Audit keywords + landing page',
    });
  }

  // Low ROAS (below 2× with meaningful spend)
  for (const c of allCamps.filter(c => (c.cost ?? 0) > 300 && (c.roas ?? 0) > 0 && (c.roas ?? 0) < 2).slice(0, 2)) {
    const shortName = (c.name ?? 'Unknown').slice(0, 50);
    insights.push({
      id: `ads-low-roas-${(c.name ?? '').replace(/\W/g, '-').toLowerCase().slice(0, 24)}`,
      severity: 'warning', category: 'google-ads',
      title:   `"${shortName}" — low ROAS ${(c.roas ?? 0).toFixed(1)}×`,
      body:    `ROAS of ${(c.roas ?? 0).toFixed(1)}× is below a 3× target on ${fmt(c.cost)} spend. Tighten keyword targeting, improve ad relevance score, or switch to target ROAS bidding.`,
      metric:  `ROAS ${(c.roas ?? 0).toFixed(1)}× · ${fmt(c.cost)} spend · ${c.conversions ?? 0} conv`,
      chatPrompt: `"${c.name}" (${c.brand}) has a ${(c.roas ?? 0).toFixed(1)}× ROAS on ${fmt(c.cost)} spend with ${c.conversions ?? 0} conversions. What specific changes — keywords, bids, or ad groups — would improve ROAS above 3×?`,
      action:  'Review bids + ad relevance',
    });
  }

  // ── Term 3 seasonal ───────────────────────────────────────────────────────
  if (month === 6) {
    insights.push({
      id: 'seasonal-term3-start', severity: 'opportunity', category: 'seasonal',
      title:   'Term 3 starts this month — peak season for NAPLAN & HSC',
      body:    'July is the start of Term 3 in most Australian states — the highest-value period for Pascal Press (NAPLAN prep) and Excel Test Zone (HSC practice exams). Budgets should be maximised by mid-July.',
      metric:  'Term 3 · July–September',
      chatPrompt: 'It\'s early July and Term 3 is starting. What specific Google Ads campaigns, keywords, and ad copy should Pascal Press and Excel Test Zone be running right now to maximise NAPLAN prep and HSC prep sales?',
      action:  'Plan Term 3 campaigns',
    });
  }
  if (month === 7) {
    insights.push({
      id: 'seasonal-hsc-trials', severity: 'opportunity', category: 'seasonal',
      title:   'August: HSC Trial Exams — peak ETZ revenue window',
      body:    'August is when HSC students sit trial exams, making it the strongest month for Excel Test Zone online practice papers. ETZ bids and budgets should be at their highest. Consider remarketing to students who visited but didn\'t convert.',
      metric:  'HSC Trial season · Aug peak',
      chatPrompt: 'It\'s August — HSC trial exams are happening. What should Excel Test Zone\'s Google Ads strategy look like this week? Which keywords, bidding strategies, and ad extensions maximise conversions for practice papers?',
      action:  'Maximise ETZ budget',
    });
  }
  if (month === 8) {
    insights.push({
      id: 'seasonal-bts-prep', severity: 'opportunity', category: 'seasonal',
      title:   'Plan Term 4 / Back to School campaigns now',
      body:    'September is when publishers start planning Term 4 and Back to School campaigns (November–January). Begin building campaign structures and creative assets for Pascal Press workbook promotions.',
      metric:  'BTS prep · Oct–Jan window',
      chatPrompt: 'It\'s September and we should be planning Back to School campaigns for Pascal Press. What campaign types, timings, and budgets should we prepare for the October–January Back to School season?',
      action:  'Build BTS campaign plan',
    });
  }

  // ── Email performance (brand-split) ─────────────────────────────────────
  const emailCampaigns: any[] = emailData?.campaigns ?? emailData?.emails ?? [];
  const sentEmails = emailCampaigns.filter((e: any) => (e.sends ?? 0) > 100);

  // Detect brand from campaign name (ETZ campaigns start with ETZ_ or contain "ETZ")
  const isETZ = (name: string) => /\bETZ\b/i.test(name) || name.toUpperCase().startsWith('ETZ');
  const isPP  = (name: string) => !isETZ(name) && !/\bBE_\b/i.test(name) && !/\bBlake\b/i.test(name);

  const ppEmails  = sentEmails.filter(e => isPP(e.name ?? ''));
  const etzEmails = sentEmails.filter(e => isETZ(e.name ?? ''));

  // ── Per-brand: worst open rate ────────────────────────────────────────────
  const brandGroups: Array<{ brandLabel: string; brandEmails: any[]; promoType: string }> = [
    { brandLabel: 'Pascal Press', brandEmails: ppEmails, promoType: 'NAPLAN prep workbooks' },
    { brandLabel: 'Excel Test Zone', brandEmails: etzEmails, promoType: 'HSC exam practice papers' },
  ];
  for (const { brandLabel, brandEmails, promoType } of brandGroups) {
    const worst = [...brandEmails].sort((a, b) => (a.openRate ?? 0) - (b.openRate ?? 0))[0];
    if (worst && (worst.openRate ?? 0) < 0.20) {
      const name = (worst.name ?? 'campaign').slice(0, 55);
      const rate = pctStr(worst.openRate ?? 0);
      insights.push({
        id: `email-open-${brandLabel.replace(/\s/g, '-').toLowerCase()}-${worst.id ?? 'x'}`,
        severity: 'warning', category: 'email',
        title:   `${brandLabel}: "${name}" open rate ${rate}`,
        body:    `This ${brandLabel} email had only a ${rate} open rate (${(worst.sends ?? 0).toLocaleString()} sent). For ${promoType}, subject lines that lead with a specific title, grade level, or urgency ("HSC exams in 6 weeks") consistently outperform generic ones.`,
        metric:  `Open ${rate} · ${(worst.sends ?? 0).toLocaleString()} sent · ${(worst.clicks ?? 0)} clicks`,
        chatPrompt: `Our ${brandLabel} email "${worst.name}" had a ${rate} open rate (${worst.sends} sent, ${worst.opens ?? 0} opens). Write 5 alternative subject lines for ${promoType} that use urgency, specificity, or curiosity to lift open rates above 20%. Explain the hook for each.`,
        action:  'Rewrite subject line',
      });
    }
  }

  // ── Per-brand: no campaigns sent this month — proactive suggestion ─────────
  const ppSuggestion: string = ((): string => {
    if (month === 6) return 'Term 3 has just started — send a NAPLAN prep campaign now to capture parents buying workbooks for Year 3-9 students. Subject: "Your child NAPLAN prep starts here".';
    if (month === 7) return 'August is peak Back to School prep research time. A Pascal Press "prepare for next year" email with grade-specific workbook recommendations would convert well.';
    if (month === 8) return 'September — plan your Back to School email sequence now (3 sends: Oct, Nov, Jan). Early prep emails for Pascal Press outperform January sends.';
    return 'Send a Pascal Press product spotlight email featuring your top NAPLAN workbooks for the current term.';
  })();

  const etzSuggestion: string = ((): string => {
    if (month === 6) return 'Term 3 has started — ETZ should send an HSC exam countdown email immediately. Students sitting HSC in October have under 14 weeks. Subject: "14 weeks to your HSC — are you exam-ready?"';
    if (month === 7) return 'August is peak ETZ season — HSC trial exams are happening now. Send a "trial exam coming up? Practice now" email to your full student list.';
    if (month === 8) return 'HSC exams are 6-8 weeks away. ETZ should send a final exam prep push email with a CTA to purchase practice papers.';
    return 'Send an ETZ NAPLAN/HSC practice paper reminder to re-engage students who have not purchased this term.';
  })();

  if (ppEmails.length === 0) {
    insights.push({
      id: 'email-pp-no-campaigns', severity: 'opportunity', category: 'email',
      title:   'Pascal Press: no email campaigns sent this month',
      body:    ppSuggestion,
      metric:  `0 PP campaigns · ${ppEmails.length === 0 && sentEmails.length > 0 ? sentEmails.length + ' ETZ only' : 'month to date'}`,
      chatPrompt: `Pascal Press hasn't sent any email campaigns yet in ${monthName}. ${ppSuggestion} Draft a complete email campaign for me: subject line, preview text, email body (3 sections), and a clear CTA. Audience: parents of primary school students.`,
      action:  'Draft PP email campaign',
    });
  }

  if (etzEmails.length === 0) {
    insights.push({
      id: 'email-etz-no-campaigns', severity: 'opportunity', category: 'email',
      title:   'Excel Test Zone: no email campaigns sent this month',
      body:    etzSuggestion,
      metric:  `0 ETZ campaigns · ${monthName}`,
      chatPrompt: `Excel Test Zone hasn't sent any email campaigns yet in ${monthName}. ${etzSuggestion} Draft a complete email campaign for me: subject line, preview text, email body, and a CTA to purchase practice papers. Audience: HSC students and their parents.`,
      action:  'Draft ETZ email campaign',
    });
  }

  // ── Cross-brand: high unsubscribe ─────────────────────────────────────────
  const worstUnsub = [...sentEmails].sort((a, b) =>
    ((b.unsubscribes ?? 0) / (b.sends ?? 1)) - ((a.unsubscribes ?? 0) / (a.sends ?? 1))
  )[0];
  if (worstUnsub) {
    const unsubRate = (worstUnsub.unsubscribes ?? 0) / (worstUnsub.sends ?? 1);
    if (unsubRate > 0.005) {
      insights.push({
        id: `email-high-unsub-${worstUnsub.id ?? 'x'}`,
        severity: 'warning', category: 'email',
        title:   `"${(worstUnsub.name ?? 'Email').slice(0, 55)}" — ${pctStr(unsubRate)} unsub rate`,
        body:    `A ${pctStr(unsubRate)} unsubscribe rate is above the 0.5% warning threshold. This suggests misaligned audience expectations or excessive send frequency. Audit the list segment for this campaign.`,
        metric:  `${pctStr(unsubRate)} unsub · ${worstUnsub.unsubscribes ?? 0} unsubs`,
        chatPrompt: `Our email "${worstUnsub.name}" had a ${pctStr(unsubRate)} unsubscribe rate (${worstUnsub.unsubscribes} unsubs from ${worstUnsub.sends} sends). What are the likely causes and how should we fix list segmentation or send frequency?`,
        action:  'Review segment + frequency',
      });
    }
  }

  // ── Cross-brand: low CTOR ─────────────────────────────────────────────────
  const worstCtor = [...sentEmails]
    .filter(e => (e.opens ?? 0) > 50 && (e.clickToOpen ?? 0) > 0)
    .sort((a, b) => (a.clickToOpen ?? 0) - (b.clickToOpen ?? 0))[0];
  if (worstCtor && (worstCtor.clickToOpen ?? 0) < 0.08) {
    insights.push({
      id: `email-low-ctor-${worstCtor.id ?? 'x'}`,
      severity: 'info', category: 'email',
      title:   `"${(worstCtor.name ?? 'Email').slice(0, 55)}" — CTOR ${pctStr(worstCtor.clickToOpen ?? 0)}`,
      body:    `Only ${pctStr(worstCtor.clickToOpen ?? 0)} of people who opened clicked through — below the 8% benchmark. The offer, CTA button copy, or email body isn't compelling enough to drive action.`,
      metric:  `CTOR ${pctStr(worstCtor.clickToOpen ?? 0)} · ${worstCtor.opens ?? 0} opens`,
      chatPrompt: `Our email "${worstCtor.name}" had a ${pctStr(worstCtor.clickToOpen ?? 0)} CTOR (${worstCtor.opens} opens, ${worstCtor.clicks ?? 0} clicks). What specific CTA, offer framing, or layout changes would lift click-through for educational content?`,
      action:  'Improve CTA + offer copy',
    });
  }

  // ── BigCommerce: worst performing products (last 30 days) ───────────────
  const bottomProducts: any[] = bcData?.bottomProducts ?? [];
  if (bottomProducts.length >= 1 && bcData?.connected) {
    const show  = bottomProducts.slice(0, 5);
    const names = show.map((p: any) => p.name).join(', ');
    const lines = show.map((p: any) => `${p.name} (${fmt(p.revenue)}, ${p.quantity} units)`).join(' · ');
    insights.push({
      id: 'bc-worst-products', severity: 'opportunity', category: 'bigcommerce',
      title:   `Lowest-selling products — last 30 days`,
      body:    `These products had the fewest sales over the last 30 days: ${lines}. A targeted email, Google Ads ad group, or limited-time discount could meaningfully lift their revenue.`,
      metric:  `${show.length} products · bottom performers · 30 days`,
      chatPrompt: `Our BigCommerce store's lowest-selling products in the last 30 days are: ${names}. For each one, recommend a specific marketing action — a Google Ads ad group to create, a HubSpot email segment to target, or a discount/offer to run. Include suggested ad copy or subject lines.`,
      action:  'Plan product campaigns',
    });
  }

  // ── Band 6 tracking ───────────────────────────────────────────────────────
  const b6 = band6Data?.summary ?? band6Data ?? {};
  const b6Target = Number(b6.target ?? b6.monthlyTarget ?? 0);
  const b6Actual = Number(b6.actual ?? b6.currentRevenue ?? 0);
  if (b6Target > 0 && b6Actual < b6Target * 0.5 && pctThrough > 40) {
    insights.push({
      id: 'band6-pacing-low', severity: 'warning', category: 'band6',
      title:   `Band 6 tracker: ${Math.round((b6Actual / b6Target) * 100)}% of target with ${Math.round(pctThrough)}% of month elapsed`,
      body:    `Band 6 revenue is at ${fmt(b6Actual)} against a ${fmt(b6Target)} target. At the current pace, the month-end target will be missed. Increase ad exposure for the highest-converting ETZ products.`,
      metric:  `${fmt(b6Actual)} of ${fmt(b6Target)} target`,
      chatPrompt: `Band 6 tracker is showing ${fmt(b6Actual)} of ${fmt(b6Target)} target with ${Math.round(pctThrough)}% of the month elapsed. What actions should we take this week to improve Band 6 conversion rates for Excel Test Zone?`,
      action:  'Review Band 6 ad exposure',
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
  const CH: Record<string, { bg: string; text: string; border: string; bar: string; label: string }> = {
    'google-ads':  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  bar: 'bg-orange-500',  label: 'Google Ads'    },
    'email':       { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    bar: 'bg-blue-500',    label: 'Email'         },
    'bigcommerce': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-500', label: 'BigCommerce'   },
    'seasonal':    { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200',  bar: 'bg-purple-500',  label: 'Seasonal'      },
    'band6':       { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  bar: 'bg-indigo-500',  label: 'Band 6'        },
    'budget':      { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     bar: 'bg-red-500',     label: 'Budget'        },
  };
  const SEV_LEFT: Record<string, string> = {
    critical: 'border-l-red-500', warning: 'border-l-amber-400',
    opportunity: 'border-l-blue-500', info: 'border-l-gray-300',
  };
  const SEV_DOT: Record<string, string> = {
    critical: 'bg-red-500', warning: 'bg-amber-400', opportunity: 'bg-blue-500', info: 'bg-gray-400',
  };
  const ch = CH[insight.category] ?? CH['budget'];
  return (
    <div className={`bg-white rounded-xl border border-l-4 ${SEV_LEFT[insight.severity] ?? SEV_LEFT.info} border-gray-200 p-4`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${ch.bg} ${ch.text} ${ch.border}`}>
            {ch.label}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SEV[insight.severity]?.badge ?? ''}`}>
            {insight.severity === 'opportunity' ? 'Opportunity' : insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1)}
          </span>
        </div>
        <button onClick={() => onDismiss(insight.id)} className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0 -mt-0.5">×</button>
      </div>
      <h4 className="text-sm font-bold text-gray-900 mb-1.5 leading-snug">{insight.title}</h4>
      {insight.metric && (
        <div className={`inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg mb-2 ${ch.bg} ${ch.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[insight.severity] ?? 'bg-gray-400'} shrink-0`} />
          {insight.metric}
        </div>
      )}
      <p className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>{insight.body}</p>
      {insight.body.length > 180 && (
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-blue-500 hover:text-blue-700 mt-1">
          {expanded ? 'Show less ↑' : 'Read more ↓'}
        </button>
      )}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => onOpenChat(insight.chatPrompt)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg transition-colors">
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h2v3l3-3h7a1 1 0 001-1V3a1 1 0 00-1-1z"/></svg>
          Ask Claude
        </button>
        {insight.action && (
          <span className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${ch.bg} ${ch.text} ${ch.border}`}>
            → {insight.action}
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
  const [subTab,      setSubTab]      = useState<SubTab>('actions');
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
  const [bottomProds,  setBottomProds]  = useState<any[]>([]);
  const [showAllWorst, setShowAllWorst]  = useState(false);
  const [spendData,    setSpendData]    = useState<any[]>([]);
  const [emailSnap,    setEmailSnap]    = useState<any>({});
  const [campaignSnap, setCampaignSnap] = useState<any>({});

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
    setBottomProds(bcRes?.bottomProducts ?? []);
    setSpendData(Array.isArray(spendRes) ? spendRes : []);
    setEmailSnap(emailRes ?? {});
    setCampaignSnap(campaignsRes ?? {});

    // ── Step 1: compute baseline rule-based insights immediately ─────────────
    const baseline = computeBaselineInsights(spendRes, emailRes, band6Res, campaignsRes, bcRes);
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

  // ── Derived values for dashboard sections ───────────────────────────────
  const now          = new Date();
  const monthName    = now.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' });
  const dayOfMonth   = now.getDate();
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct     = (dayOfMonth / daysInMonth) * 100;

  const monthRecs    = spendData.filter(r => (r.month ?? '').toLowerCase() === monthName.toLowerCase());
  const ppSpent      = monthRecs.filter(r => r.brand === 'Pascal Press'    && (r.channel ?? '').toLowerCase().includes('google')).reduce((s, r) => s + Number(r.actualSpend ?? 0), 0);
  const etzSpent     = monthRecs.filter(r => r.brand === 'Excel Test Zone' && (r.channel ?? '').toLowerCase().includes('google')).reduce((s, r) => s + Number(r.actualSpend ?? 0), 0);

  const allEmails:  any[] = emailSnap?.campaigns ?? emailSnap?.emails ?? [];
  const isETZMail        = (n: string) => /ETZ/i.test(n) || n.toUpperCase().startsWith('ETZ');
  const ppMails          = allEmails.filter(e => !isETZMail(e.name ?? ''));
  const etzMails         = allEmails.filter(e =>  isETZMail(e.name ?? ''));
  const ppAvgOpen        = ppMails.length  ? ppMails.reduce((s, e)  => s + (e.openRate ?? 0), 0) / ppMails.length  : 0;
  const etzAvgOpen       = etzMails.length ? etzMails.reduce((s, e) => s + (e.openRate ?? 0), 0) / etzMails.length : 0;

  const bcConnected      = bottomProds.length > 0;
  const fmtMoney         = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

  const pacingStatus     = (spent: number, budget: number) => {
    if (budget === 0) return 'unknown';
    const pct = (spent / budget) * 100;
    if (pct < monthPct - 15) return 'under';
    if (pct > monthPct + 15) return 'over';
    return 'on-track';
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900">Action Centre</h2>
            {status === 'ready' && lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5">
                Last updated {fmtDate(lastUpdated)} · {fmtTime(lastUpdated)}
                {aiLabel && <span className="ml-1.5 bg-gray-100 text-gray-400 text-[10px] px-1.5 py-0.5 rounded-full">{aiLabel}</span>}
              </p>
            )}
            {isLoading && (
              <p className="text-xs text-blue-500 mt-0.5 animate-pulse">
                {status === 'fetching' ? 'Fetching data…' : 'Claude is analysing…'}
              </p>
            )}
            {status === 'error' && <p className="text-xs text-red-500 mt-0.5">{errorMsg}</p>}
          </div>
          <button onClick={refresh} disabled={isLoading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Sub-tab bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 shrink-0 flex gap-1">
        {(['actions', 'products', 'carts'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              subTab === t
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'actions' ? 'Action Items' : t === 'products' ? 'Products' : 'Abandoned Carts'}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-5">

        {/* Products sub-tab */}
        {subTab === 'products' && <ProductsSubTab />}
        {subTab === 'carts' && <AbandonedCartsSubTab />}

        {/* Actions sub-tab */}
        {subTab === 'actions' && <>

        {/* Skeletons while loading */}
        {isLoading && insights.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* AI enhancing banner */}
        {status === 'analysing' && insights.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Claude is analysing your campaigns for deeper insights…
          </div>
        )}

        {/* ── Act Now (critical + warning) ─────────────────────────────────── */}
        {critical.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full inline-block"/>
              Act Now · {critical.length} item{critical.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {critical.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* ── This Week (opportunities) ─────────────────────────────────────── */}
        {opps.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-blue-500 rounded-full inline-block"/>
              Opportunities · {opps.length}
            </p>
            <div className="space-y-3">
              {opps.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* ── Notes (info) ─────────────────────────────────────────────────── */}
        {infoItems.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-gray-400 rounded-full inline-block"/>
              Notes · {infoItems.length}
            </p>
            <div className="space-y-3">
              {infoItems.map((ins, i) => (
                <InsightCard key={ins.id} rank={i + 1} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} />
              ))}
            </div>
          </section>
        )}

        {/* ── All-clear state ───────────────────────────────────────────────── */}
        {visible.length === 0 && status === 'ready' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-700">All clear</p>
            <p className="text-xs text-gray-400 mt-1">No actions or issues detected. Check back after campaigns run.</p>
          </div>
        )}

        {/* ── Restore dismissed ─────────────────────────────────────────────── */}
        {dismissedCnt > 0 && status === 'ready' && (
          <div className="text-center">
            <button onClick={restoreDismissed} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Restore {dismissedCnt} dismissed item{dismissedCnt !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* ── Worst Performing Products (BigCommerce rolling 30 days) ──────── */}
        {bottomProds.length > 0 && (() => {
          type PatternGroup = { label: string; count: number; names: string[] };
          const SERIES = ['Excel', 'NAPLAN', 'HSC', 'Targeting', 'Selective', 'Science', 'Maths', 'English', 'Reading', 'Writing', 'Grammar', 'History', 'Geography', 'Spelling'];
          const groupMap: Record<string, string[]> = {};
          for (const p of bottomProds) {
            const n: string = p.name ?? '';
            const yearMatch = n.match(/Year\s*(\d+)/i);
            const year = yearMatch ? ` Year ${yearMatch[1]}` : '';
            let key = 'Other';
            for (const s of SERIES) {
              if (n.toLowerCase().includes(s.toLowerCase())) { key = s + year; break; }
            }
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(n);
          }
          const patterns: PatternGroup[] = Object.entries(groupMap)
            .filter(([, v]) => v.length >= 3)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([label, names]) => ({ label, count: names.length, names }));
          const visibleProds = showAllWorst ? bottomProds : bottomProds.slice(0, 10);

          return (
            <section>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-red-400 rounded-full inline-block"/>
                Worst Performing Products — Last 30 Days ({bottomProds.length})
              </p>

              {/* Series pattern callouts */}
              {patterns.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {patterns.map((pg) => (
                    <div key={pg.label} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-amber-800">Series pattern: {pg.label} — {pg.count} underperforming products</div>
                        <div className="text-[11px] text-amber-700 mt-0.5 truncate">{pg.names.slice(0, 4).join(' · ')}</div>
                      </div>
                      <button onClick={() => onOpenChat(`Our BigCommerce store has ${pg.count} "${pg.label}" products all underperforming in the last 30 days: ${pg.names.slice(0, 5).join(', ')}. Is this a pricing issue, a visibility/SEO issue, or a seasonal pattern? What specific campaigns should we run to fix this?`)}
                        className="shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2.5 py-1 rounded-lg transition-colors">
                        Ask Claude
                      </button>
                    </div>
                  ))}
                </div>
              ) : bottomProds.length >= 5 ? (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-3">
                  <span className="font-semibold">No series pattern detected</span> — underperformance is spread across product lines, not concentrated in one series.
                </div>
              ) : null}

              {/* Product list */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Product</span>
                  <div className="flex items-center gap-6">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Sold</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide w-16 text-right">Revenue</span>
                  </div>
                </div>
                {visibleProds.map((p: any, i: number) => (
                  <div key={p.name + i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-gray-300 w-5 shrink-0 text-right">#{i + 1}</span>
                      <span className="text-xs text-gray-800 font-medium truncate">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-6 shrink-0 ml-3">
                      <span className="text-xs text-gray-400 w-8 text-center">{p.quantity}</span>
                      <span className="text-xs font-bold text-red-500 font-mono w-16 text-right">{fmtMoney(p.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {bottomProds.length > 10 && (
                <button onClick={() => setShowAllWorst(v => !v)}
                  className="mt-2.5 text-xs font-medium text-blue-500 hover:text-blue-700 w-full text-center py-1">
                  {showAllWorst ? '↑ Show fewer' : `↓ Show all ${bottomProds.length} products`}
                </button>
              )}
              <p className="text-[10px] text-gray-400 mt-1.5">Rolling 30-day window · updates on refresh</p>
            </section>
          );
        })()}

        {/* ── Quick Analysis prompts ────────────────────────────────────────── */}
        {(status === 'ready' || status === 'analysing') && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Ask Claude</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onOpenChat(`It is ${monthName}, day ${dayOfMonth} of ${daysInMonth}. Pascal Press Google Ads: ${fmtMoney(ppSpent)} spent of ${fmtMoney(PP_BUDGET)} budget. Excel Test Zone: ${fmtMoney(etzSpent)} of ${fmtMoney(ETZ_BUDGET)}. Tell me specifically which brand needs the most urgent action, what to change in Google Ads, and give me exact budget adjustments.`)}
                className="text-left text-xs bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl p-3 transition-colors">
                <div className="font-bold text-orange-800 mb-0.5">🎯 Google Ads plan</div>
                <div className="text-orange-600 text-[11px]">Budget adjustments for this week</div>
              </button>
              <button onClick={() => onOpenChat(`Pascal Press sent ${ppMails.length} email campaigns this month (avg ${(ppAvgOpen * 100).toFixed(1)}% open rate). Excel Test Zone sent ${etzMails.length} (avg ${(etzAvgOpen * 100).toFixed(1)}% open). It is ${monthName} — Term 3 season. What campaigns should each brand send this week? Give me subject lines, send timing, and audience.`)}
                className="text-left text-xs bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl p-3 transition-colors">
                <div className="font-bold text-blue-800 mb-0.5">📧 Email strategy</div>
                <div className="text-blue-600 text-[11px]">PP + ETZ campaigns to send</div>
              </button>
              <button onClick={() => {
                const names = bottomProds.slice(0, 5).map((p: any) => p.name).join(', ');
                onOpenChat(`Our ${bottomProds.length} worst-performing BigCommerce products last 30 days include: ${names || 'data loading'}. For the top 5, recommend specific actions: a Google Ads ad group, a HubSpot email segment, or a discount offer. Be specific with numbers.`);
              }}
                className="text-left text-xs bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl p-3 transition-colors">
                <div className="font-bold text-emerald-800 mb-0.5">🛒 Fix worst products</div>
                <div className="text-emerald-600 text-[11px]">Campaign ideas to boost slow sellers</div>
              </button>
              <button onClick={() => onNavigate('calendar')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3 transition-colors">
                <div className="font-bold text-gray-700 mb-0.5">📅 Campaign calendar</div>
                <div className="text-gray-500 text-[11px]">View and plan all campaigns</div>
              </button>
            </div>
          </section>
        )}

        <div className="h-6" />
        </>
        }
      </div>
    </div>
  );
}
