import { NextResponse } from 'next/server';
import { fetchBlakeDownloads } from '@/lib/blake-data';

export async function GET() {
  const data = await fetchBlakeDownloads();
  return NextResponse.json(data, {
    headers: {
      // Download counts change infrequently — cache 1 hour at the edge
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300',
    },
  });
}
