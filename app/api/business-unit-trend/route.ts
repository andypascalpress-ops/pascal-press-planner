/**
 * GET /api/business-unit-trend?brand=pp|etz|ehc|blake
 *
 * Returns last 12 months of revenue, orders, and (for ETZ/EHC) trial counts.
 * Used for the month-on-month trend chart in the Business Units tab.
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

async function resolvePipelineId(pipelineLabel: string): Promise<string | null> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, {
      headers: hsHeaders(), cache: 'no-store',
    });
    if (!res.ok) return null;
    const { results } = await res.json() as { results: Array<{ id: string; label: string }> };
    return results.find(p => p.label.toLowerCase().includes(pipelineLabel.toLowerCase()))?.id ?? null;
  } catch { return null; }
}

async function fetchHubSpotTrialsForMonth(
  month: string, pipelineId: string
): Promise<number> {
  try {
    const [y, m] = month.split('-').map(Number);
    const startMs = new Date(Date.UTC(y!, m! - 1, 1)).getTime();
    const endMs   = new Date(Date.UTC(y!, m!,     1)).getTime();

    const search = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId     },
          { propertyName: 'amount',     operator: 'EQ',  value: '0'            },
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
        ]}],
        limit: 1,
      }),
      cache: 'no-store',
    });
    if (!search.ok) return 0;
    const { total } = await search.json() as { total: number };
    return total ?? 0;
  } catch { return 0; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = (searchParams.get('brand') ?? 'pp') as BrandParam;
  const months = last12Months();
  const hasTrials = brand === 'etz' || brand === 'ehc';
  const pipelineLabel = brand === 'etz' ? 'etz' : 'ehc';

  // Resolve pipeline ID once, then fan out per-month deal searches
  const pipelineId = hasTrials ? await resolvePipelineId(pipelineLabel) : null;

  // Fetch all months in parallel — revenue for every brand, trials for ETZ/EHC
  // Stagger HubSpot calls slightly (200ms apart) to avoid 429s
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const results = await Promise.allSettled(
    months.map(async (month, i) => {
      if (hasTrials && pipelineId) {
        if (i > 0) await delay(i * 120); // stagger HubSpot searches
        return Promise.all([fetchRevenue(brand, month), fetchHubSpotTrialsForMonth(month, pipelineId)]);
      }
      return Promise.all([fetchRevenue(brand, month)]);
    })
  );

  const data = months.map((month, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return { month, revenue: 0, orders: 0, trials: null };
    const [rev, trials] = r.value as [{ revenue: number; orders: number }, number?];
    return {
      month,
      revenue: rev.revenue,
      orders:  rev.orders,
      trials:  trials ?? null,
    };
  });

  return NextResponse.json({ brand, months: data });
}
