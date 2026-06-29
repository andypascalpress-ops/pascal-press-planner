import { NextResponse } from 'next/server';
import { buildConfig, etzHasOwnAccount } from '@/lib/google-ads';

export async function GET() {
  try {
    const cfg = buildConfig('etz');
    const etzOwn = etzHasOwnAccount();

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'OAuth failed', detail: tokenData }, { status: 500 });
    }

    const headers: Record<string, string> = {
      Authorization:    `Bearer ${tokenData.access_token}`,
      'developer-token': cfg.developerToken,
      'Content-Type':   'application/json',
    };
    if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;

    const url = `https://googleads.googleapis.com/v24/customers/${cfg.customerId}/googleAds:search`;

    // List first 10 campaigns with their names
    const q1 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: `SELECT campaign.name, campaign.status FROM campaign ORDER BY campaign.name LIMIT 10` }),
    });
    const d1 = await q1.json();

    // ETZ filter with spend
    const q2 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: `SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '2025-07-01' AND '2026-06-30' AND campaign.name LIKE '%ETZ%' ORDER BY campaign.name` }),
    });
    const d2 = await q2.json();

    return NextResponse.json({ customerId: cfg.customerId, loginCustomerId: cfg.loginCustomerId, etzHasOwnAccount: etzOwn, allCampaigns: d1, etzFilter: d2 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
