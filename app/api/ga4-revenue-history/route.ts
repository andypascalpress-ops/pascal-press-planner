/**
 * GET /api/ga4-revenue-history
 *
 * Returns Pascal Press GA4 revenue by channel from Jan 2026 → current month.
 * Requires GOOGLE_ANALYTICS_REFRESH_TOKEN (or service account) env var.
 *
 * Response: Array<{ month: 'YYYY-MM', pp: { paid: number, organic: number } }>
 */
import { NextResponse }           from 'next/server';
import { fetchGA4RevenueHistory } from '@/lib/google-analytics';

export const revalidate = 3600; // cache 1 hour

function buildMonths(): string[] {
  const months: string[] = [];
  const start = new Date(2026, 0, 1); // Jan 2026
  const now   = new Date();
  const cur   = new Date(now.getFullYear(), now.getMonth(), 1);
  const d     = new Date(start);
  while (d <= cur) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

export async function GET() {
  const months   = buildMonths();
  const endMonth = months[months.length - 1]!;
  const [ey, em] = endMonth.split('-').map(Number);
  const lastDay  = new Date(ey!, em!, 0).getDate();
  const endDate  = `${endMonth}-${String(lastDay).padStart(2, '0')}`;

  const rows = await fetchGA4RevenueHistory('2026-01-01', endDate);

  return NextResponse.json(
    months.map(ym => {
      const found = rows.find(r => r.month === ym);
      return { month: ym, pp: found?.pp ?? { paid: 0, organic: 0 } };
    }),
  );
}
