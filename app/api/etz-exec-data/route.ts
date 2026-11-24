/**
 * GET /api/etz-exec-data[?asOf=YYYY-MM-DD]
 *
 * Every figure for the Excel Test Zone executive report, as JSON (totals only, no ids, emails or names).
 * Access: the planner login cookie, or header  Authorization: Bearer <REPORT_TOKEN>  (as the emailed reports use).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';
import { buildEtzExecData, cardTimes } from '@/lib/etz-exec-data';
import { buildConfig, fetchMonthlySpend } from '@/lib/google-ads';
import { fetchEtzMetaSpend } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Live Google + Meta spend for Excel Test Zone, the same way the planner's Overview counts it. */
async function etzAdSpend(month: string, start: string, end: string): Promise<{ google: number; meta: number }> {
  let google = 0;
  try {
    if (month >= '2026-07') google = (await fetchMonthlySpend(buildConfig('etz'), start, end)).reduce((s, r) => s + r.actualSpend, 0);
    else google = (await fetchMonthlySpend(buildConfig('pp'), start, end, { contains: 'ETZ' })).reduce((s, r) => s + r.actualSpend, 0);
  } catch { google = 0; }
  const meta = await fetchEtzMetaSpend(start, end).catch(() => 0);
  return { google, meta };
}

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  const signedIn = !!sitePassword && req.cookies.get('pp_auth')?.value === sitePassword;
  if (!signedIn) {
    const refused = checkReportToken(req);
    if (refused) return refused;
  }
  if (req.nextUrl.searchParams.get('debug') === 'card-times') {
    const s0 = req.nextUrl.searchParams.get('start') ?? '', e0 = req.nextUrl.searchParams.get('end') ?? '';
    return NextResponse.json(await cardTimes(s0, e0), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 });
  try {
    const t0 = Date.now();
    const data = await buildEtzExecData(asOf, etzAdSpend);
    return NextResponse.json({ ...data, buildMs: Date.now() - t0 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
