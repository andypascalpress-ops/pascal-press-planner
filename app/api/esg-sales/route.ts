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
import { fetchShopifySales, fetchShopifySalesReport, fetchShopifyProductSales, shopifyConfigured } from '@/lib/shopify';
import { META_ESG_ACCOUNT_ID, fetchEsgMetaCampaigns, fetchEsgMetaSpend } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Facebook & Instagram ads for Excel Study Guides: Meta spend per campaign set against the sales Shopify credits to paid Facebook visits. */
async function buildAds(start: string, end: string, cs: string, ce: string, hasComp: boolean, current: Awaited<ReturnType<typeof fetchShopifySales>>) {
  if (!META_ESG_ACCOUNT_ID) return { configured: false };
  let campaigns: Awaited<ReturnType<typeof fetchEsgMetaCampaigns>> = [];
  let priorSpend: number | null = null, error = '';
  try { campaigns = await fetchEsgMetaCampaigns(start, end); } catch (e) { error = e instanceof Error ? e.message.slice(0, 300) : 'failed'; }
  if (hasComp && !error) { try { priorSpend = await fetchEsgMetaSpend(cs, ce); } catch { priorSpend = null; } }
  const spend = r2(campaigns.reduce((s, c) => s + c.spend, 0));
  const FB = 'Facebook & Instagram \u2013 paid';
  const fbPaid = current.bySource.find(s => s.source === FB);
  const fbRows = (current.byCampaign ?? []).filter(c => c.channel === FB);
  const rows = campaigns.filter(c => c.spend > 0).map(c => ({ id: c.id, name: c.name, spend: r2(c.spend), clicks: c.clicks, impressions: c.impressions, revenue: 0, orders: 0 }));
  const unmatched: { campaign: string; orders: number; revenue: number }[] = [];
  for (const f of fbRows) {
    const k = norm(f.campaign);
    const row = k ? rows.find(r => norm(r.id) === k || norm(r.name) === k) : undefined;
    if (row) { row.revenue = r2(row.revenue + f.revenue); row.orders += f.orders; }
    else unmatched.push({ campaign: f.campaign, orders: f.orders, revenue: f.revenue });
  }
  const matchedRevenue = r2(rows.reduce((s, r) => s + r.revenue, 0));
  const fbRevenue = fbPaid?.revenue ?? 0;
  return {
    configured: true, error: error || null,
    spend, priorSpend,
    paidRevenue: fbRevenue, paidOrders: fbPaid?.orders ?? 0,
    roas: spend > 0 && fbRevenue > 0 ? Math.round((fbRevenue / spend) * 10) / 10 : null,
    campaigns: rows.sort((a, b) => b.spend - a.spend).map(r => ({ ...r, roas: r.spend > 0 && r.revenue > 0 ? Math.round((r.revenue / r.spend) * 10) / 10 : null })),
    unmatched: unmatched.slice(0, 10),
    unattributedRevenue: r2(Math.max(0, fbRevenue - matchedRevenue - unmatched.reduce((s, u) => s + u.revenue, 0))),
  };
}

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
    // the order list only reaches back about 60 days without read_all_orders; older comparison dates use Shopify's sales report
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const limit = new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() - 55);
    const limitYmd = limit.toISOString().slice(0, 10);
    const hasComp = ymd.test(cs) && ymd.test(ce);
    const useReport = hasComp && cs < limitYmd;
    let priorError = '';
    const priorPromise = !hasComp ? Promise.resolve(null)
      : (useReport ? fetchShopifySalesReport(cs, ce) : fetchShopifySales(cs, ce)).catch((e: unknown) => { priorError = e instanceof Error ? e.message.slice(0, 300) : 'failed'; return null; });
    let productsError = '';
    const noteErr = (e: unknown) => { productsError = e instanceof Error ? e.message.slice(0, 300) : 'failed'; return null; };
    const [current, prior, products, priorProducts] = await Promise.all([
      fetchShopifySales(start, end), priorPromise,
      fetchShopifyProductSales(start, end).catch(noteErr),
      hasComp ? fetchShopifyProductSales(cs, ce).catch(() => null) : Promise.resolve(null),
    ]);
    const ads = await buildAds(start, end, cs, ce, hasComp, current).catch((e: unknown) => ({ configured: true, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }));
    return NextResponse.json({
      configured: true, ads, period: { start, end }, comparison: prior ? { start: cs, end: ce } : null, current, prior, products, priorProducts, productsError: productsError || null,
      priorSource: prior ? (useReport ? 'report' : 'orders') : null, priorError: priorError || null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message.slice(0, 500) : 'Failed to load' }, { status: 502 });
  }
}
