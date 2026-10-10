/**
 * GET /api/ehc-hubspot-overview
 *
 * Excel HSC Copilot picture from HubSpot (aggregate counts only, no personal data), mirroring what the
 * "Excel HSC Copilot (Deals)" HubSpot dashboard shows, plus a weekly view that makes pipeline changes visible:
 *  - deals by current pipeline stage (all time)
 *  - deals created per week by type: Free Trial / New Deal (paid) / New Deal ($0)
 *  - paid active subscriptions by subject (Active Subscription deals with amount > $0, by EHC course)
 *  - vouchers, deal types over 365 days, and how last-30-day deals are sourced
 *
 * EHC trials are marked with the deal property ehc_deal_type = "Free Trial", not by pipeline stage.
 * Every HubSpot call retries on 429/5xx and the route fails loudly rather than returning zeros.
 */
import { NextResponse } from 'next/server';
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }
  try {
    const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: headers() });
    const pipe = (pl.results as { id: string; label: string; stages: { id: string; label: string; displayOrder: number }[] }[])
      .find(p => p.label.toLowerCase().includes('ehc'));
    if (!pipe) return NextResponse.json({ connected: false, error: 'EHC pipeline not found' }, { status: 404 });

    const inPipe = { propertyName: 'pipeline', operator: 'EQ', value: pipe.id };
    const stage = (label: string) => pipe.stages.find(s => s.label === label)?.id;
    const activeSub = stage('Active Subscription');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    const created = (s: string, e: string) => [
      { propertyName: 'createdate', operator: 'GTE', value: ms(s, '00:00:00') },
      { propertyName: 'createdate', operator: 'LTE', value: ms(e, '23:59:59') },
    ];
    const type = (t: string) => ({ propertyName: 'ehc_deal_type', operator: 'CONTAINS_TOKEN', value: t });
    const amount = (op: 'EQ' | 'GT', v: string) => ({ propertyName: 'amount', operator: op, value: v });

    // 1. Deals by current stage (all time)
    const stages: { label: string; count: number }[] = [];
    for (const st of [...pipe.stages].sort((a, b) => a.displayOrder - b.displayOrder)) {
      stages.push({ label: st.label, count: await count([inPipe, { propertyName: 'dealstage', operator: 'EQ', value: st.id }]) });
    }

    // 2. Weekly deals created, by type (14 weeks, Monday start, Sydney time)
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = addDays(today, -((dow + 6) % 7));
    const weekly: { week: string; freeTrial: number; newPaid: number; newZero: number; other: number; total: number }[] = [];
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

    // 3. Deal types, last 365 days vs the 365 before
    const y1 = addDays(today, -364), y2 = addDays(today, -729), y2e = addDays(today, -365);
    const dealTypes: Record<string, { current: number; previous: number }> = {};
    for (const t of ['Free Trial', 'New Deal', 'Additional Time', 'Additional Subjects']) {
      dealTypes[t] = {
        current: await count([inPipe, ...created(y1, today), type(t)]),
        previous: await count([inPipe, ...created(y2, y2e), type(t)]),
      };
    }

    // 4. Vouchers (deals with a voucher code), all time
    const vouchers = await count([inPipe, { propertyName: 'voucher_code', operator: 'HAS_PROPERTY' }]);

    // 5. Source of deals created in the last 30 days
    const d30 = addDays(today, -29);
    const sources: { source: string; label: string; count: number }[] = [];
    for (const key of Object.keys(SOURCE_LABELS)) {
      sources.push({ source: key, label: SOURCE_LABELS[key]!, count: await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'EQ', value: key }]) });
    }
    const noSource = await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'NOT_HAS_PROPERTY' }]);
    if (noSource > 0) sources.push({ source: 'NONE', label: '(no value)', count: noSource });
    const deals30 = await count([inPipe, ...created(d30, today)]);

    // 6. Paid active subscriptions by subject: one paged pull, tallied here
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

    return NextResponse.json(
      {
        connected: true, generatedAt: new Date().toISOString(), today,
        pipeline: pipe.label,
        stages,
        weekly,
        trialCreation: { lastFreeTrialWeek: lastTrialWeek, weeksWithoutFreeTrials: weeksSinceTrial },
        dealTypes,
        vouchers,
        deals30d: { total: deals30, sources },
        paidSubscriptions: {
          deals: paidDeals,
          subjects: Object.entries(subjects).map(([subject, n]) => ({ subject, count: n })).sort((a, b) => b.count - a.count),
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=600' } },
    );
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : 'Failed to load' }, { status: 502 });
  }
}
