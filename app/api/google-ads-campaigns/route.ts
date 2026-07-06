/**
 * GET /api/google-ads-campaigns
 *
 * Returns campaign-level and ad-group-level performance for THIS_MONTH,
 * split into PP and ETZ buckets.
 */
import { NextResponse } from 'next/server';
import {
  buildConfig,
  etzHasOwnAccount,
  fetchCampaignPerformance,
  fetchAdGroupPerformance,
} from '@/lib/google-ads';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ppCfg = buildConfig('pp');
    const hasEtzAccount = etzHasOwnAccount();

    // When ETZ has its own account, filter nothing from PP; otherwise exclude ETZ-named campaigns
    const ppFilter = hasEtzAccount ? undefined : { excludes: 'ETZ' };
    const etzFilter = hasEtzAccount ? undefined : { contains: 'ETZ' };

    // PP campaigns + ad groups
    const [ppCampaigns, ppAdGroups] = await Promise.all([
      fetchCampaignPerformance(ppCfg, ppFilter),
      fetchAdGroupPerformance(ppCfg, ppFilter),
    ]);

    // ETZ campaigns + ad groups
    let etzCampaigns, etzAdGroups;
    if (hasEtzAccount) {
      const etzCfg = buildConfig('etz');
      [etzCampaigns, etzAdGroups] = await Promise.all([
        fetchCampaignPerformance(etzCfg),
        fetchAdGroupPerformance(etzCfg),
      ]);
    } else {
      [etzCampaigns, etzAdGroups] = await Promise.all([
        fetchCampaignPerformance(ppCfg, etzFilter),
        fetchAdGroupPerformance(ppCfg, etzFilter),
      ]);
    }

    return NextResponse.json({
      pp:  { campaigns: ppCampaigns,  adGroups: ppAdGroups  },
      etz: { campaigns: etzCampaigns, adGroups: etzAdGroups },
    });

  } catch (e) {
    console.error('[google-ads-campaigns]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
