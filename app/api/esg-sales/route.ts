/**
 * GET /api/esg-sales?start=YYYY-MM-DD&end=YYYY-MM-DD[&compStart=...&compEnd=...]
 *
 * Excel Study Guides (Shopify) sales for a period and an optional comparison period: orders, revenue (net of refunds),
 * discounts, sales by marketing source and by discount code, and revenue by day. Totals only, no customer details.
 *
 * Access: the site's middleware does not cover /api routes, so this route checks the planner's own login cookie
 * (the same one the site sets after the password page). Without it the answer is 401 and no sales data is returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchShopifySales, shopifyConfigured } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401 });
  }
  if (!shopifyConfigured()) return NextResponse.json({ configured: false, error: 'Shopify is not connected yet (settings missing in Vercel)' });
  const sp = req.nextUrl.searchParams;
  const start = sp.get('start') ?? '', end = sp.get('end') ?? '';
  const cs = sp.get('compStart') ?? '', ce = sp.get('compEnd') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400 });
  try {
    const [current, prior] = await Promise.all([
      fetchShopifySales(start, end),
      ymd.test(cs) && ymd.test(ce) ? fetchShopifySales(cs, ce).catch(() => null) : Promise.resolve(null),
    ]);
    return NextResponse.json({ configured: true, period: { start, end }, comparison: prior ? { start: cs, end: ce } : null, current, prior },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message.slice(0, 500) : 'Failed to load' }, { status: 502 });
  }
}
