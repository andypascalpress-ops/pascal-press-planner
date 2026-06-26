import { NextResponse } from 'next/server';
import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { getSpendRecords, updateSpendRecord } from '@/lib/monday-spend';

// Date range to sync — Jan–Jun FY26
// Update these each financial year or make dynamic as needed
const SYNC_START = '2026-01-01';
const SYNC_END   = '2026-06-30';

export async function POST() {
  try {
    const ppConfig  = buildConfig('pp');
    const etzConfig = buildConfig('etz');

    // Fetch live spend from both Google Ads accounts in parallel
    const [ppSpend, etzSpend] = await Promise.all([
      fetchMonthlySpend(ppConfig,  SYNC_START, SYNC_END),
      fetchMonthlySpend(etzConfig, SYNC_START, SYNC_END),
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
