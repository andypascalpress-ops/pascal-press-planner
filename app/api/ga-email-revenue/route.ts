/**
 * GET /api/ga-email-revenue?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns GA4 email-attributed revenue:
 *   - byCampaign: per-campaign revenue (matched to HubSpot emails via utm_campaign)
 *   - totalRevenue / totalTx: aggregate email channel totals
 *
 * Requires:
 *   GOOGLE_ANALYTICS_PROPERTY_ID
 *   GA4_REFRESH_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailRevenue }         from '@/lib/google-analytics';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start') ?? '2022-01-01';
  const end   = req.nextUrl.searchParams.get('end')   ?? 'today';

  const data = await fetchEmailRevenue(start, end);
  return NextResponse.json(data);
}
