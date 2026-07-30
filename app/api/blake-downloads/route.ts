import { NextResponse } from 'next/server';
import { fetchBlakeDownloads } from '@/lib/blake-data';

export const maxDuration = 60;

export async function GET() {
  const data = await fetchBlakeDownloads();
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
    },
  });
}
