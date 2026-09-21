/**
 * GET /api/hubspot-subscribers?month=YYYY-MM
 *
 * Returns new contacts from HubSpot for the given month, segmented by brand
 * using the contact `brand` property.
 *
 * new contacts – contacts created this month per brand (new sign-ups)
 *
 * Brand property values: "Pascal Press", "Excel Test Zone", "Excel HSC Copilot",
 * "Blake Education" (from the contact `brand` enumeration field).
 *
 * Required env var: HUBSPOT_CRM_TOKEN or HUBSPOT_API_KEY
 */
import { NextResponse } from 'next/server';

export const revalidate = 1800;

const HS_BASE = 'https://api.hubapi.com';

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function monthToEpochRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    startMs: new Date(Date.UTC(y!, m! - 1, 1)).getTime(),
    endMs:   new Date(Date.UTC(y!, m!,     1)).getTime(),
  };
}

async function hsContactCount(filterGroups: { filters: object[] }[]): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['createdate'] }),
      cache: 'no-store',
    });
    if (res.status === 429) {
      if (attempt === 0) { await delay(1100); continue; }
      throw new Error('HubSpot contacts search → 429 rate limit');
    }
    if (!res.ok) throw new Error(`HubSpot contacts search → ${res.status}`);
    const json = await res.json();
    return (json.total as number) ?? 0;
  }
  return 0;
}

const BRAND_VALUES: Record<string, string> = {
  pp:    'Pascal Press',
  etz:   'Excel Test Zone',
  hsc:   'Excel HSC Copilot',
  blake: 'Blake Education',
};

function newContactsFilter(brandValue: string, startMs: number, endMs: number) {
  return [{
    filters: [
      { propertyName: 'brand',                operator: 'EQ',  value: brandValue      },
      { propertyName: 'createdate',           operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate',           operator: 'LT',  value: String(endMs)   },
      { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'          },
    ],
  }];
}

export async function GET(request: Request) {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json(
      { error: 'No HubSpot token configured', connected: false },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM', connected: false }, { status: 400 });
  }

  const { startMs, endMs } = monthToEpochRange(month);

  try {
    // 4 brand queries + 1 total, all in parallel
    const [totalNew, ppNew, etzNew, hscNew, blakeNew] = await Promise.all([
      hsContactCount([{
        filters: [
          { propertyName: 'createdate',           operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate',           operator: 'LT',  value: String(endMs)   },
          { propertyName: 'hs_marketable_status', operator: 'EQ',  value: 'true'          },
        ],
      }]),
      hsContactCount(newContactsFilter(BRAND_VALUES.pp!,    startMs, endMs)),
      hsContactCount(newContactsFilter(BRAND_VALUES.etz!,   startMs, endMs)),
      hsContactCount(newContactsFilter(BRAND_VALUES.hsc!,   startMs, endMs)),
      hsContactCount(newContactsFilter(BRAND_VALUES.blake!, startMs, endMs)),
    ]);

    return NextResponse.json({
      month,
      connected: true,
      total: totalNew,
      pp:    ppNew,
      etz:   etzNew,
      hsc:   hscNew,
      blake: blakeNew,
    });
  } catch (e) {
    console.error('[hubspot-subscribers]', e);
    return NextResponse.json({
      month,
      connected: false,
      error:     e instanceof Error ? e.message : 'Unknown error',
      total: 0, pp: 0, etz: 0, hsc: 0, blake: 0,
    });
  }
}
