/**
 * GET /api/overview-esg?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * The Excel Study Guides card for the Executive Overview: Shopify revenue and orders, plus Facebook & Instagram spend.
 * It is its own route, not part of /api/overview, because that one is cached at the edge and shared by everyone:
 * a block that depends on who is signed in cannot live in a shared copy.
 * Guarded by the planner login cookie, and never cached.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchShopifySales, shopifyConfigured } from '@/lib/shopify';
import { fetchEsgMetaSpend } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401, headers: NO_STORE });
  }
  if (!shopifyConfigured()) return NextResponse.json({ error: 'Shopify is not connected' }, { status: 503, headers: NO_STORE });
  const start = req.nextUrl.searchParams.get('start') ?? '', end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400, headers: NO_STORE });
  try {
    const [sales, meta] = await Promise.allSettled([fetchShopifySales(start, end), fetchEsgMetaSpend(start, end)]);
    if (sales.status === 'rejected') {
      return NextResponse.json({ error: sales.reason instanceof Error ? sales.reason.message.slice(0, 240) : 'Shopify could not be read' }, { status: 502, headers: NO_STORE });
    }
    const metaSpend = meta.status === 'fulfilled' ? meta.value : 0;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const revenue = sales.value.revenue, orders = sales.value.orders;
    return NextResponse.json({
      esg: {
        spend: 0,
        metaSpend: r2(metaSpend),
        totalSpend: r2(metaSpend),
        budget: 0,
        revenue,
        roas: metaSpend > 0 ? Math.round((revenue / metaSpend) * 10) / 10 : 0,
        orders,
        aov: orders > 0 ? Math.round(revenue / orders) : null,
        revConnected: true,
        adsConnected: metaSpend > 0,
        adsError: null,
        metaError: meta.status === 'rejected' ? String(meta.reason).replace(/^Error:\s*/, '').slice(0, 240) : null,
        conversion: null,
      },
    }, { headers: { 'Cache-Control': 'private, max-age=120' } });   // private: only this browser keeps it, never a shared cache
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 240) : 'failed' }, { status: 502, headers: NO_STORE });
  }
}
