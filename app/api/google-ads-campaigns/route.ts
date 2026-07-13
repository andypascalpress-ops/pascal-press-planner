/**
 * GET /api/google-ads-campaigns?month=YYYY-MM
 *
 * Campaign-level Google Ads spend + GA4 purchase revenue (session medium = cpc).
 * Revenue intentionally comes from Google Analytics, not Google Ads conversion value.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  buildConfig,
  etzHasOwnAccount,
  fetchCampaignPerformance,
  type CampaignPerf,
} from '@/lib/google-ads';
import {
  fetchPaidCampaignRevenue,
  matchRevenue,
  type CampaignRevenue,
} from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export interface JoinedCampaign {
  name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number;
  avgCpc: number;
  /** GA4 purchase revenue for this campaign (paid sessions) */
  gaRevenue: number;
  /** GA4 transactions */
  gaTransactions: number;
  /** gaRevenue / spend */
  gaRoas: number;
  /** Whether a GA4 campaign name match was found */
  gaMatched: boolean;
  /** Google Ads conversion value (for reference only — not used as primary revenue) */
  adsConvValue: number;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y!, m!, 0).getDate();
  // Cap end to "today" in Sydney so partial months work
  const todaySydney = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const end = todaySydney < monthEnd && todaySydney.startsWith(month.slice(0, 7))
    ? todaySydney
    : monthEnd;
  return { start, end };
}

function joinCampaigns(
  ads: CampaignPerf[],
  ga: CampaignRevenue[],
): JoinedCampaign[] {
  const usedGa = new Set<string>();

  const joined: JoinedCampaign[] = ads.map(c => {
    const match = matchRevenue(c.name, ga.filter(g => !usedGa.has(g.campaignName)));
    if (match) usedGa.add(match.campaignName);
    const gaRevenue = match?.revenue ?? 0;
    const gaTransactions = match?.transactions ?? 0;
    return {
      name: c.name,
      status: c.status,
      spend: c.cost,
      clicks: c.clicks,
      impressions: c.impressions,
      ctr: c.ctr,
      avgCpc: c.avgCpc,
      gaRevenue,
      gaTransactions,
      gaRoas: c.cost > 0 && gaRevenue > 0 ? Math.round((gaRevenue / c.cost) * 100) / 100 : 0,
      gaMatched: !!match,
      adsConvValue: c.convValue,
    };
  });

  // GA campaigns with revenue but no Ads spend row (e.g. renamed / paused earlier)
  for (const g of ga) {
    if (usedGa.has(g.campaignName)) continue;
    if (g.revenue <= 0) continue;
    joined.push({
      name: g.campaignName,
      status: 'GA_ONLY',
      spend: 0,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      avgCpc: 0,
      gaRevenue: g.revenue,
      gaTransactions: g.transactions,
      gaRoas: 0,
      gaMatched: true,
      adsConvValue: 0,
    });
  }

  return joined.sort((a, b) => b.spend - a.spend || b.gaRevenue - a.gaRevenue);
}


function summarise(campaigns: JoinedCampaign[], adsConnected: boolean, gaConnected: boolean, error: string | null = null) {
  const spend = campaigns.reduce((s, c) => s + Number(c.spend || 0), 0);
  const gaRevenue = campaigns.reduce((s, c) => s + Number(c.gaRevenue || 0), 0);
  const gaTransactions = campaigns.reduce((s, c) => s + Number(c.gaTransactions || 0), 0);
  const clicks = campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0);
  return {
    campaigns,
    totals: {
      spend: Math.round(spend * 100) / 100,
      gaRevenue: Math.round(gaRevenue * 100) / 100,
      gaTransactions,
      gaRoas: spend > 0 && gaRevenue > 0 ? Math.round((gaRevenue / spend) * 100) / 100 : 0,
      clicks,
    },
    adsConnected,
    gaConnected,
    error,
  };
}

export async function GET(req: NextRequest) {
  try {
    const month =
      req.nextUrl.searchParams.get('month') ||
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: '2-digit',
      }).format(new Date());

    const { start, end } = monthBounds(month);
    const dateRange = { start, end };
    const hasEtzAccount = etzHasOwnAccount();

    // ── Google Ads spend (parallel) ──────────────────────────────────────────
    const [ppAdsRes, etzAdsRes, hscAdsRes, ppGaRes, etzGaRes] = await Promise.allSettled([
      (async () => {
        const cfg = buildConfig('pp');
        return fetchCampaignPerformance(cfg, {
          campaignNameFilter: hasEtzAccount ? undefined : { excludes: 'ETZ' },
          dateRange,
          limit: 50,
        });
      })(),
      (async () => {
        if (hasEtzAccount) {
          return fetchCampaignPerformance(buildConfig('etz'), { dateRange, limit: 50 });
        }
        return fetchCampaignPerformance(buildConfig('pp'), {
          campaignNameFilter: { contains: 'ETZ' },
          dateRange,
          limit: 50,
        });
      })(),
      (async () => {
        try {
          return fetchCampaignPerformance(buildConfig('hsc'), { dateRange, limit: 50 });
        } catch {
          return [] as CampaignPerf[];
        }
      })(),
      fetchPaidCampaignRevenue(start, end, 'pp'),
      fetchPaidCampaignRevenue(start, end, 'etz'),
    ]);

    const ppAds = ppAdsRes.status === 'fulfilled' ? ppAdsRes.value : [];
    const etzAds = etzAdsRes.status === 'fulfilled' ? etzAdsRes.value : [];
    const hscAds = hscAdsRes.status === 'fulfilled' ? hscAdsRes.value : [];
    const ppGa = ppGaRes.status === 'fulfilled' ? ppGaRes.value : null;
    const etzGa = etzGaRes.status === 'fulfilled' ? etzGaRes.value : null;

    const pp = summarise(
      joinCampaigns(ppAds, ppGa?.byCampaign ?? []),
      ppAdsRes.status === 'fulfilled',
      ppGa?.connected ?? false,
      ppAdsRes.status === 'rejected' ? String(ppAdsRes.reason) : null,
    );
    const etz = summarise(
      joinCampaigns(etzAds, etzGa?.byCampaign ?? []),
      etzAdsRes.status === 'fulfilled',
      etzGa?.connected ?? false,
      etzAdsRes.status === 'rejected' ? String(etzAdsRes.reason) : null,
    );
    // HSC: ads spend only — no GA4 property wired yet
    const hsc = summarise(
      joinCampaigns(hscAds, []),
      hscAdsRes.status === 'fulfilled' && hscAds.length > 0,
      false,
      hscAdsRes.status === 'rejected' ? String(hscAdsRes.reason) : null,
    );

    return NextResponse.json({
      month,
      dateRange,
      revenueSource: 'google_analytics_4',
      note: 'Spend from Google Ads API; revenue from GA4 purchase revenue (sessionMedium=cpc) matched by campaign name',
      pp,
      etz,
      hsc,
    });
  } catch (e) {
    console.error('[google-ads-campaigns]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
