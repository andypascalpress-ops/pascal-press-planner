/**
 * GET /api/ehc-hubspot-overview
 *
 * Excel HSC Copilot picture from HubSpot (aggregate counts only, no personal data), mirroring the
 * "Excel HSC Copilot (Deals)" HubSpot dashboard plus a weekly deals-by-type view. The logic lives in
 * lib/ehc-overview.ts so the executive-summary PDF uses exactly the same numbers.
 */
import { NextResponse } from 'next/server';
import { fetchEhcOverview } from '@/lib/ehc-overview';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const overview = await fetchEhcOverview();
    return NextResponse.json(
      { connected: true, ...overview },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=600' } },
    );
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : 'Failed to load' }, { status: 502 });
  }
}
