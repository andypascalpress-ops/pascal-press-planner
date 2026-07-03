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
    return Ne