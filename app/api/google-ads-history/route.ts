/**
 * Live Google Ads spend history from Jan 2026 to current month.
 *
 * GET /api/google-ads-history
 * Returns: Array<{ month: 'YYYY-MM', pp: number, etz: number }>
 *
 * ETZ account (GOOGLE_ADS_ETZ_CUSTOMER_ID) started July 2026.
 * Months before 2026-07 always return 0 for ETZ regardless of account data.
 */
import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig, etzHasOwnAccount } from '@/lib/google-ads';

const ETZ_START_MONTH = '2026-07';

const MONTH_TO_NUM: Record<string, string> = {
  January: '01', February: '02', March:     '03', April:    '04',
  May:     '05', June:     '06', July:      '07', August:   '08',
  September: '09', October: '10', November: '11', December: '12',
};

function buildMonths(): string[] {
  const start = new Date(2026, 0, 1);
  const now   = new Date(); now.setDate(1);
  const result: string[] = [];
  const d = new Date(start);
  while (d <= now) {
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return result;
}

export async function GET() {
  const CHART_MONTHS = buildMonths();
  const startDate = '2026-01-01';
  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

  // ETZ only queried from its start month onwards
  const etzStartDate = `${ETZ_START_MONTH}-01`;

  try {
    const ppCfg = buildConfig('pp');

    const [ppRows, etzRows] = await Promise.all([
      fetchMonthlySpend(ppCfg, startDate, endDate, { excludes: 'ETZ' }),
      etzHasOwnAccount()
        ? fetchMonthlySpend(buildConfig('etz'), etzStartDate, endDate)
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
        pp:  ppByMonth[ym] ?? 0,
        // Hard cutoff: ETZ always 0 before its start month
        etz: ym >= ETZ_START_MONTH ? (etzByMonth[ym] ?? 0) : 0,
      }))
    );
  } catch (err) {
    console.error('[google-ads-history]', err);
    return NextResponse.json(
      CHART_MONTHS.map(ym => ({ month: ym, pp: 0, etz: 0 }))
    );
  }
}
