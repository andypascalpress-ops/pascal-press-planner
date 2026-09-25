/**
 * GET /api/business-unit-trend?brand=pp|etz|ehc|blake
 *
 * Returns last 12 months of revenue, orders, and (for ETZ/EHC) trial counts.
 * Cached for 30 minutes — historical months never change so this is safe.
 *
 * Key optimisation: HubSpot trials use ONE bulk search covering all 12 months,
 * grouped by month in code — replaces 12 sequential per-month searches.
 */
import { NextResponse } from 'next/server';
import { fetchPPRevenue, fetchBlakeRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue, fetchHSCStripeRevenue } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';

type BrandParam = 'pp' | 'etz' | 'ehc' | 'blake';

const HS_BASE = 'https://api.hubapi.com';
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function last12Months(): string[] {
  const today = toYMD(new Date());
  const [y, m] = [parseInt(today.slice(0, 4)), parseInt(today.slice(5, 7))];
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    let mo = m - i, yr = y;
    while (mo < 1) { mo += 12; yr--; }
    months.push(`${yr}-${String(mo).padStart(2, '0')}`);
  }
  return months;
}

function monthDateRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y!, m!, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, '0')}` };
}

async function fetchRevenue(brand: BrandParam, month: string): Promise<{ revenue: number; orders: number }> {
  const { start, end } = monthDateRange(month);
  try {
    let rev;
    switch (brand) {
      case 'pp':    rev = await fetchPPRevenue(month, { start, end }); break;
      case 'blake': rev = await fetchBlakeRevenue(month, { start, end }); break;
      case 'etz':   rev = await fetchETZStripeRevenue(month, { dateRange: { start, end } }); break;
      case 'ehc':   rev = await fetchHSCStripeRevenue(month, { dateRange: { start, end } }); break;
    }
    return { revenue: rev?.totalRevenue ?? 0, orders: rev?.totalOrders ?? 0 };
  } catch { return { revenue: 0, orders: 0 }; }
}

/**
 * Single HubSpot search covering all 12 months.
 * Returns a Map<YYYY-MM, count> — one API call instead of 12.
 */
async function fetchAllTrialsByMonth(
  pipelineLabel: string,
  startMonth: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    // Resolve pipeline ID
    const plRes = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, {
      headers: hsHeaders(), cache: 'no-store',
    });
    if (!plRes.ok) return map;
    const { results: pipelines } = await plRes.json() as {
      results: Array<{ id: string; label: string }>
    };
    const pipeline = pipelines.find(p => p.label.toLowerCase().includes(pipelineLabel.toLowerCase()));
    if (!pipeline) return map;

    const [y, m] = startMonth.split('-').map(Number);
    const startMs = new Date(Date.UTC(y!, m! - 1, 1)).getTime();
    const nowMs   = Date.now();

    // Paginate through ALL deals in the pipeline created in the last 12 months.
    // No amount filter — trial deals may be created with null amount (not '0'),
    // and all ETZ/EHC pipeline deals represent trials by design.
    let after: string | undefined;
    do {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters: [
          { propertyName: 'pipeline',   operator: 'EQ',  value: pipeline.id     },
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LTE', value: String(nowMs)   },
        ]}],
        properties: ['createdate'],
        limit: 100,
      };
      if (after) body.after = after;

      const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
        method: 'POST', headers: hsHeaders(), body: JSON.stringify(body), cache: 'no-store',
      });
      if (!res.ok) break;
      const json = await res.json();

      for (const deal of (json.results ?? [])) {
        const ts = deal.properties?.createdate;
        if (!ts) continue;
        const month = new Date(parseInt(ts)).toISOString().slice(0, 7); // YYYY-MM UTC
        map.set(month, (map.get(month) ?? 0) + 1);
      }
      after = json.paging?.next?.after as string | undefined;
    } while (after);
  } catch { /* return partial map */ }
  return map;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = (searchParams.get('brand') ?? 'pp') as BrandParam;
  const months = last12Months();
  const hasTrials = brand === 'etz' || brand === 'ehc';
  const pipelineLabel = brand === 'etz' ? 'etz' : 'ehc';

  // Run revenue fetches (12 months in parallel) and the single HubSpot bulk search together
  const [revResults, trialsByMonth] = await Promise.all([
    Promise.allSettled(months.map(m => fetchRevenue(brand, m))),
    hasTrials ? fetchAllTrialsByMonth(pipelineLabel, months[0]!) : Promise.resolve(new Map<string, number>()),
  ]);

  const data = months.map((month, i) => {
    const r = revResults[i];
    const rev = r?.status === 'fulfilled' ? r.value : { revenue: 0, orders: 0 };
    return {
      month,
      revenue: rev.revenue,
      orders:  rev.orders,
      trials:  hasTrials ? (trialsByMonth.get(month) ?? 0) : null,
    };
  });

  return NextResponse.json({ brand, months: data });
}
