/**
 * GET /api/esg-channels?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Excel Study Guides channel deep-dive from Shopify orders: exact source / medium / campaign / ad content, landing pages,
 * the items each channel sold, discount codes by channel and first click versus last click. Counts and revenue only.
 * Guarded by the planner login cookie (the middleware does not cover /api).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchShopifyChannelDeepDive, shopifyConfigured } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401 });
  }
  if (!shopifyConfigured()) return NextResponse.json({ configured: false, error: 'Shopify is not connected' });
  const start = req.nextUrl.searchParams.get('start') ?? '', end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400 });
  try {
    return NextResponse.json(await fetchShopifyChannelDeepDive(start, end), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 400) : 'failed' }, { status: 502 });
  }
}
