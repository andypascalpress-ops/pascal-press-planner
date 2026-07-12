/**
 * GET /api/hubspot-email?month=YYYY-MM
 *
 * Returns HubSpot marketing email campaign stats for the given month.
 * Omit month to get all campaigns.
 *
 * Response: { month, campaigns, connected, statsLoaded, totalSends, totalOpens, totalClicks, avgOpenRate, avgClickRate }
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailCampaigns }       from '@/lib/hubspot-email';

export const dynamic = 'force-dynamic';

// Edge Runtime: 25-second timeout instead of Hobby's 10-second limit,
// giving HubSpot API calls enough headroom on a cold/uncached first request.
export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? undefined;

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: 'month param must be in YYYY-MM format' },
      { status: 400 },
    );
  }

  const data = await fetchEmailCampaigns(month);
  return NextResponse.json({ month: month ?? null, ...data });
}
