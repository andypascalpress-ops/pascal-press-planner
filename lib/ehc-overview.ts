/**
 * Excel HSC Copilot picture from HubSpot deals (aggregate counts only, no personal data).
 * Shared by /api/ehc-hubspot-overview (dashboard panel) and the executive-summary PDF.
 *
 * EHC trials are marked with the deal property ehc_deal_type = "Free Trial", not by pipeline stage.
 * Every HubSpot call retries on 429/5xx and this throws rather than returning zeros.
 */
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

const HS = 'https://api.hubapi.com';
const headers = () => ({
  Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
  'Content-Type': 'application/json',
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call(url: string, init?: RequestInit) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { ...init, cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`HubSpot ${r.status}`);
    await sleep(400 * 2 ** i);
  }
  throw new Error('HubSpot request failed after retries');
}

async function count(filters: object[]): Promise<number> {
  const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: headers(), body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }) });
  await sleep(90);
  return j.total as number;
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ms = (ymd: string, hms: string) => String(zonedDateTimeToUnix(ymd, hms) * 1000);

const SOURCE_LABELS: Record<string, string> = {
  ORGANIC_SEARCH: 'Organic search', PAID_SEARCH: 'Paid search', EMAIL_MARKETING: 'Email', SOCIAL_MEDIA: 'Organic social',
  REFERRALS: 'Referrals', OTHER_CAMPAIGNS: 'Other campaigns', DIRECT_TRAFFIC: 'Direct', OFFLINE: 'Offline (system-created)',
  PAID_SOCIAL: 'Paid social', AI_REFERRALS: 'AI referrals',
};

export interface EhcWeekly { week: string; freeTrial: number; newPaid: number; newZero: number; other: number; total: number }

export interface EhcOverview {
  generatedAt: string;
  today: string;
  pipeline: string;
  stages: { label: string; count: number }[];
  weekly: EhcWeekly[];
  trialCreation: { lastFreeTrialWeek: string | null; weeksWithoutFreeTrials: number };
  last30: { freeTrial: number; newPaid: number; newZero: number; total: number };
  dealTypes: Record<string, { current: number; previous: number }>;
  vouchers: number;
  deals30d: { total: number; sources: { source: string; label: string; count: number }[] };
  paidSubscriptions: { deals: number; subjects: { subject: string; count: number }[] };
}

export async function fetchEhcOverview(): Promise<EhcOverview> {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) throw new Error('No HubSpot token configured');

  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: headers() });
  const pipe = (pl.results as { id: string; label: string; stages: { id: string; label: string; displayOrder: number }[] }[])
    .find(p => p.label.toLowerCase().includes('ehc'));
  if (!pipe) throw new Error('EHC pipeline not found');

  const inPipe = { propertyName: 'pipeline', operator: 'EQ', value: pipe.id };
  const activeSub = pipe.stages.find(s => s.label === 'Active Subscription')?.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const created = (s: string, e: string) => [
    { propertyName: 'createdate', operator: 'GTE', value: ms(s, '00:00:00') },
    { propertyName: 'createdate', operator: 'LTE', value: ms(e, '23:59:59') },
  ];
  const type = (t: string) => ({ propertyName: 'ehc_deal_type', operator: 'CONTAINS_TOKEN', value: t });
  const amount = (op: 'EQ' | 'GT', v: string) => ({ propertyName: 'amount', operator: op, value: v });

  // Deals by current stage (all time)
  const stages: { label: string; count: number }[] = [];
  for (const st of [...pipe.stages].sort((a, b) => a.displayOrder - b.displayOrder)) {
    stages.push({ label: st.label, count: await count([inPipe, { propertyName: 'dealstage', operator: 'EQ', value: st.id }]) });
  }

  // Weekly deals created, by type (14 weeks, Monday start, Sydney time)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const weekly: EhcWeekly[] = [];
  for (let w = 13; w >= 0; w--) {
    const s = addDays(monday, -7 * w), e = addDays(s, 6);
    const total = await count([inPipe, ...created(s, e)]);
    const freeTrial = await count([inPipe, ...created(s, e), type('Free Trial')]);
    const newPaid = await count([inPipe, ...created(s, e), type('New Deal'), amount('GT', '0')]);
    const newZero = await count([inPipe, ...created(s, e), type('New Deal'), amount('EQ', '0')]);
    weekly.push({ week: s, freeTrial, newPaid, newZero, other: Math.max(total - freeTrial - newPaid - newZero, 0), total });
  }
  const lastTrialWeek = [...weekly].reverse().find(w => w.freeTrial > 0)?.week ?? null;
  const weeksSinceTrial = lastTrialWeek ? weekly.filter(w => w.week > lastTrialWeek).length : weekly.length;

  // Last 30 days by type
  const d30 = addDays(today, -29);
  const last30 = {
    total: await count([inPipe, ...created(d30, today)]),
    freeTrial: await count([inPipe, ...created(d30, today), type('Free Trial')]),
    newPaid: await count([inPipe, ...created(d30, today), type('New Deal'), amount('GT', '0')]),
    newZero: await count([inPipe, ...created(d30, today), type('New Deal'), amount('EQ', '0')]),
  };

  // Deal types, last 365 days vs the 365 before
  const y1 = addDays(today, -364), y2 = addDays(today, -729), y2e = addDays(today, -365);
  const dealTypes: Record<string, { current: number; previous: number }> = {};
  for (const t of ['Free Trial', 'New Deal', 'Additional Time', 'Additional Subjects']) {
    dealTypes[t] = {
      current: await count([inPipe, ...created(y1, today), type(t)]),
      previous: await count([inPipe, ...created(y2, y2e), type(t)]),
    };
  }

  // Vouchers (deals with a voucher code), all time
  const vouchers = await count([inPipe, { propertyName: 'voucher_code', operator: 'HAS_PROPERTY' }]);

  // Source of deals created in the last 30 days
  const sources: { source: string; label: string; count: number }[] = [];
  for (const key of Object.keys(SOURCE_LABELS)) {
    sources.push({ source: key, label: SOURCE_LABELS[key]!, count: await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'EQ', value: key }]) });
  }
  const noSource = await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'NOT_HAS_PROPERTY' }]);
  if (noSource > 0) sources.push({ source: 'NONE', label: '(no value)', count: noSource });

  // Paid active subscriptions by subject: one paged pull, tallied here
  const subjects: Record<string, number> = {};
  let paidDeals = 0;
  if (activeSub) {
    let after: string | undefined;
    do {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters: [inPipe, { propertyName: 'dealstage', operator: 'EQ', value: activeSub }, amount('GT', '0')] }],
        properties: ['ehc_courses'], limit: 100,
      };
      if (after) body.after = after;
      const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      for (const r of j.results ?? []) {
        paidDeals++;
        for (const c of String(r.properties?.ehc_courses ?? '').split(';').map((x: string) => x.trim()).filter(Boolean)) subjects[c] = (subjects[c] ?? 0) + 1;
      }
      after = j.paging?.next?.after as string | undefined;
      if (after) await sleep(150);
    } while (after);
  }

  return {
    generatedAt: new Date().toISOString(), today, pipeline: pipe.label,
    stages, weekly,
    trialCreation: { lastFreeTrialWeek: lastTrialWeek, weeksWithoutFreeTrials: weeksSinceTrial },
    last30, dealTypes, vouchers,
    deals30d: { total: last30.total, sources },
    paidSubscriptions: {
      deals: paidDeals,
      subjects: Object.entries(subjects).map(([subject, n]) => ({ subject, count: n })).sort((a, b) => b.count - a.count),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Light-weight helpers for the executive summary: this month's deals only, no all-time scans.
// ---------------------------------------------------------------------------------------------------------

async function ehcPipelineId(): Promise<string> {
  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: headers() });
  const pipe = (pl.results as { id: string; label: string }[]).find(p => p.label.toLowerCase().includes('ehc'));
  if (!pipe) throw new Error('EHC pipeline not found');
  return pipe.id;
}

export interface EhcMonthDeals {
  total: number;
  freeTrial: number;
  newPaid: number;
  newZero: number;
  /** Paid deals created in the window, tallied by EHC course (a deal covering several subjects counts once per subject). */
  subjects: { subject: string; count: number }[];
}

/** Deals created in [start, end] (YYYY-MM-DD, Sydney): counts by type plus paid deals by subject. */
export async function fetchEhcMonthDeals(start: string, end: string): Promise<EhcMonthDeals> {
  const pipelineId = await ehcPipelineId();
  const inPipe = { propertyName: 'pipeline', operator: 'EQ', value: pipelineId };
  const window = [
    { propertyName: 'createdate', operator: 'GTE', value: ms(start, '00:00:00') },
    { propertyName: 'createdate', operator: 'LTE', value: ms(end, '23:59:59') },
  ];
  const type = (t: string) => ({ propertyName: 'ehc_deal_type', operator: 'CONTAINS_TOKEN', value: t });
  const amount = (op: 'EQ' | 'GT', v: string) => ({ propertyName: 'amount', operator: op, value: v });

  const total = await count([inPipe, ...window]);
  const freeTrial = await count([inPipe, ...window, type('Free Trial')]);
  const newPaid = await count([inPipe, ...window, type('New Deal'), amount('GT', '0')]);
  const newZero = await count([inPipe, ...window, type('New Deal'), amount('EQ', '0')]);

  const tally: Record<string, number> = {};
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters: [inPipe, ...window, amount('GT', '0')] }],
      properties: ['ehc_courses'], limit: 100,
    };
    if (after) body.after = after;
    const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    for (const r of j.results ?? []) {
      for (const c of String(r.properties?.ehc_courses ?? '').split(';').map((x: string) => x.trim()).filter(Boolean)) tally[c] = (tally[c] ?? 0) + 1;
    }
    after = j.paging?.next?.after as string | undefined;
    if (after) await sleep(150);
  } while (after);

  return {
    total, freeTrial, newPaid, newZero,
    subjects: Object.entries(tally).map(([subject, n]) => ({ subject, count: n })).sort((a, b) => b.count - a.count),
  };
}

/** Sydney date (YYYY-MM-DD) of the most recent Free Trial deal, or null if there has never been one. */
export async function fetchLastFreeTrialDate(): Promise<string | null> {
  const pipelineId = await ehcPipelineId();
  const j = await call(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: pipelineId },
        { propertyName: 'ehc_deal_type', operator: 'CONTAINS_TOKEN', value: 'Free Trial' },
      ] }],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      properties: ['createdate'], limit: 1,
    }),
  });
  const created = j.results?.[0]?.properties?.createdate as string | undefined;
  return created ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(created)) : null;
}
