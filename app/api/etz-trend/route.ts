/**
 * GET /api/etz-trend?months=12
 *
 * Returns N months of ETZ funnel data for the trend chart:
 *   { month, label, sessions, trials, orders, revenue }[]
 *
 * Sources:
 *   sessions – GA4 ETZ property (single call, yearMonth dimension)
 *   trials   – HubSpot amount=$0 in ETZ pipeline (sequential, one call/month)
 *   orders   – Stripe ETZ (parallel calls per month)
 */
import { NextResponse }              from 'next/server';
import { fetchEtzMonthlySessions }   from '@/lib/google-analytics';
import { fetchETZStripeRevenue }     from '@/lib/stripe-revenue';

// Cache for 30 minutes — historical months don't change; current month refreshes hourly
export const revalidate = 1800;
// Allow up to 60 seconds — sequential HubSpot + Stripe calls across 12 months need the headroom
export const maxDuration = 60;

const HS_BASE = 'https://api.hubapi.com';
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

/** Build list of YYYY-MM strings ending with the current month. */
function buildMonths(count: number): string[] {
  const now    = new Date();
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function monthToEpochRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    startMs: new Date(Date.UTC(y!, m! - 1, 1)).getTime(),
    endMs:   new Date(Date.UTC(y!, m!,     1)).getTime(),
    startDate: `${y}-${String(m).padStart(2, '0')}-01`,
    endDate:   (() => {
      const last = new Date(Date.UTC(y!, m!, 0));
      return `${y}-${String(m).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
    })(),
  };
}

function monthLabel(ym: string): string {
  const [, m] = ym.split('-');
  return MONTH_ABBR[parseInt(m ?? '1', 10) - 1] ?? ym;
}

async function hsCountTrials(
  pipelineId: string,
  startMs:    number,
  endMs:      number,
): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
          { propertyName: 'pipeline',   operator: 'EQ',  value: pipelineId      },
          { propertyName: 'amount',     operator: 'EQ',  value: '0'             },
        ],
      }],
      limit: 1,
      properties: ['dealstage'],
    }),
    cache: 'no-store',
  });
  if (!res.ok) return 0;
  const json = await res.json();
  return (json.total as number) ?? 0;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const monthCount = Math.min(parseInt(searchParams.get('months') ?? '12', 10), 24);
  const months     = buildMonths(monthCount);

  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // ── 1. GA4 sessions — single call covering full range ────────────────────
  const firstMonth = months[0]!;
  const lastMonth  = months[months.length - 1]!;
  const { startDate: ga4Start } = monthToEpochRange(firstMonth);
  const { endDate:   ga4End   } = monthToEpochRange(lastMonth);

  // Run GA4 sessions + HubSpot pipeline lookup in parallel
  const [ga4Rows, pipelineId] = await Promise.all([
    fetchEtzMonthlySessions(ga4Start, ga4End).catch(() => []),
    fetch(`${HS_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(), cache: 'no-store' })
      .then(async res => {
        if (!res.ok) return '';
        const json = await res.json();
        const pipelines = (json.results ?? []) as Array<{ id: string; label: string }>;
        return pipelines.find(p => p.label.toLowerCase().includes('etz'))?.id ?? '';
      })
      .catch(() => ''),
  ]);

  const sessionsByMonth: Record<string, number> = {};
  for (const r of ga4Rows) sessionsByMonth[r.month] = r.sessions;

  // ── 3. HubSpot trials — sequential with small delay to respect rate limits ──
  const trialsByMonth: Record<string, number> = {};
  if (pipelineId) {
    for (const month of months) {
      const { startMs, endMs } = monthToEpochRange(month);
      trialsByMonth[month] = await hsCountTrials(pipelineId, startMs, endMs);
      if (month !== months[months.length - 1]) await delay(120);
    }
  }

  // ── 4. Stripe orders — parallel across all months (no rate-limit concern) ──
  const ordersByMonth:   Record<string, number> = {};
  const revenueByMonth:  Record<string, number> = {};
  const stripeResults = await Promise.allSettled(
    months.map(month => fetchETZStripeRevenue(month).catch(() => null)),
  );
  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    const res   = stripeResults[i];
    const r     = res?.status === 'fulfilled' ? res.value : null;
    ordersByMonth[month]  = r?.totalOrders  ?? 0;
    revenueByMonth[month] = r?.totalRevenue ?? 0;
  }

  // ── 5. Assemble response ──────────────────────────────────────────────────
  const points = months.map(month => ({
    month,
    label:    monthLabel(month),
    sessions: sessionsByMonth[month]  ?? 0,
    trials:   trialsByMonth[month]    ?? 0,
    orders:   ordersByMonth[month]    ?? 0,
    revenue:  revenueByMonth[month]   ?? 0,
  }));

  return NextResponse.json({ points, monthCount });
}
