import { NextResponse } from 'next/server';
import { zonedDateTimeToUnix } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HS = 'https://api.hubapi.com';
const H = () => ({ Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`, 'Content-Type': 'application/json' });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call(url: string, init?: RequestInit) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { ...init, cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`);
    await sleep(400 * 2 ** i);
  }
  throw new Error(`failed ${url}`);
}

async function count(filters: object[]) {
  const j = await call(`${HS}/crm/v3/objects/deals/search`, { method: 'POST', headers: H(), body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }) });
  await sleep(100);
  return j.total as number;
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ms = (ymd: string, hms: string) => String(zonedDateTimeToUnix(ymd, hms) * 1000);

// Aggregate counts only: no names, emails or deal ids.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const part = sp.get('part') ?? 'weekly';
  const pl = await call(`${HS}/crm/v3/pipelines/deals`, { headers: H() });
  const pipe = (pl.results as { id: string; label: string; stages: { id: string; label: string }[] }[]).find(p => p.label.toLowerCase().includes('ehc'))!;
  const stageId = (label: string) => pipe.stages.find(s => s.label === label)!.id;
  const inPipe = { propertyName: 'pipeline', operator: 'EQ', value: pipe.id };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const created = (s: string, e: string) => [
    { propertyName: 'createdate', operator: 'GTE', value: ms(s, '00:00:00') },
    { propertyName: 'createdate', operator: 'LTE', value: ms(e, '23:59:59') },
  ];
  const type = (t: string) => ({ propertyName: 'ehc_deal_type', operator: 'CONTAINS_TOKEN', value: t });
  const TYPES = ['Free Trial', 'New Deal', 'Additional Time', 'Additional Subjects'];

  if (part === 'weekly') {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = addDays(today, -((dow + 6) % 7));
    const rows = [];
    for (let w = 13; w >= 0; w--) {
      const s = addDays(monday, -7 * w), e = addDays(s, 6);
      const row: Record<string, unknown> = { week: s, all: await count([inPipe, ...created(s, e)]) };
      for (const t of TYPES) row[t] = await count([inPipe, ...created(s, e), type(t)]);
      row['noType'] = await count([inPipe, ...created(s, e), { propertyName: 'ehc_deal_type', operator: 'NOT_HAS_PROPERTY' }]);
      rows.push(row);
    }
    return NextResponse.json({ rows });
  }

  if (part === 'misc') {
    const out: Record<string, unknown> = {};
    out.vouchersAllTime = await count([inPipe, { propertyName: 'voucher_code', operator: 'HAS_PROPERTY' }]);
    const y1 = addDays(today, -364), y2 = addDays(today, -729), y2e = addDays(today, -365);
    const dt365: Record<string, { cur: number; prev: number }> = {};
    for (const t of TYPES) dt365[t] = { cur: await count([inPipe, ...created(y1, today), type(t)]), prev: await count([inPipe, ...created(y2, y2e), type(t)]) };
    out.dealTypes365 = dt365;
    const d30 = addDays(today, -29);
    const src: Record<string, number> = {};
    for (const s of ['ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'REFERRALS', 'OTHER_CAMPAIGNS', 'DIRECT_TRAFFIC', 'OFFLINE', 'PAID_SOCIAL', 'AI_REFERRALS']) {
      src[s] = await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'EQ', value: s }]);
    }
    out.sources30d_allDeals = src;
    out.sourcesNoValue30d = await count([inPipe, ...created(d30, today), { propertyName: 'hs_analytics_source', operator: 'NOT_HAS_PROPERTY' }]);
    const sub30: Record<string, number> = {};
    for (const t of TYPES) sub30[t] = await count([inPipe, ...created(d30, today), { propertyName: 'dealstage', operator: 'EQ', value: stageId('Active Subscription') }, type(t)]);
    out.activeSubscription30dByType = sub30;
    out.activeSubscriptionAllTimeByType = Object.fromEntries(await Promise.all(TYPES.map(async t => [t, await count([inPipe, { propertyName: 'dealstage', operator: 'EQ', value: stageId('Active Subscription') }, type(t)])])));
    return NextResponse.json(out);
  }

  if (part === 'probe') {
    const course = (sp.get('course') ?? 'Biology');
    const f = { propertyName: 'ehc_courses', operator: 'CONTAINS_TOKEN', value: course };
    const stage = { propertyName: 'dealstage', operator: 'EQ', value: stageId('Active Subscription') };
    const out: Record<string, number> = {};
    for (const d of [30, 60, 90, 120, 150, 180, 270, 365, 540]) out[`last${d}d`] = await count([inPipe, stage, f, ...created(addDays(today, -(d - 1)), today)]);
    for (const since of ['2026-01-01', '2026-07-01', '2025-07-01', '2025-10-01', '2026-04-01']) out[`since${since}`] = await count([inPipe, stage, f, ...created(since, today)]);
    out.withVoucher = await count([inPipe, stage, f, { propertyName: 'voucher_code', operator: 'HAS_PROPERTY' }]);
    out.withoutVoucher = await count([inPipe, stage, f, { propertyName: 'voucher_code', operator: 'NOT_HAS_PROPERTY' }]);
    out.amountPositive = await count([inPipe, stage, f, { propertyName: 'amount', operator: 'GT', value: '0' }]);
    out.amountZero = await count([inPipe, stage, f, { propertyName: 'amount', operator: 'EQ', value: '0' }]);
    return NextResponse.json({ course, ...out });
  }

  // subjects: Active Subscription deals per EHC course
  const props = await call(`${HS}/crm/v3/properties/deals/ehc_courses`, { headers: H() });
  const courses = (props.options as { value: string }[]).map(o => o.value);
  const res: Record<string, { active: number; expiredTrial: number }> = {};
  for (const c of courses) {
    const f = { propertyName: 'ehc_courses', operator: 'CONTAINS_TOKEN', value: c };
    res[c] = {
      active: await count([inPipe, { propertyName: 'dealstage', operator: 'EQ', value: stageId('Active Subscription') }, f]),
      expiredTrial: await count([inPipe, { propertyName: 'dealstage', operator: 'EQ', value: stageId('Expired Trial') }, f]),
    };
  }
  return NextResponse.json({ courses: res });
}
