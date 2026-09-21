/**
 * GET /api/hubspot-subscribers?month=YYYY-MM
 *
 * Returns new contacts and email opt-outs from HubSpot for the given month,
 * segmented by brand using the contact `brand` property.
 *
 * new contacts  – contacts created this month per brand (proxy for new sign-ups)
 * optOuts       – contacts who have hs_email_optout=true and were modified this month
 *                 per brand (best-effort: lastmodifieddate proxy for opt-out date)
 *
 * Brand property values: "Pascal Press", "Excel Test Zone", "Excel HSC Copilot",
 * "Blake Education" (pulled from the contact `brand` enumeration field).
 *
 * Required env var: HUBSPOT_CRM_TOKEN or HUBSPOT_API_KEY
 */
import { NextResponse } from 'next/server';

export const revalidate = 1800; // 30-minute cache per URL

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

/** Count contacts matching the given filter groups (reads only total). */
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

// HubSpot `brand` property values per business unit
const BRAND_VALUES: Record<string, string> = {
  pp:    'Pascal Press',
  etz:   'Excel Test Zone',
  hsc:   'Excel HSC Copilot',
  blake: 'Blake Education',
};

/**
 * Count new contacts this month for a brand.
 * Filters: brand = X AND createdate in [startMs, endMs)
 */
function newContactsFilter(brandValue: string, startMs: number, endMs: number) {
  return [{
    filters: [
      { propertyName: 'brand',      operator: 'EQ',  value: brandValue    },
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ],
  }];
}

/**
 * Count contacts with hs_email_optout=true that were last modified this month.
 * This is a best-effort proxy for "opted out this month" — lastmodifieddate
 * is updated when any property changes, so it may slightly over-count if the
 * contact was modified for another reason while already opted out.
 */
function optOutFilter(brandValue: string, startMs: number, endMs: number) {
  return [{
    filters: [
      { propertyName: 'brand',            operator: 'EQ',  value: brandValue      },
      { propertyName: 'hs_email_optout',  operator: 'EQ',  value: 'true'          },
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'lastmodifieddate', operator: 'LT',  value: String(endMs)   },
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
    // Run all 8 brand queries in parallel (4 brands × 2 metrics)
    const brands = ['pp', 'etz', 'hsc', 'blake'] as const;
    const results = await Promise.all(
      brands.flatMap(key => {
        const bv = BRAND_VALUES[key]!;
        return [
          hsContactCount(newContactsFilter(bv, startMs, endMs)),
          hsContactCount(optOutFilter(bv, startMs, endMs)),
        ];
      })
    );

    // Also fetch overall totals (no brand filter)
    const [totalNew, totalOptOut] = await Promise.all([
      hsContactCount([{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
        ],
      }]),
      hsContactCount([{
        filters: [
          { propertyName: 'hs_email_optout',  operator: 'EQ',  value: 'true'          },
          { propertyName: 'lastmodifieddate', operator: 'GTE', value: String(startMs) },
          { propertyName: 'lastmodifieddate', operator: 'LT',  value: String(endMs)   },
        ],
      }]),
    ]);

    const [ppNew, ppOut, etzNew, etzOut, hscNew, hscOut, blakeNew, blakeOut] = results;

    return NextResponse.json({
      month,
      connected: true,
      total:  { newContacts: totalNew,  optOuts: totalOptOut  },
      pp:     { newContacts: ppNew!,    optOuts: ppOut!    },
      etz:    { newContacts: etzNew!,   optOuts: etzOut!   },
      hsc:    { newContacts: hscNew!,   optOuts: hscOut!   },
      blake:  { newContacts: blakeNew!, optOuts: blakeOut! },
    });
  } catch (e) {
    console.error('[hubspot-subscribers]', e);
    return NextResponse.json({
      month,
      connected:   false,
      error:       e instanceof Error ? e.message : 'Unknown error',
      total:  { newContacts: 0, optOuts: 0 },
      pp:     { newContacts: 0, optOuts: 0 },
      etz:    { newContacts: 0, optOuts: 0 },
      hsc:    { newContacts: 0, optOuts: 0 },
      blake:  { newContacts: 0, optOuts: 0 },
    });
  }
}
