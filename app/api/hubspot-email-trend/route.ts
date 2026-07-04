import { NextResponse } from 'next/server';
import { fetchEmailCampaigns } from '@/lib/hubspot-email';

export const revalidate = 3600; // cache 1 hour — historical data rarely changes

function getLast12Months(): string[] {
  const months: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 12; i++) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months.reverse(); // oldest → newest
}

export async function GET() {
  try {
    const months = getLast12Months();

    // Fetch 4 months at a time so we don't hammer the HubSpot API
    const results: {
      month: string;
      avgOpenRate:  number;
      avgClickRate: number;
      avgCtor:      number;
      unsubRate:    number;
      totalSends:   number;
      campaigns:    number;
    }[] = [];

    for (let i = 0; i < months.length; i += 4) {
      const batch = months.slice(i, i + 4);
      const batchResults = await Promise.all(
        batch.map(async month => {
          const data  = await fetchEmailCampaigns(month);
          const unsubs = data.campaigns.reduce((s, c) => s + c.unsubscribes, 0);
          return {
            month,
            avgOpenRate:  data.avgOpenRate,
            avgClickRate: data.avgClickRate,
            avgCtor:      data.totalOpens > 0 ? data.totalClicks / data.totalOpens : 0,
            unsubRate:    data.totalSends > 0 ? unsubs / data.totalSends : 0,
            totalSends:   data.totalSends,
            campaigns:    data.campaigns.length,
          };
        }),
      );
      results.push(...batchResults);
    }

    return NextResponse.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
