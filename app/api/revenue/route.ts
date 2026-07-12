import { NextRequest, NextResponse } from 'next/server';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue, fetchHSCStripeRevenue } from '@/lib/stripe-revenue';

export const dynamic = 'force-dynamic';

function prevMonthStr(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 2, 1); // m-1 = current month (0-indexed), m-2 = previous
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  const prev  = prevMonthStr(month);

  const [pp, etz, hsc, ppPrev] = await Promise.all([
    fetchPPRevenue(month),
    fetchETZStripeRevenue(month),
    fetchHSCStripeRevenue(month),
    fetchPPRevenue(prev),
  ]);

  return NextResponse.json({ pp, etz, hsc, ppPrev, month });
}
