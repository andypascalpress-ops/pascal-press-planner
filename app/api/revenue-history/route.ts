import { NextResponse } from 'next/server';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';

export const revalidate = 3600; // cache 1 hour

// Dynamic: Jan 2026 → current month (no more hardcoded Jan–Jun limit)
function buildMonths(): string[] {
  const months: string[] = [];
  const d = new Date(2026, 0, 1);
  const now = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  while (d <= now) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

export async function GET() {
  const CHART_MONTHS = buildMonths();
  const results = await Promise.all(
    CHART_MONTHS.map(async (month) => {
      const [pp, etz] = await Promise.all([
        fetchPPRevenue(month),
        // accurate: false — uses customer.created date proxy, no per-customer lookups.
        // Avoids N×Stripe API calls timing out; suitable for trend charts.
        fetchETZStripeRevenue(month, { accurate: false }),
      ]);
      return { month, pp, etz };
    })
  );
  return NextResponse.json(results);
}
