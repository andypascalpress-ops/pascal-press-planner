'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Insight {
  id:              string;
  severity:        'critical' | 'warning' | 'opportunity' | 'info';
  category:        'google-ads' | 'email' | 'bigcommerce' | 'band6' | 'seasonal' | 'budget';
  brand?:          'pp' | 'etz' | 'blake' | 'all';
  title:           string;
  body:            string;
  metric:          string;
  suggestedAction?: string; // specific "Try this" recommendation shown inline
  chatPrompt:      string;
  action?:         string;
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

// Maps category to the tab the user should navigate to for action
const CAT_NAV: Record<string, string> = {
  'google-ads':  'finance',
  'email':       'email',
  'bigcommerce': 'finance',
  'band6':       'overview',
  'seasonal':    'calendar',
  'budget':      'finance',
};

const CAT_LABEL: Record<string, string> = {
  'google-ads':  'Google Ads',
  'email':       'Email',
  'bigcommerce': 'BigCommerce',
  'band6':       'Band 6',
  'seasonal':    'Seasonal',
  'budget':      'Budget',
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
  const month = now.getMonth(); // 0-based
  const dayOfMonth  = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), month + 1, 0).getDate();
  const daysLeft    = daysInMonth - dayOfMonth;
  const pctThrough  = (dayOfMonth / daysInMonth) * 100;
  const insights: Insight[] = [];
  const fmt    = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
  const pct1   = (n: number) => `${(n * 100).toFixed(1)}%`;

  // ── Google Ads: budget pacing ─────────────────────────────────────────────
  const records: any[] = Array.isArray(spendData) ? spendData : [];
  const monthName = now.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' });
  const monthRecords = records.filter(r => (r.month ?? '').toLowerCase() === monthName.toLowerCase());

  const adsByBrand: Record<string, { actual: number; budget: number; revenue: number; brandKey: 'pp' | 'etz' }> = {};
  for (const r of monthRecords) {
    if (!(r.channel ?? '').toLowerCase().includes('google')) continue;
    const b = r.brand ?? 'Unknown';
    if (!adsByBrand[b]) adsByBrand[b] = { actual: 0, budget: 0, revenue: 0, brandKey: b === 'Pascal Press' ? 'pp' : 'etz' };
    adsByBrand[b].actual  += Number(r.actualSpend       ?? 0);
    adsByBrand[b].budget  += Number(r.budget            ?? 0);
    adsByBrand[b].revenue += Number(r.attributedRevenue ?? 0);
  }
  if (!adsByBrand['Pascal Press'])    adsByBrand['Pascal Press']    = { actual: 0, budget: PP_BUDGET,  revenue: 0, brandKey: 'pp' };
  if (!adsByBrand['Excel Test Zone']) adsByBrand['Excel Test Zone'] = { actual: 0, budget: ETZ_BUDGET, revenue: 0, brandKey: 'etz' };

  for (const [brandLabel, s] of Object.entries(adsByBrand)) {
    if (!s.budget || s.actual === 0) continue;
    const expected    = (pctThrough / 100) * s.budget;
    const diff        = s.actual - expected;
    const remaining   = s.budget - s.actual;
    const pacing      = Math.round((s.actual / s.budget) * 100);
    const roas        = s.actual > 0 ? (s.revenue / s.actual).toFixed(1) : '—';
    const dailyNeeded = daysLeft > 0 ? remaining / daysLeft : 0;
    const dailyCurrent = dayOfMonth > 0 ? s.actual / dayOfMonth : 0;

    if (diff < -300) {
      insights.push({
        id: `spend-under-${brandLabel.replace(/\s/g, '-').toLowerCase()}`,
        severity: 'warning', category: 'google-ads', brand: s.brandKey,
        title:   `${brandLabel}: spent ${fmt(s.actual)} of ${fmt(s.budget)} budget — ${fmt(Math.abs(diff))} behind pace`,
        body:    `Day ${dayOfMonth} of ${daysInMonth}. At the current rate of ${fmt(Math.round(dailyCurrent))}/day, you'll underspend by ${fmt(Math.abs(diff))} by end of month. ${daysLeft} days left to recover ${fmt(remaining)}.`,
        metric:  `${pacing}% of budget used · ${daysLeft} days left · ROAS ${roas}×`,
        suggestedAction: `Increase the ${brandLabel} daily budget from ~${fmt(Math.round(dailyCurrent))} to ~${fmt(Math.round(dailyNeeded))} for the remaining ${daysLeft} days to hit the ${fmt(s.budget)} target.`,
        chatPrompt: `${brandLabel} Google Ads has spent ${fmt(s.actual)} of a ${fmt(s.budget)} budget with ${daysLeft} days left. I need to spend ${fmt(remaining)} more — what's the best way to increase velocity without inflating CPC or wasting spend?`,
        action:  'Adjust daily budget',
      });
    } else if (diff > 500) {
      const overBy = Math.round(((s.actual / s.budget) - 1) * 100);
      insights.push({
        id: `spend-over-${brandLabel.replace(/\s/g, '-').toLowerCase()}`,
        severity: 'warning', category: 'google-ads', brand: s.brandKey,
        title:   `${brandLabel}: ${pacing}% of budget used — ${fmt(diff)} overpacing`,
        body:    `Day ${dayOfMonth} of ${daysInMonth}. ${brandLabel} has spent ${fmt(s.actual)} (${overBy}% over expected) and will exhaust the ${fmt(s.budget)} budget ${daysLeft > 0 ? 'before' : 'by'} month end at this rate.`,
        metric:  `${pacing}% paced · ${fmt(diff)} over · ROAS ${roas}×`,
        suggestedAction: `Lower the ${brandLabel} daily budget cap to ${fmt(Math.round(remaining / Math.max(daysLeft, 1)))} to spread the remaining ${fmt(remaining)} evenly across ${daysLeft} days.`,
        chatPrompt: `${brandLabel} Google Ads is ${fmt(diff)} ahead of expected pacing (${pacing}% of budget used on day ${dayOfMonth} of ${daysInMonth}). How do I reduce daily spend without hurting campaign performance or losing auction position?`,
        action:  'Lower daily cap',
      });
    }
  }

  // ── Google Ads: campaign-level issues ─────────────────────────────────────
  const allCamps: any[] = [
    ...(campaignsData?.pp?.campaigns  ?? []).map((c: any) => ({ ...c, brandLabel: 'Pascal Press',    brandKey: 'pp'  as const })),
    ...(campaignsData?.etz?.campaigns ?? []).map((c: any) => ({ ...c, brandLabel: 'Excel Test Zone', brandKey: 'etz' as const })),
  ];

  for (const c of allCamps.filter(c => (c.conversions ?? 0) === 0 && (c.cost ?? 0) > 150).slice(0, 2)) {
    const name = (c.name ?? 'Unknown').slice(0, 50);
    const ctr  = ((c.ctr ?? 0) * 100).toFixed(2);
    insights.push({
      id: `ads-zero-conv-${(c.name ?? '').replace(/\W/g, '-').toLowerCase().slice(0, 24)}`,
      severity: 'critical', category: 'google-ads', brand: c.brandKey,
      title:   `"${name}" — ${fmt(c.cost)} spent with zero sales`,
      body:    `This ${c.brandLabel} campaign has spent ${fmt(c.cost)} this month and generated ${c.clicks ?? 0} clicks (${ctr}% CTR) but zero conversions. Every dollar spent here is currently wasted.`,
      metric:  `${fmt(c.cost)} spend · 0 conversions · ${c.clicks ?? 0} clicks`,
      suggestedAction: `Pause "${name}" now. Common culprits: keywords like "free", "pdf", "answers", "download" attract non-buyers — add them as negatives before re-enabling.`,
      chatPrompt: `Our Google Ads campaign "${c.name}" (${c.brandLabel}) has spent ${fmt(c.cost)} with 0 conversions and ${c.clicks ?? 0} clicks (CTR ${ctr}%). Review the keywords in this campaign and tell me which ones are likely wasting spend — list the top 10 to add as negatives.`,
      action:  'Pause + add negatives',
    });
  }

  for (const c of allCamps.filter(c => (c.cost ?? 0) > 300 && (c.roas ?? 0) > 0 && (c.roas ?? 0) < 2).slice(0, 2)) {
    const name = (c.name ?? 'Unknown').slice(0, 50);
    const roasVal = (c.roas ?? 0).toFixed(1);
    insights.push({
      id: `ads-low-roas-${(c.name ?? '').replace(/\W/g, '-').toLowerCase().slice(0, 24)}`,
      severity: 'warning', category: 'google-ads', brand: c.brandKey,
      title:   `"${name}" — only ${roasVal}× ROAS on ${fmt(c.cost)} spend`,
      body:    `This ${c.brandLabel} campaign returned ${fmt(Math.round((c.roas ?? 0) * (c.cost ?? 0)))} from ${fmt(c.cost)} spend (${roasVal}× ROAS). Your target is 3×, meaning you need ${fmt(c.cost * 3)} in revenue to break even on this spend.`,
      metric:  `${roasVal}× ROAS · ${fmt(c.cost)} spend · ${c.conversions ?? 0} conversions`,
      suggestedAction: `Switch "${name}" to Target ROAS bidding at 300% and tighten keywords to exact/phrase match only. Broad match on educational keywords spends heavily on low-intent traffic.`,
      chatPrompt: `"${c.name}" (${c.brandLabel}) has a ${roasVal}× ROAS on ${fmt(c.cost)} spend with ${c.conversions ?? 0} conversions. What specific keyword, bid strategy, and ad group changes would push ROAS above 3×? Be specific — list the exact changes.`,
      action:  'Switch to Target ROAS',
    });
  }

  // ── Seasonal — PP and ETZ are SEPARATE products with different audiences ──
  if (month === 6) {
    // Pascal Press = NAPLAN workbooks (Years 3, 5, 7, 9)
    insights.push({
      id: 'seasonal-pp-term3', severity: 'opportunity', category: 'seasonal', brand: 'pp',
      title:   'Pascal Press: Term 3 is NAPLAN prep season — peak buying window open',
      body:    'Term 3 has just started across most Australian states. Parents of Year 3, 5, 7 and 9 students are actively searching for NAPLAN workbooks right now. This is Pascal Press\'s highest-converting window of the year.',
      metric:  'NAPLAN season · Term 3 · Year 3–9',
      suggestedAction: 'Run a NAPLAN-specific Google Ads campaign targeting "NAPLAN Year [3/5/7/9] practice" and send an email with subject: "NAPLAN is coming — your Year [X] preparation guide".',
      chatPrompt: 'It\'s Term 3 and NAPLAN prep season for Pascal Press. Write a Google Ads campaign plan for NAPLAN workbooks targeting parents of Year 3, 5, 7 and 9 students — include keywords, ad copy, and a landing page recommendation.',
      action:  'Launch NAPLAN campaigns',
    });
    // ETZ = HSC practice papers (Year 11–12), NOT NAPLAN
    insights.push({
      id: 'seasonal-etz-term3', severity: 'opportunity', category: 'seasonal', brand: 'etz',
      title:   'Excel Test Zone: 14 weeks to HSC exams — urgency window is now',
      body:    'HSC exams are approximately 14 weeks away. Year 12 students are starting to feel real urgency and will pay for practice papers. This is ETZ\'s highest-intent period — conversion rates are typically 40% above average.',
      metric:  'HSC season · ~14 weeks to exams',
      suggestedAction: 'Send an email with subject: "14 weeks until your HSC — which subjects need work?" and increase ETZ Google Ads bids on "HSC practice papers" and "HSC past papers [subject]".',
      chatPrompt: 'It\'s Term 3 and HSC exams are about 14 weeks away. What specific Google Ads keywords, ad copy, and bid adjustments should Excel Test Zone be running right now to maximise HSC practice paper sales?',
      action:  'Maximise ETZ HSC campaigns',
    });
  }

  if (month === 7) {
    // ETZ peak: HSC trial exams
    insights.push({
      id: 'seasonal-etz-hsc-trials', severity: 'opportunity', category: 'seasonal', brand: 'etz',
      title:   'Excel Test Zone: HSC trial exams are happening now — peak ETZ revenue week',
      body:    'August is when NSW and VIC schools hold HSC trial exams. Students who just sat trials urgently need practice papers to prepare for the real exams in October. This is typically ETZ\'s single highest revenue week.',
      metric:  'HSC Trial season · peak week',
      suggestedAction: 'Maximise ETZ Google Ads budget this week. Send an email with subject: "How did your trial go? Fix the gaps before the real HSC" — target your full student list.',
      chatPrompt: 'HSC trial exams are happening this week — it\'s the peak revenue window for Excel Test Zone. What should our Google Ads strategy look like right now? What keywords, bids, and budget should we be running?',
      action:  'Maximise ETZ budget now',
    });
    // PP: Back-to-school planning
    insights.push({
      id: 'seasonal-pp-bts-plan', severity: 'opportunity', category: 'seasonal', brand: 'pp',
      title:   'Pascal Press: start building Back to School campaigns for Term 4',
      body:    'August is the time to plan and build Pascal Press Back to School campaigns for the October–January window. Last year\'s BTS campaigns that launched in early September outperformed late-starting ones by 3×.',
      metric:  'BTS prep · launch Sep for Oct–Jan',
      suggestedAction: 'Create a BTS campaign brief now: workbook bundles by year level, Google Ads campaign for "school workbooks 2027", and an email sequence (3 sends: Oct, Nov, Jan).',
      chatPrompt: 'It\'s August and I need to plan Pascal Press\'s Back to School campaigns for Term 4 and January 2027. Give me a complete campaign plan: Google Ads structure, email send schedule, and subject lines for 3 emails.',
      action:  'Build BTS campaign plan',
    });
  }

  if (month === 8) {
    insights.push({
      id: 'seasonal-etz-final-push', severity: 'opportunity', category: 'seasonal', brand: 'etz',
      title:   'Excel Test Zone: final 6 weeks push before HSC exams',
      body:    'HSC exams begin in approximately 6 weeks. This is the last buying window for practice papers — students who haven\'t purchased yet are running out of time and conversion intent is highest.',
      metric:  'HSC final prep · 6 weeks to go',
      suggestedAction: 'Send a final urgency email: "6 weeks until HSC — last chance to practice". Add a countdown timer or urgency line in ETZ Google Ads ad copy.',
      chatPrompt: 'HSC exams are 6 weeks away — it\'s the final push for Excel Test Zone practice papers. Write a high-urgency email campaign and suggest Google Ads adjustments to maximise conversions in the last 6 weeks.',
      action:  'Launch final HSC push',
    });
  }

  // ── Email performance ────────────────────────────────────────────────────
  const emailCampaigns: any[] = emailData?.campaigns ?? emailData?.emails ?? [];
  const sentEmails = emailCampaigns.filter((e: any) => (e.sends ?? 0) > 100);
  const isETZ = (name: string) => /\bETZ\b/i.test(name) || name.toUpperCase().startsWith('ETZ');
  const ppEmails  = sentEmails.filter(e => !isETZ(e.name ?? ''));
  const etzEmails = sentEmails.filter(e =>  isETZ(e.name ?? ''));

  // Per-brand: worst open rate
  for (const { brandLabel, brandEmails, brandKey, subjectHints } of [
    {
      brandLabel: 'Pascal Press', brandEmails: ppEmails, brandKey: 'pp' as const,
      subjectHints: [
        `"NAPLAN is in 4 weeks — your Year 5 prep checklist"`,
        `"3 NAPLAN questions most Year 5 students get wrong"`,
        `"Your child's Year [X] NAPLAN: what to focus on this week"`,
      ],
    },
    {
      brandLabel: 'Excel Test Zone', brandEmails: etzEmails, brandKey: 'etz' as const,
      subjectHints: [
        `"Your HSC is in ${month === 6 ? '14' : month === 7 ? '8' : '6'} weeks — how ready are you?"`,
        `"The practice test that separates Band 5 from Band 6"`,
        `"Most common mistake students make in HSC [subject] exams"`,
      ],
    },
  ]) {
    const worst = [...brandEmails].sort((a, b) => (a.openRate ?? 0) - (b.openRate ?? 0))[0];
    if (worst && (worst.openRate ?? 0) < 0.20) {
      const campaignName = (worst.name ?? 'campaign').slice(0, 55);
      const openRate     = pct1(worst.openRate ?? 0);
      const sends        = (worst.sends ?? 0).toLocaleString();
      insights.push({
        id: `email-open-${brandLabel.replace(/\s/g, '-').toLowerCase()}-${worst.id ?? 'x'}`,
        severity: 'warning', category: 'email', brand: brandKey,
        title:   `"${campaignName}" sent to ${sends} — only ${openRate} opened it`,
        body:    `This ${brandLabel} email had a ${openRate} open rate against an industry benchmark of ~22%. ${worst.sends - (worst.opens ?? 0)} people received it but never opened — a stronger subject line would recover a significant chunk.`,
        metric:  `${openRate} open rate · ${sends} sent · ${worst.opens ?? 0} opens · ${worst.clicks ?? 0} clicks`,
        suggestedAction: `Try one of these subject lines for the next send:\n• ${subjectHints[0]}\n• ${subjectHints[1]}\n• ${subjectHints[2]}`,
        chatPrompt: `Our ${brandLabel} email "${worst.name}" had only a ${openRate} open rate (${worst.sends} sent, ${worst.opens ?? 0} opens). Write 5 alternative subject lines using urgency, specificity, and curiosity. For each one, explain the psychological hook that makes it work better.`,
        action:  'Rewrite subject line',
      });
    }
  }

  // Per-brand: no campaigns sent
  const ppSendSuggestion = month === 6
    ? `"NAPLAN prep: what Year 5 students should do this week"`
    : month === 7
      ? `"Prepare for next year — Year [X] workbook recommendations"`
      : `"Top NAPLAN workbooks for Term ${month < 6 ? 1 : month < 9 ? 3 : 4}"`;

  const etzSendSuggestion = month === 6
    ? `"14 weeks to your HSC — are you exam-ready?"`
    : month === 7
      ? `"Trial exams are here — how did you go? Fix the gaps now"`
      : `"${month === 8 ? '6 weeks' : 'Time'} until your HSC — final practice checklist"`;

  if (ppEmails.length === 0) {
    insights.push({
      id: 'email-pp-no-campaigns', severity: 'opportunity', category: 'email', brand: 'pp',
      title:   `Pascal Press: 0 email campaigns sent in ${monthName}`,
      body:    `No Pascal Press emails have been sent this month. Your list is going cold. ${monthName} is an active buying period — parents searching for workbooks are making decisions right now.`,
      metric:  `0 PP emails · ${monthName}`,
      suggestedAction: `Send a NAPLAN prep email this week. Suggested subject: ${ppSendSuggestion}. Best send time: Tuesday or Wednesday 7–9am AEST.`,
      chatPrompt: `Pascal Press hasn't sent any emails in ${monthName}. Draft a complete NAPLAN prep email campaign: subject line, preview text, 3-section email body, and a clear CTA to buy workbooks. Audience: parents of primary school students (Year 3–9).`,
      action:  'Send PP email now',
    });
  }

  if (etzEmails.length === 0) {
    insights.push({
      id: 'email-etz-no-campaigns', severity: 'opportunity', category: 'email', brand: 'etz',
      title:   `Excel Test Zone: 0 email campaigns sent in ${monthName}`,
      body:    `No ETZ emails this month. With HSC exams approaching, students are actively researching and buying practice papers — silence during this window costs sales.`,
      metric:  `0 ETZ emails · ${monthName}`,
      suggestedAction: `Send an HSC prep email this week. Suggested subject: ${etzSendSuggestion}. Best send time: Sunday evening 6–8pm AEST when students are studying.`,
      chatPrompt: `Excel Test Zone hasn't sent any emails in ${monthName}. Draft a complete HSC prep email: subject line, preview text, 3-section body, and a CTA to buy practice papers. Audience: Year 12 HSC students and their parents.`,
      action:  'Send ETZ email now',
    });
  }

  // High unsubscribe rate
  const worstUnsub = [...sentEmails].sort((a, b) =>
    ((b.unsubscribes ?? 0) / (b.sends ?? 1)) - ((a.unsubscribes ?? 0) / (a.sends ?? 1))
  )[0];
  if (worstUnsub) {
    const unsubRate = (worstUnsub.unsubscribes ?? 0) / (worstUnsub.sends ?? 1);
    if (unsubRate > 0.005) {
      const campaignName = (worstUnsub.name ?? 'Email').slice(0, 55);
      insights.push({
        id: `email-high-unsub-${worstUnsub.id ?? 'x'}`,
        severity: 'warning', category: 'email', brand: isETZ(worstUnsub.name ?? '') ? 'etz' : 'pp',
        title:   `"${campaignName}" — ${pct1(unsubRate)} unsubscribed (${worstUnsub.unsubscribes ?? 0} people)`,
        body:    `${worstUnsub.unsubscribes ?? 0} people unsubscribed after receiving this email (${pct1(unsubRate)} rate vs 0.5% warning threshold). Each unsub is a permanent loss from the list.`,
        metric:  `${pct1(unsubRate)} unsub rate · ${worstUnsub.unsubscribes ?? 0} unsubs from ${(worstUnsub.sends ?? 0).toLocaleString()} sends`,
        suggestedAction: `Check if this email was sent to the full list instead of an engaged segment. Limit future sends to contacts who opened at least one email in the last 90 days.`,
        chatPrompt: `Our email "${worstUnsub.name}" had a ${pct1(unsubRate)} unsubscribe rate (${worstUnsub.unsubscribes} unsubs from ${worstUnsub.sends} sends). What are the most likely causes and what segmentation or frequency changes would reduce churn?`,
        action:  'Review list segment',
      });
    }
  }

  // Low CTOR
  const worstCtor = [...sentEmails]
    .filter(e => (e.opens ?? 0) > 50 && (e.clickToOpen ?? 0) > 0)
    .sort((a, b) => (a.clickToOpen ?? 0) - (b.clickToOpen ?? 0))[0];
  if (worstCtor && (worstCtor.clickToOpen ?? 0) < 0.08) {
    const ctor = pct1(worstCtor.clickToOpen ?? 0);
    insights.push({
      id: `email-low-ctor-${worstCtor.id ?? 'x'}`,
      severity: 'info', category: 'email', brand: isETZ(worstCtor.name ?? '') ? 'etz' : 'pp',
      title:   `"${(worstCtor.name ?? 'Email').slice(0, 55)}" — ${ctor} CTOR (${worstCtor.opens ?? 0} opened, only ${worstCtor.clicks ?? 0} clicked)`,
      body:    `${worstCtor.opens ?? 0} people opened this email but only ${worstCtor.clicks ?? 0} clicked through (${ctor} CTOR vs 8% benchmark). The email got attention but failed to convert interest into action.`,
      metric:  `${ctor} CTOR · ${worstCtor.opens ?? 0} opens · ${worstCtor.clicks ?? 0} clicks`,
      suggestedAction: `Add a single bold CTA button above the fold ("Get the practice paper →") and remove secondary links that compete for clicks.`,
      chatPrompt: `Our email "${worstCtor.name}" had only a ${ctor} CTOR (${worstCtor.opens} opens, ${worstCtor.clicks ?? 0} clicks). Suggest specific email body and CTA changes to lift click-through above 8% for an educational product email.`,
      action:  'Improve CTA + layout',
    });
  }

  // ── BigCommerce ───────────────────────────────────────────────────────────
  const bottomProducts: any[] = bcData?.bottomProducts ?? [];
  if (bottomProducts.length >= 1 && bcData?.connected) {
    const show  = bottomProducts.slice(0, 3);
    const names = show.map((p: any) => `"${p.name}"`).join(', ');
    const totalRev = show.reduce((s: number, p: any) => s + (p.revenue ?? 0), 0);
    insights.push({
      id: 'bc-worst-products', severity: 'opportunity', category: 'bigcommerce', brand: 'pp',
      title:   `${bottomProducts.length} products made under ${fmt(totalRev / show.length)} each in the last 30 days`,
      body:    `Lowest sellers: ${names}. These products are live in the store but not being promoted. A single targeted email or Google Ads ad group for these specific titles typically lifts them 2–4×.`,
      metric:  `${bottomProducts.length} products · avg ${fmt(Math.round(totalRev / show.length))} · last 30 days`,
      suggestedAction: `Create one Google Ads ad group for ${names} using the exact product title as exact-match keywords, or add them to the next PP email as a "hidden gems" section.`,
      chatPrompt: `Our ${bottomProducts.length} worst-selling BigCommerce products include: ${bottomProducts.slice(0, 5).map((p: any) => p.name).join(', ')}. For each of the top 5, recommend one specific marketing action — a Google Ads ad group to create, a HubSpot email segment, or a discount/bundle. Include specific ad copy or subject lines.`,
      action:  'Create targeted campaigns',
    });
  }

  // ── Band 6 ── uses season elapsed days (Jul 1 – Nov 30), not month days ──
  const b6 = band6Data ?? {};
  // Try every possible field name the API might use
  const b6Target = Number(b6.target ?? b6.seasonTarget ?? b6.monthlyTarget ?? 25000);
  const b6Actual = Number(b6.revenue ?? b6.actual ?? b6.currentRevenue ?? b6.periodRevenue ?? 0);

  // Season runs July 1 – November 30
  const b6SeasonStart = new Date(now.getFullYear(), 6, 1); // Jul 1
  const b6SeasonEnd   = new Date(now.getFullYear(), 10, 30, 23, 59); // Nov 30
  const b6SeasonDays  = Math.round((b6SeasonEnd.getTime() - b6SeasonStart.getTime()) / 86400000);
  const b6DaysElapsed = Math.max(0, Math.round((now.getTime() - b6SeasonStart.getTime()) / 86400000));
  const b6DaysLeft    = Math.max(0, Math.round((b6SeasonEnd.getTime() - now.getTime()) / 86400000));
  const b6SeasonPct   = Math.min(100, Math.round((b6DaysElapsed / b6SeasonDays) * 100));
  const b6ActualPct   = b6Target > 0 ? Math.round((b6Actual / b6Target) * 100) : 0;
  const b6Gap         = Math.max(0, b6Target - b6Actual);
  const b6WeeklyNeeded = b6DaysLeft > 0 ? (b6Gap / b6DaysLeft) * 7 : 0;

  if (b6Target > 0 && b6ActualPct < b6SeasonPct - 15 && b6DaysElapsed > 7) {
    insights.push({
      id: 'band6-pacing-low', severity: 'warning', category: 'band6', brand: 'etz',
      title:   `Band 6: ${fmt(b6Actual)} of ${fmt(b6Target)} target — ${b6SeasonPct}% through the season`,
      body:    `The Band 6 season (Jul–Nov) is ${b6SeasonPct}% through but revenue is only at ${b6ActualPct}% of target. ${fmt(b6Gap)} still needed across ${b6DaysLeft} remaining days.`,
      metric:  `${fmt(b6Actual)} earned · ${fmt(b6Gap)} remaining · ${b6DaysLeft} days left`,
      suggestedAction: `To hit target, aim for ~${fmt(Math.round(b6WeeklyNeeded))}/week. Increase ETZ Google Ads bids on Band 6 keywords and send a targeted email to students who viewed Band 6 products but didn't purchase.`,
      chatPrompt: `Band 6 tracker shows ${fmt(b6Actual)} of a ${fmt(b6Target)} season target (Jul–Nov) with ${b6DaysLeft} days remaining. What specific actions — Google Ads bids, email campaigns, or promotions — would close the ${fmt(b6Gap)} gap?`,
      action:  'Review Band 6 strategy',
    });
  }

  return insights;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Derive brand status from all insights (including AI-generated ones without brand field)
function brandStatus(
  brandKey: 'pp' | 'etz' | 'blake',
  brandKeywords: string[],
  insights: Insight[],
): { dot: 'red' | 'amber' | 'green'; count: number; topIssue: string } {
  const relevant = insights.filter(i => {
    if (i.brand === brandKey) return true;
    if (i.brand === 'all') return false; // all-brand items don't count toward one brand
    // fallback: scan title for brand keywords
    return brandKeywords.some(kw => (i.title + ' ' + i.body).toLowerCase().includes(kw.toLowerCase()));
  });
  const actionable = relevant.filter(i => i.severity !== 'info');
  const hasCritical = actionable.some(i => i.severity === 'critical');
  const hasWarning  = actionable.some(i => i.severity === 'warning');
  const dot = hasCritical ? 'red' : hasWarning ? 'amber' : 'green';
  const top = actionable[0];
  return {
    dot,
    count: actionable.length,
    topIssue: top ? top.title.slice(0, 48) + (top.title.length > 48 ? '…' : '') : '',
  };
}

// ─── UI components ────────────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-gray-200 overflow-hidden animate-pulse"
      style={{ animationDelay: `${index * 120}ms` }}>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-14 bg-gray-200 rounded-full" />
          <div className="h-5 w-20 bg-gray-100 rounded-full" />
          <div className="h-5 w-16 bg-gray-100 rounded-full" />
        </div>
        <div className="h-4 w-3/4 bg-gray-200 rounded" />
        <div className="space-y-1.5">
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-5/6 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex gap-2">
        <div className="h-6 w-24 bg-gray-200 rounded-lg" />
        <div className="h-6 w-20 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

const BRAND_TAG: Record<string, { bg: string; text: string; label: string }> = {
  pp:    { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Pascal Press'    },
  etz:   { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Excel Test Zone' },
  blake: { bg: 'bg-purple-50',  text: 'text-purple-700',  label: 'Blake'           },
  all:   { bg: 'bg-gray-100',   text: 'text-gray-600',    label: 'All brands'      },
};

const CAT_STYLE: Record<string, { bg: string; text: string }> = {
  'google-ads':  { bg: 'bg-orange-50',  text: 'text-orange-700'  },
  'email':       { bg: 'bg-sky-50',     text: 'text-sky-700'     },
  'bigcommerce': { bg: 'bg-teal-50',    text: 'text-teal-700'    },
  'seasonal':    { bg: 'bg-violet-50',  text: 'text-violet-700'  },
  'band6':       { bg: 'bg-indigo-50',  text: 'text-indigo-700'  },
  'budget':      { bg: 'bg-red-50',     text: 'text-red-700'     },
};

const SEV_LEFT: Record<string, string> = {
  critical:    'border-l-red-500',
  warning:     'border-l-amber-400',
  opportunity: 'border-l-blue-500',
  info:        'border-l-gray-300',
};

const SEV_BADGE: Record<string, string> = {
  critical:    'bg-red-50 text-red-700 border-red-200',
  warning:     'bg-amber-50 text-amber-700 border-amber-200',
  opportunity: 'bg-blue-50 text-blue-700 border-blue-200',
  info:        'bg-gray-50 text-gray-500 border-gray-200',
};

function InsightCard({ insight, onDismiss, onOpenChat, onNavigate }: {
  insight: Insight;
  onDismiss:  (id: string) => void;
  onOpenChat: (prompt: string) => void;
  onNavigate: (tab: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cat   = CAT_STYLE[insight.category] ?? CAT_STYLE['budget'];
  const brand = insight.brand ? BRAND_TAG[insight.brand] : null;
  const navTab = CAT_NAV[insight.category];
  const navLabel: Record<string, string> = {
    finance: 'Open Finance', email: 'Open Email', overview: 'Open Overview', calendar: 'Open Calendar',
  };

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${SEV_LEFT[insight.severity] ?? SEV_LEFT.info} overflow-hidden`}>
      <div className="p-4">
        {/* Tags row */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SEV_BADGE[insight.severity] ?? SEV_BADGE.info}`}>
            {insight.severity === 'opportunity' ? 'Do this week' : insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1)}
          </span>
          {brand && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${brand.bg} ${brand.text}`}>
              {brand.label}
            </span>
          )}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cat.bg} ${cat.text}`}>
            {CAT_LABEL[insight.category] ?? insight.category}
          </span>
          <button
            onClick={() => onDismiss(insight.id)}
            className="ml-auto text-gray-300 hover:text-gray-500 text-xl leading-none -mr-1"
            aria-label="Dismiss"
          >×</button>
        </div>

        {/* Title */}
        <h4 className="text-sm font-semibold text-gray-900 leading-snug mb-2">{insight.title}</h4>

        {/* Body */}
        <p className={`text-sm text-gray-500 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>{insight.body}</p>
        {insight.body.length > 180 && (
          <button onClick={() => setExpanded(v => !v)} className="text-xs text-blue-500 hover:text-blue-700 mt-1">
            {expanded ? 'Show less ↑' : 'Read more ↓'}
          </button>
        )}

        {/* Metric pill */}
        {insight.metric && (
          <div className={`inline-flex items-center gap-1.5 text-xs font-mono mt-2.5 px-2.5 py-1 rounded-lg ${cat.bg} ${cat.text}`}>
            {insight.metric}
          </div>
        )}

        {/* Suggested action callout */}
        {insight.suggestedAction && (
          <div className="mt-3 border-l-2 border-amber-400 bg-amber-50 pl-3 pr-2 py-2 rounded-r-lg">
            <p className="text-xs font-semibold text-amber-700 mb-0.5">Try this:</p>
            <p className="text-xs text-amber-800 leading-relaxed whitespace-pre-line">{insight.suggestedAction}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-2 flex-wrap">
        {navTab && (
          <button
            onClick={() => onNavigate(navTab)}
            className="text-xs font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            {navLabel[navTab] ?? 'Open'}
          </button>
        )}
        <button
          onClick={() => onOpenChat(insight.chatPrompt)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h2v3l3-3h7a1 1 0 001-1V3a1 1 0 00-1-1z"/></svg>
          Ask Claude
        </button>
        {insight.action && (
          <span className={`text-xs font-medium px-2.5 py-1.5 rounded-lg ${cat.bg} ${cat.text}`}>
            → {insight.action}
          </span>
        )}
      </div>
    </div>
  );
}

function PulseDot({ status }: { status: 'red' | 'amber' | 'green' }) {
  const cls = status === 'red' ? 'bg-red-500' : status === 'amber' ? 'bg-amber-400' : 'bg-emerald-500';
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} />;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActionCentreTab({ onNavigate, onOpenChat, onAddSpend, onAddCampaign }: Props) {
  const [status,       setStatus]       = useState<Status>('idle');
  const [insights,     setInsights]     = useState<Insight[]>([]);
  const [dismissed,    setDismissed]    = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ac-dismissed-v2') : null;
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [sources,      setSources]      = useState<Record<string, boolean>>({});
  const [aiLabel,      setAiLabel]      = useState('');
  const [bottomProds,  setBottomProds]  = useState<any[]>([]);
  const [showAllWorst, setShowAllWorst] = useState(false);
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

    const baseline = computeBaselineInsights(spendRes, emailRes, band6Res, campaignsRes, bcRes);
    setInsights(baseline);
    setStatus('analysing');

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
  const actNow       = visible.filter(i => i.severity === 'critical' || i.severity === 'warning');
  const doThisWeek   = visible.filter(i => i.severity === 'opportunity');
  const notes        = visible.filter(i => i.severity === 'info');
  const isLoading    = status === 'fetching' || status === 'analysing';
  const dismissedCnt = [...dismissed].filter(id => insights.some(i => i.id === id)).length;

  // ── Derived values ────────────────────────────────────────────────────────
  const now         = new Date();
  const monthName   = now.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' });
  const dayOfMonth  = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct    = (dayOfMonth / daysInMonth) * 100;

  const monthRecs   = spendData.filter(r => (r.month ?? '').toLowerCase() === monthName.toLowerCase());
  const ppSpent     = monthRecs.filter(r => r.brand === 'Pascal Press'    && (r.channel ?? '').toLowerCase().includes('google')).reduce((s, r) => s + Number(r.actualSpend ?? 0), 0);
  const etzSpent    = monthRecs.filter(r => r.brand === 'Excel Test Zone' && (r.channel ?? '').toLowerCase().includes('google')).reduce((s, r) => s + Number(r.actualSpend ?? 0), 0);

  const allEmails:  any[] = emailSnap?.campaigns ?? emailSnap?.emails ?? [];
  const isETZMail        = (n: string) => /ETZ/i.test(n) || n.toUpperCase().startsWith('ETZ');
  const ppMails          = allEmails.filter(e => !isETZMail(e.name ?? ''));
  const etzMails         = allEmails.filter(e =>  isETZMail(e.name ?? ''));
  const ppAvgOpen        = ppMails.length  ? ppMails.reduce((s, e)  => s + (e.openRate ?? 0), 0) / ppMails.length  : 0;
  const etzAvgOpen       = etzMails.length ? etzMails.reduce((s, e) => s + (e.openRate ?? 0), 0) / etzMails.length : 0;

  const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

  // Brand pulse (only non-dismissed, actionable insights)
  const ppPulse    = brandStatus('pp',    ['pascal press', 'pp google'],                     visible);
  const etzPulse   = brandStatus('etz',   ['excel test zone', 'etz', 'band 6', 'hsc'],       visible);
  const blakePulse = brandStatus('blake', ['blake'],                                         visible);
  // Band 6 / seasonal — separate tile derived from ETZ + seasonal items
  const band6Items = visible.filter(i => i.category === 'band6' || (i.category === 'seasonal' && (i.brand === 'etz' || i.brand === 'all')));
  const band6Dot: 'red' | 'amber' | 'green' = band6Items.some(i => i.severity === 'critical') ? 'red' : band6Items.some(i => i.severity !== 'info') ? 'amber' : 'green';

  const totalActions = actNow.length + doThisWeek.length;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-gray-900">Weekly briefing</h2>
              {aiLabel && (
                <span className="text-[10px] bg-violet-50 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                  {aiLabel}
                </span>
              )}
              {status === 'analysing' && (
                <span className="text-[10px] text-blue-500 flex items-center gap-1 animate-pulse">
                  <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
                  </svg>
                  Claude is analysing…
                </span>
              )}
            </div>
            {status === 'ready' && lastUpdated ? (
              <p className="text-xs text-gray-400 mt-0.5">
                {fmtDate(lastUpdated)} · {fmtTime(lastUpdated)}
                {totalActions > 0 && <span className="ml-1.5 text-gray-500">&middot; {totalActions} action{totalActions !== 1 ? 's' : ''}</span>}
              </p>
            ) : status === 'fetching' ? (
              <p className="text-xs text-blue-400 mt-0.5 animate-pulse">Fetching data…</p>
            ) : null}
            {status === 'error' && <p className="text-xs text-red-500 mt-0.5">{errorMsg}</p>}
          </div>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-5">

        {/* ── Brand Pulse ────────────────────────────────────────────────── */}
        {(status === 'ready' || status === 'analysing') && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Pascal Press',    pulse: ppPulse,    key: 'pp' },
              { label: 'Excel Test Zone', pulse: etzPulse,   key: 'etz' },
              { label: 'Blake Education', pulse: blakePulse, key: 'blake' },
              {
                label: 'Band 6 / HSC',
                pulse: { dot: band6Dot, count: band6Items.filter(i => i.severity !== 'info').length, topIssue: band6Items[0]?.title.slice(0, 48) ?? '' },
                key: 'b6',
              },
            ].map(({ label, pulse, key }) => (
              <div key={key} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5">
                <div className="text-[11px] text-gray-400 mb-1.5 leading-none">{label}</div>
                <div className="flex items-center gap-2">
                  <PulseDot status={pulse.dot} />
                  <span className="text-xs font-semibold text-gray-800">
                    {pulse.dot === 'green' ? 'All clear' : `${pulse.count} action${pulse.count !== 1 ? 's' : ''}`}
                  </span>
                </div>
                {pulse.topIssue && (
                  <div className="text-[10px] text-gray-400 mt-1 leading-tight line-clamp-1">{pulse.topIssue}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Skeletons while fetching */}
        {status === 'fetching' && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* ── Act Now ──────────────────────────────────────────────────────── */}
        {actNow.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full inline-block" />
              Act now · {actNow.length} item{actNow.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {actNow.map(ins => (
                <InsightCard key={ins.id} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        )}

        {/* ── Do this week ─────────────────────────────────────────────────── */}
        {doThisWeek.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-blue-500 rounded-full inline-block" />
              Do this week · {doThisWeek.length}
            </p>
            <div className="space-y-3">
              {doThisWeek.map(ins => (
                <InsightCard key={ins.id} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        )}

        {/* ── Notes ────────────────────────────────────────────────────────── */}
        {notes.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-gray-400 rounded-full inline-block" />
              Notes · {notes.length}
            </p>
            <div className="space-y-3">
              {notes.map(ins => (
                <InsightCard key={ins.id} insight={ins} onDismiss={dismiss} onOpenChat={onOpenChat} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        )}

        {/* ── All-clear ────────────────────────────────────────────────────── */}
        {visible.length === 0 && status === 'ready' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-700">All clear</p>
            <p className="text-xs text-gray-400 mt-1">No actions or issues detected. Check back after campaigns run.</p>
          </div>
        )}

        {/* ── Restore dismissed ────────────────────────────────────────────── */}
        {dismissedCnt > 0 && status === 'ready' && (
          <div className="text-center">
            <button onClick={restoreDismissed} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Restore {dismissedCnt} dismissed item{dismissedCnt !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* ── Worst Performing Products ─────────────────────────────────────── */}
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
                Worst performing products — last 30 days ({bottomProds.length})
              </p>

              {patterns.length > 0 && (
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
                      <button
                        onClick={() => onOpenChat(`Our BigCommerce store has ${pg.count} "${pg.label}" products all underperforming in the last 30 days: ${pg.names.slice(0, 5).join(', ')}. Is this a pricing issue, a visibility/SEO issue, or a seasonal pattern? What specific campaigns should we run to fix this?`)}
                        className="shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Ask Claude
                      </button>
                    </div>
                  ))}
                </div>
              )}

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
                <button
                  onClick={() => setShowAllWorst(v => !v)}
                  className="mt-2.5 text-xs font-medium text-blue-500 hover:text-blue-700 w-full text-center py-1"
                >
                  {showAllWorst ? '↑ Show fewer' : `↓ Show all ${bottomProds.length} products`}
                </button>
              )}
              <p className="text-[10px] text-gray-400 mt-1.5">Rolling 30-day window · updates on refresh</p>
            </section>
          );
        })()}

        {/* ── Quick prompts ─────────────────────────────────────────────────── */}
        {(status === 'ready' || status === 'analysing') && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Ask Claude</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onOpenChat(`It is ${monthName}, day ${dayOfMonth} of ${daysInMonth}. Pascal Press Google Ads: ${fmtMoney(ppSpent)} spent of ${fmtMoney(PP_BUDGET)} budget. Excel Test Zone: ${fmtMoney(etzSpent)} of ${fmtMoney(ETZ_BUDGET)}. Tell me specifically which brand needs the most urgent action, what to change in Google Ads, and give me exact budget adjustments.`)}
                className="text-left text-xs bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl p-3 transition-colors"
              >
                <div className="font-bold text-orange-800 mb-0.5">Google Ads plan</div>
                <div className="text-orange-600 text-[11px]">Budget adjustments for this week</div>
              </button>
              <button
                onClick={() => onOpenChat(`Pascal Press sent ${ppMails.length} email campaigns this month (avg ${(ppAvgOpen * 100).toFixed(1)}% open rate). Excel Test Zone sent ${etzMails.length} (avg ${(etzAvgOpen * 100).toFixed(1)}% open). It is ${monthName} — Term 3 season. What campaigns should each brand send this week? Give me subject lines, send timing, and audience.`)}
                className="text-left text-xs bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl p-3 transition-colors"
              >
                <div className="font-bold text-sky-800 mb-0.5">Email strategy</div>
                <div className="text-sky-600 text-[11px]">PP + ETZ campaigns to send</div>
              </button>
              <button
                onClick={() => {
                  const names = bottomProds.slice(0, 5).map((p: any) => p.name).join(', ');
                  onOpenChat(`Our ${bottomProds.length} worst-performing BigCommerce products last 30 days include: ${names || 'data loading'}. For the top 5, recommend specific actions: a Google Ads ad group, a HubSpot email segment, or a discount offer. Be specific with numbers.`);
                }}
                className="text-left text-xs bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl p-3 transition-colors"
              >
                <div className="font-bold text-emerald-800 mb-0.5">Fix worst products</div>
                <div className="text-emerald-600 text-[11px]">Campaign ideas for slow sellers</div>
              </button>
              <button
                onClick={() => onNavigate('calendar')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3 transition-colors"
              >
                <div className="font-bold text-gray-700 mb-0.5">Campaign calendar</div>
                <div className="text-gray-500 text-[11px]">View and plan all campaigns</div>
              </button>
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
