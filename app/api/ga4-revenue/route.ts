/**
 * GET /api/ga4-revenue?month=YYYY-MM
 *
 * Returns Pascal Press revenue by channel from Google Analytics 4.
 * Requires GOOGLE_ANALYTICS_REFRESH_TOKEN env var.
 *
 * Response: { month, pp: { paidSearchRevenue, organicSearchRevenue, connected } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchGA4Revenue }           from '@/lib/google-analytics';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required in YYYY-MM format' }, { status: 400 });
  }

  const pp = await fetchGA4Revenue(month);
  return NextResponse.json({ month, pp });
}
