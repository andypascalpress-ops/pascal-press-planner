/**
 * GET /api/website-conversion
 *   ?month=YYYY-MM                         → month window (Finance; align to prior month days)
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD       → exact range (Overview-style)
 *   &compare=priorEqual|alignMonth         → optional compare mode (default depends on params)
 *
 * Site-wide conversion rate (sessions → purchases) from GA4 for PP + ETZ.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchPPWebsiteConversion,
  fetchETZWebsiteConversion,
  type ConversionCompareMode,
} from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start');
  const end   = req.nextUrl.searchParams.get('end');
  const month = req.nextUrl.searchParams.get('month')
    ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());

  const compareParam = req.nextUrl.searchParams.get('compare') as ConversionCompareMode | null;

  let pp;
  let etz;
  let window: { start: string; end: string; compare: ConversionCompareMode };

  if (start && end) {
    const compare: ConversionCompareMode = compareParam ?? 'priorEqual';
    window = { start, end, compare };
    [pp, etz] = await Promise.all([
      fetchPPWebsiteConversion(start, end, compare),
      fetchETZWebsiteConversion(start, end, compare),
    ]);
  } else {
    const compare: ConversionCompareMode = compareParam ?? 'alignMonth';
    window = { start: month, end: month, compare };
    [pp, etz] = await Promise.all([
      fetchPPWebsiteConversion(month),
      fetchETZWebsiteConversion(month),
    ]);
  }

  return NextResponse.json({ month, range: window, pp, etz });
}
