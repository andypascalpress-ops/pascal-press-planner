/**
 * GET /api/debug-ads
 * Diagnostic endpoint — returns raw Google Ads connection status for PP and ETZ.
 * Tests both a full-month range (original behaviour) and today-only.
 * Remove this file once the PP connection issue is resolved.
 */
import { NextResponse } from 'next/server';
import { buildConfig, fetchMonthlySpend } from '@/lib/google-ads';

export const dynamic = 'force-dynamic';

async function testAccount(
  brand: 'pp' | 'etz',
  startDate: string,
  endDate: string,
  filter?: { excludes: string } | { contains: string },
) {
  try {
    const cfg = buildConfig(brand);
    const customerId = cfg.customerId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    try {
      const rows = await fetchMonthlySpend(cfg, startDate, endDate, filter);
      return { ok: true, customerId, rows, error: null };
    } catch (e) {
      return { ok: false, customerId, rows: null, error: String(e) };
    }
  } catch (e) {
    return { ok: false, customerId: '(config failed)', rows: null, error: String(e) };
  }
}

export async function GET() {
  const now = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayStr  = ymd(now);
  const monthStr  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const daysInMon = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthEnd  = `${monthStr}-${String(daysInMon).padStart(2, '0')}`;
  const monthStart = `${monthStr}-01`;

  const [ppToday, ppMonth, etzToday, etzMonth] = await Promise.allSettled([
    testAccount('pp',  todayStr,   todayStr,   { excludes: 'ETZ' }),
    testAccount('pp',  monthStart, monthEnd,   { excludes: 'ETZ' }),
    testAccount('etz', todayStr,   todayStr),
    testAccount('etz', monthStart, monthEnd),
  ]);

  const unwrap = (r: PromiseSettledResult<unknown>) =>
    r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) };

  return NextResponse.json({
    serverDate: todayStr,
    month: monthStr,
    pp: {
      today:     unwrap(ppToday),
      fullMonth: unwrap(ppMonth),
    },
    etz: {
      today:     unwrap(etzToday),
      fullMonth: unwrap(etzMonth),
    },
  });
}
