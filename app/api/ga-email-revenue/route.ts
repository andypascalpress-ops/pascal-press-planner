/**
 * GET /api/ga-email-revenue?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns GA4 email-attributed revenue:
 *   byCampaign  — per utm_campaign revenue (matched to HubSpot emails)
 *   totalRevenue / totalTx — aggregate email channel totals
 *
 * Uses the existing GA4 connection (GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON or OAuth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailRevenue }         from '@/lib/google-analytics';

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start') ?? '2022-01-01';
  const end   = req.nextUrl.searchParams.get('end')   ?? 'today';
  const data  = await fetchEmailRevenue(start, end);
  return NextResponse.json(data);
}
