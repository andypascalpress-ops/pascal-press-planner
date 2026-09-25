/**
 * GET /api/pp-contacts-segments
 *
 * Auto-discovers Pascal Press HubSpot lists and groups them into
 * the 6 audience segments: K-2, 3-6, 7-10, 11-12, Teacher, Parent.
 *
 * Uses the HubSpot Lists API (requires crm.lists.read scope).
 * If multiple lists match a segment (e.g. "PP - Years 3 to 6 Purchase after 2023"
 * and "PP - Years 3 to 6 Purchase after 2024"), takes the one with the highest
 * member count as the active total.
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
  {
    key: 'k2',
    label: 'K–2',
    patterns: [/k[\s-]?to[\s-]?2/i, /\bprep\b/i, /\bfoundation\b/i, /year[\s-]?[12]\b/i, /years[\s-]?[12]\b/i],
  },
  {
    key: '36',
    label: '3–6',
    patterns: [/3[\s-]?to[\s-]?6/i, /year[\s-]?[3-6]\b/i, /years[\s-]?[3-6]\b/i],
  },
  {
    key: '710',
    label: '7–10',
    patterns: [/7[\s-]?to[\s-]?10/i, /year[\s-]?[7-9]\b/i, /years[\s-]?[7-9]\b/i, /year[\s-]?10\b/i, /years[\s-]?10\b/i],
  },
  {
    key: '1112',
    label: '11–12',
    patterns: [/11[\s-]?to[\s-]?12/i, /year[\s-]?1[12]\b/i, /years[\s-]?1[12]\b/i],
  },
  {
    key: 'teacher',
    label: 'Teacher',
    patterns: [/teacher/i],
  },
  {
    key: 'parent',
    label: 'Parent',
    patterns: [/parent/i],
  },
] as const;

type SegmentKey = typeof SEGMENTS[number]['key'];

function matchSegment(name: string): SegmentKey | null {
  for (const seg of SEGMENTS) {
    for (const pattern of seg.patterns) {
      if (pattern.test(name)) return seg.key;
    }
  }
  return null;
}

interface HubSpotList {
  listId: string;
  name: string;
  memberCount: number;
}

async function fetchPPLists(): Promise<HubSpotList[]> {
  const results: HubSpotList[] = [];
  try {
    // Search for lists with "PP" in the name — one call, up to 500 results
    const res = await fetch(`${HS_BASE}/crm/v3/lists/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ searchQuery: 'PP', count: 500 }),
      cache: 'no-store',
    });
    if (!res.ok) return results;
    const json = await res.json();

    for (const list of (json.lists ?? json.results ?? [])) {
      const name: string = list.name ?? '';
      // Only include lists clearly prefixed "PP" or "Pascal Press"
      if (/^PP[\s-]/i.test(name) || /pascal press/i.test(name)) {
        results.push({
          listId: list.listId ?? list.id ?? '',
          name,
          memberCount: list.memberCount ?? list.size ?? 0,
        });
      }
    }
  } catch { /* return empty */ }
  return results;
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const lists = await fetchPPLists();

  // Group by segment — if multiple lists match, keep the largest member count
  const best: Partial<Record<SegmentKey, { active: number; listNames: string[] }>> = {};

  for (const list of lists) {
    const key = matchSegment(list.name);
    if (!key) continue;
    const current = best[key];
    if (!current) {
      best[key] = { active: list.memberCount, listNames: [list.name] };
    } else if (list.memberCount > current.active) {
      best[key] = { active: list.memberCount, listNames: [...current.listNames, list.name] };
    } else {
      current.listNames.push(list.name);
    }
  }

  const segments = SEGMENTS.map(seg => ({
    key: seg.key,
    label: seg.label,
    active: best[seg.key]?.active ?? null,
    listNames: best[seg.key]?.listNames ?? [],
  }));

  return NextResponse.json({
    connected: true,
    segments,
    totalLists: lists.length,
  });
}
