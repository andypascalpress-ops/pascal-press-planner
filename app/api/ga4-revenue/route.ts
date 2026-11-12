/**
 * GET /api/ga4-revenue?month=YYYY-MM
 *
 * Returns Pascal Press and Excel Test Zone revenue by channel from Google Analytics 4.
 * Requires GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON (or OAuth) env var for auth.
 * Requires GOOGLE_ANALYTICS_ETZ_PROPERTY_ID for ETZ data.
 *
 * Response: { month, pp: { paidSearchRevenue, organicSearchRevenue, connected },
 *                     etz: { paidSearchRevenue, organicSearchRevenue, connected } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchGA4Revenue, fetchETZGA4Revenue, fetchFacebookPaidRevenue } from '@/lib/google-analytics';
import { fetchMetaSpend, fetchEtzMetaSpend, META_PP_ACCOUNT_ID, type MetaCampaignFilter } from '@/lib/meta-ads';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required in YYYY-MM format' }, { status: 400 });
  }

  // month to date for the current month, the whole month otherwise
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const now = new Date();
  const current = y === now.getFullYear() && m === now.getMonth() + 1;
  const start = `${month}-01`, end = `${month}-${String(current ? Math.min(lastDay, now.getDate()) : lastDay).padStart(2, '0')}`;

  const [pp, etz, fbPP, fbETZ, metaPP, metaETZ] = await Promise.all([
    fetchGA4Revenue(month),
    fetchETZGA4Revenue(month),
    fetchFacebookPaidRevenue(start, end, 'pp'),
    fetchFacebookPaidRevenue(start, end, 'etz'),
    fetchMetaSpend(META_PP_ACCOUNT_ID, start, end, { excludes: 'ETZ' } satisfies MetaCampaignFilter).catch(() => null),
    fetchEtzMetaSpend(start, end).catch(() => null),
  ]);
  return NextResponse.json({
    month, pp, etz,
    // sales Google Analytics credits to paid Facebook / Instagram clicks, with the Meta ad spend for the same dates
    facebook: { pp: { ...fbPP, spend: metaPP }, etz: { ...fbETZ, spend: metaETZ } },
  });
}
