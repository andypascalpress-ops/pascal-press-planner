// TEMPORARY: says whether the Excel Study Guides Google Ads account can be read. No figures. Remove once confirmed.
import { NextResponse } from 'next/server';
import { buildConfig, fetchCampaignPerformance, runGaqlQuery } from '@/lib/google-ads';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    let via = 'manager account';
    let rows;
    try { rows = await fetchCampaignPerformance(buildConfig('esg'), { limit: 100 }); }
    catch { via = 'direct'; rows = await fetchCampaignPerformance({ ...buildConfig('esg'), loginCustomerId: undefined }, { limit: 100 }); }
    return NextResponse.json({ ok: true, via, campaignsThisMonth: rows.length, withSpend: rows.filter(r => r.cost > 0).length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // which accounts sit under the manager account, and any pending link invitations
    const mcc = { ...buildConfig('pp'), customerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '') };
    const linked = await runGaqlQuery(mcc, `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client`).then(rows => rows.map(r => ({ id: r.customerClient?.id, name: r.customerClient?.descriptiveName, status: r.customerClient?.status }))).catch(err => String(err).slice(0, 200));
    const links = await runGaqlQuery(mcc, `SELECT customer_client_link.client_customer, customer_client_link.status FROM customer_client_link`).then(rows => rows.map(r => ({ client: r.customerClientLink?.clientCustomer, status: r.customerClientLink?.status }))).catch(err => String(err).slice(0, 200));
    return NextResponse.json({ linked, links, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
