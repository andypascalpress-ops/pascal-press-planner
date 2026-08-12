/**
 * GET /api/etz-funnel-traffic?month=YYYY-MM
 * Returns GA4 sessions + new users by channel for Excel Test Zone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEtzFunnelTraffic } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
  }

  const [year, mon] = month.split('-');
  const lastDay     = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
  const startDate   = `${year}-${mon}-01`;
  const now         = new Date();
  const isCurrentMonth =
    parseInt(year!) === now.getFullYear() && parseInt(mon!) === now.getMonth() + 1;
  const endDayNum   = isCurrentMonth ? Math.min(lastDay, now.getDate()) : lastDay;
  const endDate     = `${year}-${mon}-${String(endDayNum).padStart(2, '0')}`;

  const data = await fetchEtzFunnelTraffic(startDate, endDate);
  return NextResponse.json({ month, ...data });
}
