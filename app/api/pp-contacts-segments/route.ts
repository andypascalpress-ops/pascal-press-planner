/**
 * GET /api/pp-contacts-segments
 *
 * Returns active contact counts for the 6 audience segments (K-2, 3-6,
 * 7-10, 11-12, Teacher, Parent) from specific HubSpot lists, confirmed via
 * a diagnostic dump of /crm/v3/lists/search against the live account.
 *
 * Each list ID below was picked from the actual HubSpot list names/sizes —
 * not pattern-guessed. The year-band lists follow a "PP - Years X to Y
 * (Books) Purchase after YYYY" naming convention that rotates forward each
 * year; these are the highest-year (most current) list per band. Teacher
 * and Parent were confirmed with the user directly since no single naming
 * convention covered them cleanly:
 *   - Teacher: "PP - All Teachers" — matches the PP-prefixed convention.
 *   - Parent: "FS // PP - All Parents (Purchased & Non-Purchases)" — the
 *     only all-parents list found; note it's larger than total active
 *     marketing contacts (128K vs 49K) since it includes non-marketable
 *     and purchase-only contacts, so its % share will look disproportionate.
 */
import { NextResponse } from 'next/server';

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
    const size = list.additionalProperties?.hs_list_size;
    return size != null ? Number(size) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const sizes = await Promise.all(SEGMENTS.map(s => fetchListSize(s.listId)));

  const segments = SEGMENTS.map((s, i) => ({
    key: s.key,
    label: s.label,
    active: sizes[i],
    listName: s.name,
  }));

  return NextResponse.json({ connected: true, segments });
}
