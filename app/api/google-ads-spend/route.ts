/**
 * Live Google Ads spend for a given month — queried directly from the Google Ads API.
 *
 * GET /api/google-ads-spend?month=YYYY-MM
 *
 * PP campaigns: all campaigns NOT containing 'ETZ' in the name
 * ETZ campaigns: separate account (GOOGLE_ADS_ETZ_CUSTOMER_ID) from 2026-07 onwards.
 *   Months before ETZ_START_MONTH always return 0 for ETZ.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig, etzHasOwnAccount } from '@/lib/google-ads';

const ETZ_START_MONTH = '2026-07';

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const month    = req.nextUrl.searchParams.get('month') ?? currentYearMonth();
  const [ys, ms] = month.split('-');
  const year     = parseInt(ys ?? '2026', 10);
  const mon      = parseInt(ms ?? '1',    10);
  const lastDay  = new Date(year, mon, 0).getDate();
  const startDate = `${month}-01`;
  const endDate   = `${month}-${String(lastDay).padStart(2, '0')}`;

  // ETZ account only has data from July 2026
  const etzBeforeStart = month < ETZ_START_MONTH;

  try {
    const ppCfg = buildConfig('pp');

    const [ppRows, etzRows] = await Promise.all([
      fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' }),
      etzBeforeStart
        ? Promise.resolve([])
        : etzHasOwnAccount()
          ? fetchMonthlySpend(buildConfig('etz'), startDate, endDate)
          : fetchMonthlySpend(ppCfg, startDate, endDate, { contains: 'ETZ' }),
    ]);

    const ppSpend  = Math.round(ppRows.reduce( (s, r) => s + r.actualSpend, 0) * 100) / 100;
    const etzSpend = Math.round(etzRows.reduce((s, r) => s + r.actualSpend, 0) * 100) / 100;

    return NextResponse.json({
      month,
      pp:  { spend: ppSpend,  connected: true },
      etz: { spend: etzSpend, connected: true },
    });
  } catch (err) {
    console.error('[google-ads-spend]', err);
    return NextResponse.json({
      month,
      pp:  { spend: 0, connected: false },
      etz: { spend: 0, connected: false },
    });
  }
}
