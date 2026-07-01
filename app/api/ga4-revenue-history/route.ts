/**
 * GET /api/ga4-revenue-history
 *
 * Returns Pascal Press Google Analytics 4 revenue by channel for FY26 (Jan–Jun 2026).
 * Requires GOOGLE_ANALYTICS_REFRESH_TOKEN env var.
 *
 * Response: Array<{ month: 'YYYY-MM', pp: { paid: number, organic: number } }>
 */
import { NextResponse }               from 'next/server';
import { fetchGA4RevenueHistory }     from '@/lib/google-analytics';

const CHART_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

export async function GET() {
  const rows = await fetchGA4RevenueHistory('2026-01-01', '2026-06-30');

  // Ensure all 6 months are present; fill missing with zeros
  return NextResponse.json(
    CHART_MONTHS.map(ym => {
      const found = rows.find(r => r.month === ym);
      return {
        month: ym,
        pp: found?.pp ?? { paid: 0, organic: 0 },
      };
    })
  );
}
