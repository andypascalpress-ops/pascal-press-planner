/**
 * GET /api/ga4-channel-revenue?month=YYYY-MM
 *
 * Returns revenue broken down by GA4 sessionDefaultChannelGroup for PP and ETZ.
 * Channels: Organic Search, Paid Search, Email, Direct, Referral, Organic Social, etc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelRevenue } from '@/lib/google-analytics';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required in YYYY-MM format' }, { status: 400 });
  }

  const [year, mon] = month.split('-');
  const lastDay     = new Date(parseInt(year!), parseInt(mon!), 0).getDate();
  const startDate   = `${year}-${mon}-01`;
  const now         = new Date();
  const isCurrentMonth =
    parseInt(year!) === now.getFullYear() && parseInt(mon!) === now.getMonth() + 1;
  const endDayNum   = isCurrentMonth ? Math.min(lastDay, now.getDate()) : lastDay;
  const endDate     = `${year}-${mon}-${String(endDayNum).padStart(2, '0')}`;

  const [pp, etz] = await Promise.all([
    fetchChannelRevenue(startDate, endDate, 'pp'),
    fetchChannelRevenue(startDate, endDate, 'etz'),
  ]);

  return NextResponse.json({ month, pp, etz });
}
