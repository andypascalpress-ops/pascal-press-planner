/**
 * GET /api/meta-debug
 * Temporary diagnostic endpoint — shows raw Meta Ads API data.
 * Delete this file once Meta spend is confirmed working.
 */
import { NextResponse } from 'next/server';

const META_GRAPH_API = 'https://graph.facebook.com/v20.0';
const ACCESS_TOKEN   = process.env.META_ADS_ACCESS_TOKEN ?? '';
const ACCOUNT_ID     = process.env.META_PP_AD_ACCOUNT_ID ?? '';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!ACCESS_TOKEN || !ACCOUNT_ID) {
    return NextResponse.json({ error: 'META_ADS_ACCESS_TOKEN or META_PP_AD_ACCOUNT_ID not set' });
  }

  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const start = `${month}-01`;
  const end   = now.toISOString().slice(0, 10);
  const timeRange = JSON.stringify({ since: start, until: end });

  // 1. Account-level total spend
  const acctParams = new URLSearchParams({
    fields: 'spend,account_name',
    time_range: timeRange,
    access_token: ACCESS_TOKEN,
  });
  const acctRes = await fetch(`${META_GRAPH_API}/${ACCOUNT_ID}/insights?${acctParams}`, { cache: 'no-store' });
  const acctJson = await acctRes.json();

  // 2. Campaign-level breakdown
  const campParams = new URLSearchParams({
    fields: 'campaign_name,spend',
    level: 'campaign',
    time_range: timeRange,
    access_token: ACCESS_TOKEN,
    limit: '100',
  });
  const campRes = await fetch(`${META_GRAPH_API}/${ACCOUNT_ID}/insights?${campParams}`, { cache: 'no-store' });
  const campJson = await campRes.json();

  // 3. Token info
  const meRes  = await fetch(`${META_GRAPH_API}/me?access_token=${ACCESS_TOKEN}`, { cache: 'no-store' });
  const meJson = await meRes.json();

  return NextResponse.json({
    tokenOk:        !meJson.error,
    tokenUser:      meJson.name ?? meJson.error?.message,
    accountId:      ACCOUNT_ID,
    range:          { start, end },
    accountLevel:   acctJson,
    campaignLevel:  campJson,
  });
}
