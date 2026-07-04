/**
 * GET /api/ga4-revenue-history
 *
 * Returns PP and ETZ GA4 revenue by channel from Jan 2026 → current month.
 * Requires GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON (or OAuth) env var for auth.
 * Requires GOOGLE_ANALYTICS_ETZ_PROPERTY_ID for ETZ data.
 *
 * Response: Array<{ month: 'YYYY-MM', pp: { paid, organic }, etz: { paid, organic } }>
 */
import { NextResponse }                                          from 'next/server';
import { fetchGA4RevenueHistory, fetchETZGA4RevenueHistory }     from '@/lib/google-analytics';

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
  // Cap to today — GA4 cannot convert AUD→USD for future dates
  const now       = new Date();
  const todayStr  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fullEnd   = `${endMonth}-${String(lastDay).padStart(2, '0')}`;
  const endDate   = fullEnd > todayStr ? todayStr : fullEnd;

  const [ppRows, etzRows] = await Promise.all([
    fetchGA4RevenueHistory('2026-01-01', endDate),
    fetchETZGA4RevenueHistory('2026-01-01', endDate),
  ]);

  return NextResponse.json(
    months.map(ym => {
      const ppFound  = ppRows.find(r => r.month === ym);
      const etzFound = etzRows.find(r => r.month === ym);
      return {
        month: ym,
        pp:  ppFound?.pp   ?? { paid: 0, organic: 0 },
        etz: etzFound?.etz ?? { paid: 0, organic: 0 },
      };
    }),
  );
}
