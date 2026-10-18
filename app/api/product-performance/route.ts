/**
 * GET /api/product-performance?range=30d|60d|90d|mtd|lastmonth
 * Also range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD for any run of months (compared with the same dates last year).
 * Product sales by brand (PP + Blake BC, ETZ + HSC Stripe) with YoY.
 */
import { NextResponse } from 'next/server';
import { fetchProductPerformance, RangeKey, type CustomPeriod } from '@/lib/product-performance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID: RangeKey[] = ['30d', '60d', '90d', 'mtd', 'lastmonth', 'custom'];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get('range') ?? '30d') as RangeKey;
    const range = VALID.includes(raw) ? raw : '30d';
    let custom: CustomPeriod | undefined;
    if (range === 'custom') {
      const s = searchParams.get('start') ?? '', e = searchParams.get('end') ?? '';
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(e) && s <= e;
      const span = ok ? (new Date(`${e}T12:00:00Z`).getTime() - new Date(`${s}T12:00:00Z`).getTime()) / 86_400_000 + 1 : 0;
      if (!ok || span > 400) {
        return NextResponse.json({ connected: false, error: 'custom range needs start and end as YYYY-MM-DD (start on or before end, at most about a year)' }, { status: 400 });
      }
      custom = { start: s, end: e };
    }
    const data = await fetchProductPerformance(range, custom);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (e) {
    console.error('[product-performance]', e);
    return NextResponse.json({ connected: false, error: String(e) }, { status: 500 });
  }
}
