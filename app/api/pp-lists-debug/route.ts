/**
 * GET /api/pp-lists-debug?q=<search term>
 *
 * TEMPORARY diagnostic route — not linked from any UI.
 * Searches HubSpot lists by name and returns a compact summary (name, listId,
 * size) instead of the full raw payload, so we can find the right list names
 * for Teacher/Parent segments without dumping huge JSON into chat.
 *
 * Delete this route once /api/pp-contacts-segments is fixed and confirmed.
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

interface HsListRow {
  listId: string;
  name: string;
  folder?: string;
  size: number;
}

async function searchLists(query: string | undefined, offset: number): Promise<{ lists: HsListRow[]; total: number; hasMore: boolean }> {
  const body: Record<string, unknown> = { count: 100, offset };
  if (query) body.query = query;

  const res = await fetch(`${HS_BASE}/crm/v3/lists/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) return { lists: [], total: 0, hasMore: false };
  const json = await res.json();

  const lists: HsListRow[] = (json.lists ?? []).map((l: {
    listId: string; name: string;
    additionalProperties?: { hs_list_size?: string; hs_folder_name?: string };
  }) => ({
    listId: l.listId,
    name: l.name,
    folder: l.additionalProperties?.hs_folder_name,
    size: Number(l.additionalProperties?.hs_list_size ?? 0),
  }));

  return { lists, total: json.total ?? 0, hasMore: json.hasMore ?? false };
}

export async function GET(req: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const result = await searchLists(q, offset);

  return NextResponse.json({ connected: true, query: q ?? null, ...result });
}
