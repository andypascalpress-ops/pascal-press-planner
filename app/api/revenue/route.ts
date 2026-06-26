import { NextRequest, NextResponse } from 'next/server';
import { fetchPPRevenue, placeholderETZRevenue } from '@/lib/bigcommerce-revenue';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);

  const [pp, etz] = await Promise.all([
    fetchPPRevenue(month),
    Promise.resolve(placeholderETZRevenue()),
  ]);

  return NextResponse.json({ pp, etz, month });
}
