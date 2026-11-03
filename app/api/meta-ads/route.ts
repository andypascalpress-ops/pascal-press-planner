/**
 * GET /api/meta-ads
 * Names and status of the ads in the new Excel Test Zone ad account (campaign and ad set names included).
 * Read-only: no spend, no audiences, no creative.
 */
import { NextResponse } from 'next/server';
import { fetchMetaAdsList, META_ETZ_OWN_ACCOUNT_ID } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  if (!META_ETZ_OWN_ACCOUNT_ID) return NextResponse.json({ connected: false, error: 'META_ETZ_OWN_AD_ACCOUNT_ID is not set' });
  try {
    const ads = await fetchMetaAdsList(META_ETZ_OWN_ACCOUNT_ID);
    return NextResponse.json({ connected: true, account: META_ETZ_OWN_ACCOUNT_ID, count: ads.length, ads });
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : 'Failed to read ads' }, { status: 502 });
  }
}
