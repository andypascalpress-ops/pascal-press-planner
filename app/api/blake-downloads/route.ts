import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchBlakeDownloads } from '@/lib/blake-data';

// Scanning all products for downloads is expensive — cache result for 12 hours
const getCachedDownloads = unstable_cache(
  () => fetchBlakeDownloads(),
  ['blake-downloads-all'],
  { revalidate: 43200 },
);

export async function GET() {
  const data = await getCachedDownloads();
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=600',
    },
  });
}
