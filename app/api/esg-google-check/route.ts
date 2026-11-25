// TEMPORARY: says whether the Excel Study Guides Google Ads account can be read. No figures. Remove once confirmed.
import { NextResponse } from 'next/server';
import { buildConfig, fetchCampaignPerformance } from '@/lib/google-ads';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const rows = await fetchCampaignPerformance(buildConfig('esg'), { limit: 100 });
    return NextResponse.json({ ok: true, campaignsThisMonth: rows.length, withSpend: rows.filter(r => r.cost > 0).length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
