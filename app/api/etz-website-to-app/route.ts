/**
 * GET /api/etz-website-to-app?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Aggregate counts only: sessions and new users on app.exceltestzone.com.au that arrived from
 * exceltestzone.com.au, and how many people signed up (GA4 event ua_sign_up), split new / returning.
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
