/**
 * GET /api/blake-downloads-period?start=&end=&compStart=&compEnd=   (all YYYY-MM-DD)
 *
 * Blake Education PDF downloads (digital product units sold) for a period and its comparison period.
 * Product names and counts only, no customer details. Each range is limited to about a year.
 */
import { NextResponse } from 'next/server';
import { fetchBlakeDownloadsRange } from '@/lib/blake-downloads-range';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const [start, end, compStart, compEnd] = ['start', 'end', 'compStart', 'compEnd'].map(k => sp.get(k) ?? '') as [string, string, string, string];
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (![start, end, compStart, compEnd].every(v => ymd.test(v)) || start > end || compStart > compEnd) {
    return NextResponse.json({ error: 'start, end, compStart and compEnd must be YYYY-MM-DD with each start on or before its end' }, { status: 400 });
  }
  const span = (a: string, b: string) => (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000 + 1;
  if (span(start, end) > 400 || span(compStart, compEnd) > 400) return NextResponse.json({ error: 'ranges are limited to about a year' }, { status: 400 });

  try {
    const data = await fetchBlakeDownloadsRange(start, end, compStart, compEnd);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' } });
  } catch (e) {
    console.error('[blake-downloads-period]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read downloads' }, { status: 502 });
  }
}
