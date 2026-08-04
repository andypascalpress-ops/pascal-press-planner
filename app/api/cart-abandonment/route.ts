import { NextResponse } from 'next/server';
import { fetchCartAbandonment } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days  = Math.min(parseInt(searchParams.get('days') ?? '30'), 90);
  const today = sydneyToday();
  const start = addDays(today, -(days - 1));

  const data = await fetchCartAbandonment(start, today);
  return NextResponse.json({ ...data, days }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  });
}
