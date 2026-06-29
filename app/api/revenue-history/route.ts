import { NextResponse } from 'next/server';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';

// FY26 chart range: January 2026 – June 2026
const CHART_MONTHS = [
  '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06',
];

export async function GET() {
  const results = await Promise.all(
    CHART_MONTHS.map(async (month) => {
      const [pp, etz] = await Promise.all([
        fetchPPRevenue(month),
        fetchETZStripeRevenue(month),
      ]);
      return { month, pp, etz };
    })
  );
  return NextResponse.json(results);
}
