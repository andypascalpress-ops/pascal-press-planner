import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig, etzHasOwnAccount } from '@/lib/google-ads';
import { getSpendRecords, updateSpendRecord } from '@/lib/monday-spend';

export const dynamic = 'force-dynamic';

// Date range to sync — covers full FY26
const SYNC_START = '2025-07-01';
const SYNC_END   = '2026-06-30';

// Campaign name fragment used to identify ETZ campaigns within the PP account
const ETZ_CAMPAIGN_FILTER = 'ETZ';

async function runSync() {
  try {
    const ppConfig  = buildConfig('pp');
    const etzConfig = buildConfig('etz');
    const etzOwn    = etzHasOwnAccount();

    // When ETZ is in the PP account, split by campaign name filter.
    // When ETZ has its own sub-account, query each account unfiltered.
    const [ppSpend, etzSpend] = await Promise.all([
      fetchMonthlySpend(
        ppConfig, SYNC_START, SYNC_END,
        etzOwn ? undefined : { excludes: ETZ_CAMPAIGN_FILTER }
      ),
      fetchMonthlySpend(
        etzConfig, SYNC_START, SYNC_END,
        etzOwn ? undefined : { contains: ETZ_CAMPAIGN_FILTER }
      ),
    ]);

    // Load current Monday.com records once
    const records = await getSpendRecords();

    let updated = 0;
    const skipped: string[] = [];

    const applyUpdates = async (
      spend: typeof ppSpend,
      brand: string
    ) => {
      for (const { month, actualSpend, attributedRevenue } of spend) {
        const record = records.find(
          r =>
            r.brand   === brand &&
            r.channel === 'Google Ads' &&
            r.month   === month &&
            r.fy      === 'FY26'
        );
        if (!record) {
          skipped.push(`${brand} · Google Ads · ${month}`);
          continue;
        }
        await updateSpendRecord(record.id, { actualSpend, attributedRevenue });
        updated++;
      }
    };

    await applyUpdates(ppSpend,  'Pascal Press');
    await applyUpdates(etzSpend, 'Excel Test Zone');

    return NextResponse.json({
      success: true,
      updated,
      skipped: skipped.length ? skipped : undefined,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync-google-ads]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Manual trigger from UI
export async function POST() {
  return runSync();
}

// Vercel Cron trigger (runs via GET)
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSync();
}
