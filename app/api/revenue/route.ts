import { NextRequest, NextResponse } from 'next/server';
import { fetchPPRevenue } from '@/lib/bigcommerce-revenue';
import { fetchETZStripeRevenue } from '@/lib/stripe-revenue';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);

  const [pp, etz] = await Promise.all([
    fetchPPRevenue(month),
    fetchETZStripeRevenue(month),
  ]);

  return NextResponse.json({ pp, etz, month });
}
