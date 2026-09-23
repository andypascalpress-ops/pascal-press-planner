/**
 * GET /api/business-unit?brand=pp|etz|ehc|blake&range=today|yesterday|last7|last30|mtd|lastmonth&yoy=false
 *
 * Returns current-period and comparison-period metrics for one business unit,
 * plus a 7-day revenue sparkline and product breakdown.
 *
 * ETZ and EHC also include Stripe subscription metrics (MRR, active, trialing).
 */
import { NextResponse } from 'next/server';
import { fetchPPRevenue, fetchBlakeRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue, fetchHSCStripeRevenue } from '@/lib/stripe-revenue';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchMetaSpend, META_PP_ACCOUNT_ID, META_ETZ_ACCOUNT_ID, type MetaCampaignFilter } from '@/lib/meta-ads';
import { PP_CHATGPT_SPEND, ETZ_CHATGPT_SPEND } from '@/lib/constants';

export const dynamic = 'force-dynamic';

type BrandParam = 'pp' | 'etz' | 'ehc' | 'blake';
type RangeParam = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';

const ETZ_START_MONTH = '2026-07';

const BC_BASE = 'https://api.bigcommerce.com/stores';
const PP_HASH  = process.env.BIGCOMMERCE_STORE_HASH        ?? '';
const PP_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN      ?? '';
const BL_HASH  = process.env.BIGCOMMERCE_BLAKE_STORE_HASH  ?? '';
const BL_TOKEN = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function subDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function subMonths(ymd: string, n: number): string {
  const [y, m, day] = ymd.split('-').map(Number);
  let nm = m! - n, ny = y!;
  while (nm < 1) { nm += 12; ny--; }
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day!, lastDay)).padStart(2, '0')}`;
}

function getMonth(ymd: string): string { return ymd.slice(0, 7); }

function deriveRange(range: RangeParam) {
  const today = toYMD(new Date());
  const [aY, aM] = [parseInt(today.slice(0, 4)), parseInt(today.slice(5, 7))];
  const dIM = (y: number, m: number) => new Date(y, m, 0).getDate();

  switch (range) {
    case 'today':
      return { start: today, end: today, label: 'Today' };
    case 'yesterday': {
      const s = subDays(today, 1);
      return { start: s, end: s, label: 'Yesterday' };
    }
    case 'last7': {
      return { start: subDays(today, 6), end: today, label: 'Last 7 days' };
    }
    case 'last30': {
      return { start: subDays(today, 29), end: today, label: 'Last 30 days' };
    }
    case 'lastmonth': {
      const lmY = aM === 1 ? aY - 1 : aY;
      const lmM = aM === 1 ? 12 : aM - 1;
      const mo  = `${lmY}-${String(lmM).padStart(2, '0')}`;
      const days = dIM(lmY, lmM);
      const label = new Date(`${mo}-15T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return { start: `${mo}-01`, end: `${mo}-${String(days).padStart(2, '0')}`, label };
    }
    case 'mtd':
    default: {
      const mo = today.slice(0, 7);
      return { start: `${mo}-01`, end: today, label: 'Month to date' };
    }
  }
}

function getComparisonRange(range: RangeParam, start: string, end: string, yoy: boolean) {
  if (yoy) {
    const shiftYear = (ymd: string) => `${parseInt(ymd.slice(0, 4)) - 1}${ymd.slice(4)}`;
    return { start: shiftYear(start), end: shiftYear(end), label: 'vs same period last year' };
  }
  switch (range) {
    case 'today':
    case 'yesterday': {
      const cs = subMonths(start, 1);
      return { start: cs, end: cs, label: 'vs same day last month' };
    }
    case 'last7': {
      return { start: subDays(start, 7), end: subDays(start, 1), label: 'vs prev 7 days' };
    }
    case 'last30': {
      return { start: subDays(start, 30), end: subDays(start, 1), label: 'vs prev 30 days' };
    }
    case 'mtd': {
      return { start: subMonths(start, 1), end: subMonths(end, 1), label: 'vs same MTD last month' };
    }
    case 'lastmonth': {
      const [y, m] = start.split('-').map(Number);
      const ny = y! - 1;
      const nm = String(m).padStart(2, '0');
      const days = new Date(ny, m!, 0).getDate();
      return { start: `${ny}-${nm}-01`, end: `${ny}-${nm}-${String(days).padStart(2, '0')}`, label: 'vs same month last year' };
    }
    default:
      return { start, end, label: '' };
  }
}

async function fetchBCProductBreakdown(
  hash: string, token: string, start: string, end: string
): Promise<{ name: string; revenue: number; orders: number; pct: number }[]> {
  if (!hash || !token) return [];
  try {
    const startISO = new Date(`${start}T00:00:00+10:00`).toISOString();
    const endISO   = new Date(`${end}T23:59:59+10:00`).toISOString();
    const url = `${BC_BASE}/${hash}/v2/orders?min_date_created=${encodeURIComponent(startISO)}&max_date_created=${encodeURIComponent(endISO)}&limit=50&sort=date_created:desc`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const orders: { id: number }[] = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) return [];

    const productResults = await Promise.allSettled(
      orders.map(o =>
        fetch(`${BC_BASE}/${hash}/v2/orders/${o.id}/products`, {
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          cache: 'no-store',
        }).then(r => r.ok ? r.json() : [])
      )
    );

    const map = new Map<string, { revenue: number; qty: number }>();
    for (const r of productResults) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const p of r.value as { name: string; total_inc_tax: string }[]) {
        const rev   = parseFloat(p.total_inc_tax ?? '0');
        const entry = map.get(p.name) ?? { revenue: 0, qty: 0 };
        map.set(p.name, { revenue: entry.revenue + rev, qty: entry.qty + 1 });
      }
    }

    const total = Array.from(map.values()).reduce((s, v) => s + v.revenue, 0);
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, revenue: v.revenue, orders: v.qty, pct: total > 0 ? Math.round((v.revenue / total) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);
  } catch {
    return [];
  }
}

async function fetchStripeProductBreakdown(
  key: string, start: string, end: string
): Promise<{ name: string; revenue: number; orders: number; pct: number }[]> {
  if (!key) return [];
  try {
    const gte = Math.floor(new Date(`${start}T00:00:00+10:00`).getTime() / 1000);
    const lte = Math.floor(new Date(`${end}T23:59:59+10:00`).getTime() / 1000);
    const res = await fetch(
      `https://api.stripe.com/v1/charges?created[gte]=${gte}&created[lte]=${lte}&limit=100`,
      { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const { data: charges } = await res.json() as {
      data: { status: string; description: string | null; amount: number; amount_refunded: number }[]
    };

    const map = new Map<string, { revenue: number; cnt: number }>();
    for (const c of charges) {
      if (c.status !== 'succeeded') continue;
      const net = (c.amount - (c.amount_refunded ?? 0)) / 100;
      if (net <= 0) continue;
      const name  = c.description || 'Other';
      const entry = map.get(name) ?? { revenue: 0, cnt: 0 };
      map.set(name, { revenue: entry.revenue + net, cnt: entry.cnt + 1 });
    }

    const total = Array.from(map.values()).reduce((s, v) => s + v.revenue, 0);
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, revenue: v.revenue, orders: v.cnt, pct: total > 0 ? Math.round((v.revenue / total) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);
  } catch {
    return [];
  }
}

const HS_BASE = 'https://api.hubapi.com';
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function fetchHubSpotCurrentTrials(pipelineLabel: string): Promise<number> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, {
      headers: hsHeaders(), cache: 'no-store',
    });
    if (!res.ok) return 0;
    const { results } = await res.json() as {
      results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }>
    };
    const pipeline = results.find(p => p.label.toLowerCase().includes(pipelineLabel.toLowerCase()));
    if (!pipeline) return 0;
    const trialStage = pipeline.stages.find(s =>
      s.label.toLowerCase().includes('active trial') || s.label.toLowerCase() === 'trial'
    );
    if (!trialStage) return 0;
    const search = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: trialStage.id }] }], limit: 1 }),
      cache: 'no-store',
    });
    if (!search.ok) return 0;
    const { total } = await search.json() as { total: number };
    return total ?? 0;
  } catch { return 0; }
}

async function fetchStripeSubscriptionMetrics(key: string, brand: BrandParam) {
  if (!key) return null;
  try {
    const activeRes = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
    }).then(r => r.json());

    type StripeSub = { items: { data: { price: { unit_amount: number; recurring: { interval: string; interval_count: number } } }[] } };
    const activeData: StripeSub[] = activeRes.data ?? [];

    let mrr = 0;
    for (const sub of activeData) {
      const item = sub.items?.data?.[0];
      if (!item) continue;
      const amt      = item.price?.unit_amount ?? 0;
      const interval = item.price?.recurring?.interval ?? 'month';
      const count    = item.price?.recurring?.interval_count ?? 1;
      if (interval === 'month') mrr += (amt / 100) / count;
      else if (interval === 'year') mrr += (amt / 100) / 12;
    }

    // ETZ and EHC trials are tracked as HubSpot deals ($0 in their pipeline),
    // not as Stripe trialing subscriptions — fetch the real count from HubSpot.
    const pipelineLabel = brand === 'etz' ? 'etz' : 'ehc';
    const currentlyOnTrial = await fetchHubSpotCurrentTrials(pipelineLabel);

    return { active: activeData.length, trialing: currentlyOnTrial, mrr: Math.round(mrr) };
  } catch {
    return null;
  }
}

type RevData = { totalRevenue: number; totalOrders: number; newCustomers: number; returningCustomers: number } | null;

function buildMetrics(rev: RevData, spend: number) {
  const revenue          = rev?.totalRevenue        ?? 0;
  const orders           = rev?.totalOrders         ?? 0;
  const newCustomers     = rev?.newCustomers         ?? 0;
  const returningCustomers = rev?.returningCustomers ?? 0;
  const roas             = spend > 0 ? Math.round((revenue / spend) * 10) / 10 : 0;
  const aov              = orders > 0 ? Math.round(revenue / orders) : 0;
  const cac: number | null = newCustomers > 0 ? Math.round(spend / newCustomers) : null;
  return { revenue, spend, roas, orders, aov, newCustomers, returningCustomers, cac };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = (searchParams.get('brand') ?? 'pp') as BrandParam;
  const range = (searchParams.get('range') ?? 'last7') as RangeParam;
  const yoy   = searchParams.get('yoy') === 'true';

  const cur  = deriveRange(range);
  const comp = getComparisonRange(range, cur.start, cur.end, yoy);
  const curMonth  = getMonth(cur.end);
  const compMonth = getMonth(comp.end);

  let ppCfg:  ReturnType<typeof buildConfig> | undefined;
  let etzCfg: ReturnType<typeof buildConfig> | undefined;
  let hscCfg: ReturnType<typeof buildConfig> | undefined;
  try { ppCfg  = buildConfig('pp');  } catch { /* no config */ }
  try { etzCfg = buildConfig('etz'); } catch { /* no config */ }
  try { hscCfg = buildConfig('hsc'); } catch { /* no config */ }

  const STRIPE_ETZ = process.env.STRIPE_SECRET_KEY      ?? '';
  const STRIPE_HSC = process.env.STRIPE_HSC_SECRET_KEY  ?? '';

  // Fetch revenue for the brand over a given date window
  async function fetchRev(s: string, e: string): Promise<RevData> {
    const m = getMonth(e);
    try {
      switch (brand) {
        case 'pp':    return await fetchPPRevenue(m, { start: s, end: e });
        case 'etz':   return await fetchETZStripeRevenue(m, { dateRange: { start: s, end: e } });
        case 'ehc':   return await fetchHSCStripeRevenue(m, { dateRange: { start: s, end: e } });
        case 'blake': return await fetchBlakeRevenue(m, { start: s, end: e });
      }
    } catch { return null; }
  }

  // Fetch total ad spend for the brand over a given date window
  async function fetchSpend(s: string, e: string, m: string): Promise<number> {
    const chatgptPP  = PP_CHATGPT_SPEND[m]  ?? 0;
    const chatgptETZ = ETZ_CHATGPT_SPEND[m] ?? 0;
    const useOwnEtz  = m >= ETZ_START_MONTH;
    try {
      switch (brand) {
        case 'pp': {
          const [gAds, meta] = await Promise.all([
            ppCfg
              ? fetchMonthlySpend(ppCfg, s, e, { excludes: 'ETZ' }).then(r => r.reduce((a, v) => a + v.actualSpend, 0))
              : Promise.resolve(0),
            fetchMetaSpend(META_PP_ACCOUNT_ID, s, e, { excludes: 'ETZ' } satisfies MetaCampaignFilter).catch(() => 0),
          ]);
          return gAds + meta + chatgptPP;
        }
        case 'etz': {
          const [gAds, meta] = await Promise.all([
            (useOwnEtz && etzCfg)
              ? fetchMonthlySpend(etzCfg, s, e).then(r => r.reduce((a, v) => a + v.actualSpend, 0))
              : ppCfg
                ? fetchMonthlySpend(ppCfg, s, e, { contains: 'ETZ' }).then(r => r.reduce((a, v) => a + v.actualSpend, 0))
                : Promise.resolve(0),
            fetchMetaSpend(META_ETZ_ACCOUNT_ID, s, e, { contains: 'ETZ' } satisfies MetaCampaignFilter).catch(() => 0),
          ]);
          return gAds + meta + chatgptETZ;
        }
        case 'ehc':
          return hscCfg
            ? (await fetchMonthlySpend(hscCfg, s, e)).reduce((a, v) => a + v.actualSpend, 0)
            : 0;
        case 'blake':
          return 0;
      }
    } catch { return 0; }
  }

  // 7-day sparkline: one revenue fetch per day, always last 7 days
  const today     = toYMD(new Date());
  const sparkDays = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i));

  const [curRevR, compRevR, curSpendR, compSpendR, productsR, subsR, ...sparkR] =
    await Promise.allSettled([
      fetchRev(cur.start, cur.end),
      fetchRev(comp.start, comp.end),
      fetchSpend(cur.start, cur.end, curMonth),
      fetchSpend(comp.start, comp.end, compMonth),
      brand === 'pp'    ? fetchBCProductBreakdown(PP_HASH, PP_TOKEN, cur.start, cur.end)
        : brand === 'blake' ? fetchBCProductBreakdown(BL_HASH, BL_TOKEN, cur.start, cur.end)
        : brand === 'etz'   ? fetchStripeProductBreakdown(STRIPE_ETZ, cur.start, cur.end)
        :                     fetchStripeProductBreakdown(STRIPE_HSC, cur.start, cur.end),
      (brand === 'etz' || brand === 'ehc')
        ? fetchStripeSubscriptionMetrics(brand === 'etz' ? STRIPE_ETZ : STRIPE_HSC, brand)
        : Promise.resolve(null),
      ...sparkDays.map(d => fetchRev(d, d)),
    ]);

  const curRev    = curRevR.status    === 'fulfilled' ? curRevR.value    : null;
  const compRev   = compRevR.status   === 'fulfilled' ? compRevR.value   : null;
  const curSpend  = curSpendR.status  === 'fulfilled' ? curSpendR.value  : 0;
  const compSpend = compSpendR.status === 'fulfilled' ? compSpendR.value : 0;
  const products  = productsR.status  === 'fulfilled' ? productsR.value  : [];
  const subs      = subsR.status      === 'fulfilled' ? subsR.value      : null;

  const sparkline = sparkDays.map((date, i) => ({
    date,
    revenue: sparkR[i]?.status === 'fulfilled'
      ? ((sparkR[i] as PromiseFulfilledResult<RevData>).value?.totalRevenue ?? 0)
      : 0,
  }));

  return NextResponse.json({
    brand, range, yoy,
    period:      { start: cur.start,  end: cur.end,  label: cur.label  },
    comparison:  { start: comp.start, end: comp.end, label: comp.label },
    current:     buildMetrics(curRev,  curSpend),
    prev:        buildMetrics(compRev, compSpend),
    products,
    subscriptions: subs,
    sparkline,
    connected: true,
  });
}
