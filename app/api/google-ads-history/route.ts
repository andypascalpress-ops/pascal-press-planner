/**
 * Live Google Ads spend history from Jan 2026 to current month.
 *
 * GET /api/google-ads-history
 * Returns: Array<{ month: 'YYYY-MM', pp: number, etz: number }>
 *
 * Before July 2026: both brands pulled from PP account, split by campaign name.
 * July 2026+: ETZ pulled from its own account (GOOGLE_ADS_ETZ_CUSTOMER_ID).
 */
import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';

export const dynamic = 'force-dynamic';

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

function toYm(monthName: string): string | null {
  const num = MONTH_TO_NUM[monthName];
  return num ? `2026-${num}` : null;
}

export async function GET() {
  const CHART_MONTHS = buildMonths();
  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

  const ppCfg  = buildConfig('pp');
  const etzCfg = buildConfig('etz'); // uses ETZ account if GOOGLE_ADS_ETZ_CUSTOMER_ID is set

  const ppByMonth:  Record<string, number> = {};
  const etzByMonth: Record<string, number> = {};

  try {
    // ── Pre-July: pull both from PP account, split by campaign name ──────────
    const preStart = '2026-01-01';
    const preEnd   = '2026-06-30';

    const [ppPreRows, etzPreRows] = await Promise.all([
      fetchMonthlySpend(ppCfg, preStart, preEnd, { excludes: 'ETZ' }),
      fetchMonthlySpend(ppCfg, preStart, preEnd, { contains: 'ETZ' }),
    ]);
    for (const r of ppPreRows)  { const ym = toYm(r.month); if (ym) ppByMonth[ym]  = Math.round(r.actualSpend * 100) / 100; }
    for (const r of etzPreRows) { const ym = toYm(r.month); if (ym) etzByMonth[ym] = Math.round(r.actualSpend * 100) / 100; }

    // ── July onwards: PP account (excl ETZ) + ETZ own account ────────────────
    const postStart = `${ETZ_START_MONTH}-01`;
    if (postStart <= endDate) {
      const [ppPostRows, etzPostRows] = await Promise.all([
        fetchMonthlySpend(ppCfg,  postStart, endDate, { excludes: 'ETZ' }),
        fetchMonthlySpend(etzCfg, postStart, endDate),
      ]);
      for (const r of ppPostRows)  { const ym = toYm(r.month); if (ym) ppByMonth[ym]  = Math.round(r.actualSpend * 100) / 100; }
      for (const r of etzPostRows) { const ym = toYm(r.month); if (ym) etzByMonth[ym] = Math.round(r.actualSpend * 100) / 100; }
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
