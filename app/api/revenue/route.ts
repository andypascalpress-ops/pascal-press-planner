import { NextRequest, NextResponse } from 'next/server';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';

function prevMonthStr(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m-1 = current month (0-indexed), m-2 = previous
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  const prev  = prevMonthStr(month);

  const [pp, etz, ppPrev] = await Promise.all([
    fetchPPRevenue(month),
    fetchETZStripeRevenue(month),
    fetchPPRevenue(prev),
  ]);

  return NextResponse.json({ pp, etz, ppPrev, month });
}
