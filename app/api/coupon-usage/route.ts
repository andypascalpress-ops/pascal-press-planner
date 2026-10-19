/**
 * GET /api/coupon-usage?brand=etz|blake&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Coupon code usage (orders and revenue per code) for Excel Test Zone (Stripe) and Blake Education (BigCommerce).
 * Codes and totals only, no customer details. Ranges are limited to about a year.
 */
import { NextResponse } from 'next/server';
import { fetchEtzCouponUsage, fetchBlakeCouponUsage } from '@/lib/coupon-usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand') ?? '';
  const start = searchParams.get('start') ?? '';
  const end = searchParams.get('end') ?? '';
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (brand !== 'etz' && brand !== 'blake') return NextResponse.json({ error: 'brand must be etz or blake' }, { status: 400 });
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end must be YYYY-MM-DD with start on or before end' }, { status: 400 });
  const span = (new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000 + 1;
  if (span > 400) return NextResponse.json({ error: 'range is limited to about a year' }, { status: 400 });

  try {
    const data = brand === 'etz' ? await fetchEtzCouponUsage(start, end) : await fetchBlakeCouponUsage(start, end);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' } });
  } catch (e) {
    console.error('[coupon-usage]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read coupon usage' }, { status: 502 });
  }
}
