import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchBlakeDownloads } from '@/lib/blake-data';

// Order-based scan — cache 10 minutes (same order as subscriptions)
const getCachedDownloads = unstable_cache(
  () => fetchBlakeDownloads(),
  ['blake-downloads-orders'],
  { revalidate: 600 },
);

export async function GET() {
  const data = await getCachedDownloads();
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
    },
  });
}
