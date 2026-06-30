/**
 * Live Google Ads spend history for FY26 Jan–Jun — queried directly from Google Ads API.
 *
 * GET /api/google-ads-history
 * Returns: Array<{ month: 'YYYY-MM', pp: number, etz: number }>
 */
import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig, etzHasOwnAccount } from '@/lib/google-ads';

const CHART_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

const MONTH_TO_NUM: Record<string, string> = {
  January: '01', February: '02', March: '03',   April:    '04',
  May:     '05', June:     '06', July:  '07',   August:   '08',
  September: '09', October: '10', November: '11', December: '12',
};

export async function GET() {
  try {
    const ppCfg     = buildConfig('pp');
    const startDate = '2026-01-01';
    const endDate   = '2026-06-30';

    const [ppRows, etzRows] = await Promise.all([
      fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' }),
      etzHasOwnAccount()
        ? fetchMonthlySpend(buildConfig('etz'), startDate, endDate)
        : fetchMonthlySpend(ppCfg, startDate, endDate, { contains: 'ETZ' }),
    ]);

    const ppByMonth:  Record<string, number> = {};
    const etzByMonth: Record<string, number> = {};

    for (const r of ppRows) {
      const num = MONTH_TO_NUM[r.month];
      if (num) ppByMonth[`2026-${num}`] = Math.round(r.actualSpend * 100) / 100;
    }
    for (const r of etzRows) {
      const num = MONTH_TO_NUM[r.month];
      if (num) etzByMonth[`2026-${num}`] = Math.round(r.actualSpend * 100) / 100;
    }

    return NextResponse.json(
      CHART_MONTHS.map(ym => ({
        month: ym,
        pp:  ppByMonth[ym]  ?? 0,
        etz: etzByMonth[ym] ?? 0,
      }))
    );
  } catch (err) {
    console.error('[google-ads-history]', err);
    return NextResponse.json(
      CHART_MONTHS.map(ym => ({ month: ym, pp: 0, etz: 0 }))
    );
  }
}
