/**
 * GET /api/meta-account-check?id=<ad account id, digits only or act_<digits>>
 *
 * Onboarding helper: tells you whether the planner's Meta system user can see a given ad account, and if so its name,
 * status and currency. Read-only, returns no campaign or spend data.
 * Same access rule as the report endpoints: header  Authorization: Bearer <REPORT_TOKEN>  (see lib/report-auth.ts).
 */
import { NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';

export const dynamic = 'force-dynamic';

const STATUS: Record<number, string> = {
  1: 'Active', 2: 'Disabled', 3: 'Unsettled (payment issue)', 7: 'Pending risk review', 8: 'Pending settlement',
  9: 'In grace period', 100: 'Pending closure', 101: 'Closed', 201: 'Any active', 202: 'Any closed',
};

export async function GET(request: Request) {
  const refused = checkReportToken(request);
  if (refused) return refused;

  const raw = (new URL(request.url).searchParams.get('id') ?? '').trim().replace(/^act_/, '');
  if (!/^\d{5,20}$/.test(raw)) return NextResponse.json({ error: 'id must be the ad account number (digits only)' }, { status: 400 });
  const token = process.env.META_ADS_ACCESS_TOKEN ?? '';
  if (!token) return NextResponse.json({ error: 'META_ADS_ACCESS_TOKEN is not configured' }, { status: 503 });

  const params = new URLSearchParams({ fields: 'name,account_status,currency,timezone_name,business{name}', access_token: token });
  const res = await fetch(`https://graph.facebook.com/v22.0/act_${raw}?${params}`, { cache: 'no-store' });
  const json = await res.json().catch(() => null) as any;
  if (!res.ok || !json || json.error) {
    // never echo the token; report Meta's own reason
    const e = json?.error ?? {};
    return NextResponse.json({
      accessible: false, id: `act_${raw}`, httpStatus: res.status,
      metaCode: e.code ?? null, metaSubcode: e.error_subcode ?? null,
      reason: String(e.message ?? 'Meta did not return the account').replace(/access_token=[^&\s]+/g, 'access_token=…'),
    }, { status: 200 });
  }
  return NextResponse.json({
    accessible: true, id: json.id,
    name: json.name ?? null,
    status: STATUS[Number(json.account_status)] ?? String(json.account_status),
    currency: json.currency ?? null,
    timezone: json.timezone_name ?? null,
    business: json.business?.name ?? null,
  });
}
