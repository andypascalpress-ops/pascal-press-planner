/**
 * Shared AEST date-range boundaries for the Pascal Press marketing contacts
 * card (/api/pp-marketing-contacts, /api/pp-contacts-segments), matching the
 * same range keys used by the top-of-tab filter in BusinessUnitsTab.tsx and
 * /api/overview.
 *
 * "This period" is the selected range; "prior period" is the immediately
 * preceding period of equal length (generalizes the original this-week vs
 * last-week comparison to every range option).
 */

export type RangeParam = 'today' | 'yesterday' | 'last7' | 'last30' | 'mtd' | 'lastmonth';

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function toAestYMD(ms: number): string {
  const d = new Date(ms + AEST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Midnight AEST of the given YYYY-MM-DD, expressed as a UTC epoch ms. */
function ymdToStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) - AEST_OFFSET_MS;
}

function addDaysToYMD(ymd: string, days: number): string {
  const startMs = ymdToStartMs(ymd) + AEST_OFFSET_MS; // back to "midnight-as-UTC" for date math
  const d = new Date(startMs);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface RangeBoundaries {
  /** Inclusive start of "this period", epoch ms. */
  startMs: number;
  /** Exclusive end of "this period" (start of the day after), epoch ms. */
  endMs: number;
  /** Inclusive start of the prior period (same length), epoch ms. */
  prevStartMs: number;
  /** Exclusive end of the prior period — equal to startMs. */
  prevEndMs: number;
  /** AEST YYYY-MM-DD strings, inclusive on both ends — for APIs that take date strings. */
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  label: string;
}

const RANGE_LABELS: Record<RangeParam, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  mtd: 'This month (MTD)',
  lastmonth: 'Last month',
};

export function rangeBoundaries(range: RangeParam): RangeBoundaries {
  const todayYmd = toAestYMD(Date.now());

  let startYmd: string;
  let endYmdExclusive: string; // first day NOT included

  switch (range) {
    case 'today':
      startYmd = todayYmd;
      endYmdExclusive = addDaysToYMD(todayYmd, 1);
      break;
    case 'yesterday':
      startYmd = addDaysToYMD(todayYmd, -1);
      endYmdExclusive = todayYmd;
      break;
    case 'last30':
      startYmd = addDaysToYMD(todayYmd, -29);
      endYmdExclusive = addDaysToYMD(todayYmd, 1);
      break;
    case 'lastmonth': {
      const [y, m] = todayYmd.split('-').map(Number);
      const lmY = m === 1 ? y! - 1 : y!;
      const lmM = m === 1 ? 12 : m! - 1;
      startYmd = `${lmY}-${String(lmM).padStart(2, '0')}-01`;
      endYmdExclusive = `${y}-${String(m).padStart(2, '0')}-01`;
      break;
    }
    case 'mtd': {
      const [y, m] = todayYmd.split('-').map(Number);
      startYmd = `${y}-${String(m).padStart(2, '0')}-01`;
      endYmdExclusive = addDaysToYMD(todayYmd, 1);
      break;
    }
    case 'last7':
    default:
      startYmd = addDaysToYMD(todayYmd, -6);
      endYmdExclusive = addDaysToYMD(todayYmd, 1);
      break;
  }

  const startMs = ymdToStartMs(startYmd);
  const endMs = ymdToStartMs(endYmdExclusive);
  const periodLen = endMs - startMs;
  const prevEndMs = startMs;
  const prevStartMs = startMs - periodLen;

  return {
    startMs,
    endMs,
    prevStartMs,
    prevEndMs,
    startDate: startYmd,
    endDate: addDaysToYMD(endYmdExclusive, -1),
    prevStartDate: toAestYMD(prevStartMs),
    prevEndDate: addDaysToYMD(startYmd, -1),
    label: RANGE_LABELS[range] ?? RANGE_LABELS.last7,
  };
}
