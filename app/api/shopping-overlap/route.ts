/**
 * GET /api/shopping-overlap?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Google Shopping products that both Pascal Press and Excel Study Guides advertise, with each side's spend.
 * Guarded by the planner login cookie; never cached.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchShoppingOverlap } from '@/lib/shopping-overlap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401, headers: NO_STORE });
  }
  const start = req.nextUrl.searchParams.get('start') ?? '', end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400, headers: NO_STORE });
  try {
    // ?sales=1 adds what each paired product sold on each store (slower: reads every order's line items on BigCommerce)
    const withSales = req.nextUrl.searchParams.get('sales') === '1';
    if (withSales && (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > 35) {
      return NextResponse.json({ error: 'Store sales can be shown for up to 35 days at a time.' }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json(await fetchShoppingOverlap(start, end, withSales), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 240) : 'failed' }, { status: 502, headers: NO_STORE });
  }
}
