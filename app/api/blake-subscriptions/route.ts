import { NextResponse } from 'next/server';
import { fetchBlakeSubscriptions } from '@/lib/blake-data';

export async function GET() {
  const data = await fetchBlakeSubscriptions();
  return NextResponse.json(data, {
    headers: {
      // Subscription counts per month — 5 min edge cache
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
