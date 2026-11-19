/**
 * GET /api/pp-product-sales?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Pascal Press product sales from BigCommerce order lines: units, orders and revenue per product (grouped by product ID).
 * Use ranges of about a month or less (each order's lines are read one by one). Counts and revenue only, no customer details.
 * Guarded by the planner login cookie (the middleware does not cover /api).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchPPProductSales } from '@/lib/bigcommerce-revenue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401 });
  }
  const start = req.nextUrl.searchParams.get('start') ?? '', end = req.nextUrl.searchParams.get('end') ?? '';
  const days = (new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000 + 1;
  if (!ymd.test(start) || !ymd.test(end) || start > end || days > 35) {
    return NextResponse.json({ error: 'start and end required (YYYY-MM-DD), at most 35 days' }, { status: 400 });
  }
  try {
    return NextResponse.json(await fetchPPProductSales(start, end), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 502 });
  }
}
