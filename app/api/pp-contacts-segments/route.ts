/**
 * GET /api/pp-contacts-segments
 *
 * Returns active contact counts AND real joiners-this-week/last-week for
 * the 6 audience segments (K-2, 3-6, 7-10, 11-12, Teacher, Parent), from
 * specific HubSpot lists confirmed via a diagnostic dump of the live
 * account (not pattern-guessed — see git history for the earlier attempts
 * that silently failed on wrong field names).
 *
 * Joiners come from GET /crm/v3/lists/{id}/memberships/join-order, which
 * returns each contact's membershipTimestamp sorted newest-first — we page
 * through it and stop as soon as we cross the "last week" boundary.
 *
 * There's no equivalent HubSpot endpoint for *removals* from a list, so
 * per-segment unsubscribe counts aren't included here (unlike the overall
 * unsubscribe count on /api/pp-marketing-contacts, which uses real email
 * campaign unsubscribe data instead).
 *
 * List picks:
 *   - K-2/3-6/7-10/11-12: highest-year "PP - Years X to Y (Books) Purchase
 *     after YYYY" list per band (the naming convention rotates forward
 *     each year).
 *   - Teacher: "PP - All Teachers" — matches the PP-prefixed convention.
 *   - Parent: "FS // PP - All Parents (Purchased & Non-Purchases)" — the
 *     only all-parents list found; confirmed with the user. It's larger
 *     than total active marketing contacts (128K vs 49K) since it includes
 *     non-marketable and purchase-only contacts.
 */
import { NextResponse } from 'next/server';
import { rangeBoundaries, type RangeParam } from '@/lib/pp-range';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

const SEGMENTS = [
  { key: 'k2',      label: 'K–2',     listId: '4893', name: 'PP - Years K to 2 Books Purchase after 2023' },
  { key: '36',      label: '3–6',     listId: '4896', name: 'PP - Years 3 to 6 Purchase after 2023' },
  { key: '710',     label: '7–10',    listId: '4895', name: 'PP - Years 7 to 10 Books Purchase after 2023' },
  { key: '1112',    label: '11–12',   listId: '4897', name: 'PP - Years 11 to 12 Books Purchase after 2024' },
  { key: 'teacher', label: 'Teacher', listId: '1155', name: 'PP - All Teachers' },
  { key: 'parent',  label: 'Parent',  listId: '3767', name: 'FS // PP - All Parents (Purchased & Non-Purchases)' },
] as const;

async function fetchListSize(listId: string): Promise<number | null> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/lists/${listId}`, {
      headers: hsHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json.list ?? json;
    // GET /crm/v3/lists/{id} puts size directly on the list object (unlike
    // the search endpoint, which nests it under additionalProperties.hs_list_size)
    const size = list.size ?? list.additionalProperties?.hs_list_size;
    return size != null ? Number(size) : null;
  } catch {
    return null;
  }
}

interface MembershipRow {
  membershipTimestamp: string;
}

/**
 * Pages join-order (newest-first) and stops once timestamps fall before
 * prevStart. Both periods are bounded on both ends — needed for ranges like
 * "yesterday" or "lastmonth" where "this period" isn't open-ended through now.
 */
async function fetchJoinersInWindow(
  listId: string,
  thisStart: number,
  thisEnd: number,
  prevStart: number,
  prevEnd: number,
): Promise<{ thisPeriod: number; prevPeriod: number }> {
  let thisPeriod = 0;
  let prevPeriod = 0;
  let after: string | undefined;
  const MAX_PAGES = 25; // safety valve for very large/active lists (e.g. Parent)

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${HS_BASE}/crm/v3/lists/${listId}/memberships/join-order`);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: hsHeaders(), cache: 'no-store' });
    } catch {
      break;
    }
    if (!res.ok) break;
    const json = await res.json();
    const results: MembershipRow[] = json.results ?? [];

    let crossedBoundary = false;
    for (const r of results) {
      const ts = new Date(r.membershipTimestamp).getTime();
      if (ts >= thisStart && ts < thisEnd) thisPeriod++;
      else if (ts >= prevStart && ts < prevEnd) prevPeriod++;
      if (ts < prevStart) { crossedBoundary = true; break; }
    }

    const nextAfter = json.paging?.next?.after;
    if (crossedBoundary || !nextAfter) break;
    after = nextAfter;
  }

  return { thisPeriod, prevPeriod };
}

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') ?? 'last7') as RangeParam;
  const { startMs, endMs, prevStartMs, prevEndMs } = rangeBoundaries(range);

  const segments = await Promise.all(SEGMENTS.map(async s => {
    const [active, joiners] = await Promise.all([
      fetchListSize(s.listId),
      fetchJoinersInWindow(s.listId, startMs, endMs, prevStartMs, prevEndMs),
    ]);
    return {
      key: s.key,
      label: s.label,
      active,
      joinersThisWeek: joiners.thisPeriod,
      joinersLastWeek: joiners.prevPeriod,
      listName: s.name,
    };
  }));

  return NextResponse.json({ connected: true, segments });
}
