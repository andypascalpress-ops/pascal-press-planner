/**
 * GET /api/etz-website-to-app?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Aggregate counts only, from the GA4 funnel report: people on exceltestzone.com.au who then visited
 * app.exceltestzone.com.au and signed up (event ua_sign_up).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEtzWebsiteToAppFunnel } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start') ?? '';
  const end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400 });
  }
  const data = await fetchEtzWebsiteToAppFunnel(start, end);
  return NextResponse.json({ period: { start, end }, ...data });
}
