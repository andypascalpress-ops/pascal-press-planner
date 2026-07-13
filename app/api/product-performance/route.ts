/**
 * GET /api/product-performance?range=30d|60d|90d|mtd|lastmonth
 * Product sales by brand (PP + Blake BC, ETZ + HSC Stripe) with YoY.
 */
import { NextResponse } from 'next/server';
import { fetchProductPerformance, RangeKey } from '@/lib/product-performance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID: RangeKey[] = ['30d', '60d', '90d', 'mtd', 'lastmonth'];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get('range') ?? '30d') as RangeKey;
    const range = VALID.includes(raw) ? raw : '30d';
    const data = await fetchProductPerformance(range);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (e) {
    console.error('[product-performance]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
