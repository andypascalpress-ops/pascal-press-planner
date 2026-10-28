/**
 * GET /api/ga4-hostnames?start=&end=&compStart=&compEnd=   (YYYY-MM-DD)
 *
 * Diagnostic: Excel Test Zone Google Analytics traffic by hostname for two periods, staging and test addresses included,
 * so you can see where the website and the app have recorded their traffic over time. Counts only, no user data.
 * Same access rule as the report endpoints: header  Authorization: Bearer <REPORT_TOKEN>.
 */
import { NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';
import { fetchEtzHostnameBreakdown } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const refused = checkReportToken(request);
  if (refused) return refused;
  const sp = new URL(request.url).searchParams;
  const [start, end, cs, ce] = ['start', 'end', 'compStart', 'compEnd'].map(k => sp.get(k) ?? '');
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (![start, end, cs, ce].every(v => ymd.test(v))) return NextResponse.json({ error: 'start, end, compStart and compEnd must be YYYY-MM-DD' }, { status: 400 });
  try {
    const [current, prior] = await Promise.all([fetchEtzHostnameBreakdown(start, end), fetchEtzHostnameBreakdown(cs, ce)]);
    return NextResponse.json({ period: { start, end }, comparison: { start: cs, end: ce }, current, prior });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read Google Analytics' }, { status: 502 });
  }
}
