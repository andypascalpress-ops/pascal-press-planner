/**
 * GET /api/website-conversion?month=YYYY-MM
 * Site-wide conversion rate (sessions → purchases) from GA4 for PP + ETZ.
 * Compares same day-range vs previous month for a fair MTD delta + reason.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchPPWebsiteConversion,
  fetchETZWebsiteConversion,
} from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month')
    ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());

  const [pp, etz] = await Promise.all([
    fetchPPWebsiteConversion(month),
    fetchETZWebsiteConversion(month),
  ]);

  return NextResponse.json({ month, pp, etz });
}
