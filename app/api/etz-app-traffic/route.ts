/**
 * GET /api/etz-app-traffic?month=YYYY-MM
 *
 * Returns session counts for app.exceltestzone.com.au for a given month.
 * This is the "middle stage" of the ETZ funnel:
 *   exceltestzone.com.au (main site, GA4)
 *     → app.exceltestzone.com.au (this endpoint)
 *       → free trial (HubSpot)
 *
 * Data source priority:
 *   1. GOOGLE_ANALYTICS_ETZ_APP_PROPERTY_ID — dedicated GA4 property for the app
 *   2. Existing ETZ GA4 property filtered by hostname = app.exceltestzone.com.au
 *      (requires cross-domain tracking to be enabled in that property)
 *
 * Response:
 *   { connected, source, totalSessions, totalNewUsers, fromMainSite }
 *   fromMainSite — sessions that arrived via exceltestzone.com.au referral
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEtzAppTraffic } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
  }

  const [year, mon] = month.split('-');
  const lastDay = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
  const startDate = `${year}-${mon}-01`;
  const now = new Date();
  const isCurrentMonth =
    parseInt(year!) === now.getFullYear() && parseInt(mon!) === now.getMonth() + 1;
  const endDayNum = isCurrentMonth ? Math.min(lastDay, now.getDate()) : lastDay;
  const endDate = `${year}-${mon}-${String(endDayNum).padStart(2, '0')}`;

  const excludeLoginLanding = req.nextUrl.searchParams.get('excludeLoginLanding') === 'true';
  const data = await fetchEtzAppTraffic(startDate, endDate, excludeLoginLanding);
  return NextResponse.json({ month, ...data });
}
