/**
 * GET /api/meta-campaigns?month=YYYY-MM
 * Returns Meta (Facebook) Ads campaign-level breakdown for PP and ETZ.
 * PP excludes campaigns with "ETZ" in the name; ETZ includes only those.
 */
import { NextResponse } from 'next/server';
import {
  fetchMetaCampaigns,
  META_PP_ACCOUNT_ID,
  META_ETZ_ACCOUNT_ID,
  type MetaCampaign,
} from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';

function toAEST(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function monthToRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const todayAEST = toAEST(new Date());
  const lastDay   = new Date(y!, m!, 0).getDate();
  return {
    start: `${month}-01`,
    end:   month === todayAEST.slice(0, 7)
      ? todayAEST
      : `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

function makeTotals(campaigns: MetaCampaign[]) {
  return {
    spend:       Math.round(campaigns.reduce((s, c) => s + c.spend,       0) * 100) / 100,
    impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
    clicks:      campaigns.reduce((s, c) => s + c.clicks,      0),
    reach:       campaigns.reduce((s, c) => s + c.reach,       0),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') ?? toAEST(new Date()).slice(0, 7);
  const { start, end } = monthToRange(month);

  const [ppResult, etzResult] = await Promise.allSettled([
    fetchMetaCampaigns(META_PP_ACCOUNT_ID,  start, end, { excludes: 'ETZ' }),
    fetchMetaCampaigns(META_ETZ_ACCOUNT_ID, start, end, { contains: 'ETZ' }),
  ]);

  const ppCampaigns  = ppResult.status  === 'fulfilled' ? ppResult.value  : [];
  const etzCampaigns = etzResult.status === 'fulfilled' ? etzResult.value : [];
  const ppError      = ppResult.status  === 'rejected'  ? String(ppResult.reason)  : null;
  const etzError     = etzResult.status === 'rejected'  ? String(etzResult.reason) : null;

  if (ppError)  console.error('[meta-campaigns] PP error:',  ppError);
  if (etzError) console.error('[meta-campaigns] ETZ error:', etzError);

  return NextResponse.json({
    month,
    dateRange: { start, end },
    pp: {
      campaigns: ppCampaigns,
      totals:    makeTotals(ppCampaigns),
      connected: META_PP_ACCOUNT_ID !== '' && !ppError,
      error:     ppError,
    },
    etz: {
      campaigns: etzCampaigns,
      totals:    makeTotals(etzCampaigns),
      connected: META_ETZ_ACCOUNT_ID !== '' && !etzError,
      error:     etzError,
    },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60' },
  });
}
