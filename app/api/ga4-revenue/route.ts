/**
 * GET /api/ga4-revenue?month=YYYY-MM
 *
 * Returns Pascal Press and Excel Test Zone revenue by channel from Google Analytics 4.
 * Requires GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON (or OAuth) env var for auth.
 * Requires GOOGLE_ANALYTICS_ETZ_PROPERTY_ID for ETZ data.
 *
 * Response: { month, pp: { paidSearchRevenue, organicSearchRevenue, connected },
 *                     etz: { paidSearchRevenue, organicSearchRevenue, connected } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchGA4Revenue, fetchETZGA4Revenue } from '@/lib/google-analytics';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required in YYYY-MM format' }, { status: 400 });
  }

  const [pp, etz] = await Promise.all([
    fetchGA4Revenue(month),
    fetchETZGA4Revenue(month),
  ]);
  return NextResponse.json({ month, pp, etz });
}
