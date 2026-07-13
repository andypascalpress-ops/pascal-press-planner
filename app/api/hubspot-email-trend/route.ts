/**
 * GET /api/hubspot-email-trend
 * Single-pass 12-month HubSpot email trend, sliced by brand.
 * Months always run through the current Sydney month (e.g. Jul 2026).
 */
import { NextResponse } from 'next/server';
import { fetchEmailTrend } from '@/lib/hubspot-email';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET() {
  try {
    const data = await fetchEmailTrend(12);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
