/**
 * GET /api/hubspot-contacts-growth
 *
 * 12-month growth trend of HubSpot marketing contacts (hs_marketable_status
 * = true) per business unit, using the same `brand` checkbox property as
 * /api/hubspot-contacts-breakdown.
 *
 * Each point is a CUMULATIVE count: contacts tagged with that brand (any
 * tag — a contact tagged with 2+ brands counts toward each one, same basis
 * as the breakdown route's `anyBrand`/overlap figures) AND created on or
 * before that month's end AND currently marketable. This is the closest
 * available approximation of "brand X's contact base size at that point
 * in time" — HubSpot doesn't keep historical snapshots of a property's
 * value, only the current state plus each contact's creation date, so a
 * contact who signed up 8 months ago and has since unsubscribed won't show
 * up at any point on this chart, even the months before they unsubscribed.
 * That means early months are a slight underestimate of the TRUE
 * historical total, not an exact record — but it's the right shape for a
 * growth trend and is the same creation-date-bucketing approach already
 * used for revenue/trials trends elsewhere in this app.
 *
 * Queries run sequentially with throttling/retry, same reliability
 * approach as hubspot-contacts-breakdown (see that file's comment for why
 * naive Promise.all silently returned wrong data here).
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countContacts(filters: object[]): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: hsHeaders(),
        body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json() as { total?: number };
      if (typeof json.total !== 'number') return null;
      return json.total;
    } catch {
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

async function countContactsThrottled(filters: object[]): Promise<number | null> {
  const result = await countContacts(filters);
  await sleep(120);
  return result;
}

interface BrandOption { label: string; value: string }

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Last N calendar months (oldest -> newest), as YYYY-MM, ending at the current month. */
function lastNMonths(n: number): string[] {
  const today = toYMD(new Date());
  const [y, m] = [parseInt(today.slice(0, 4)), parseInt(today.slice(5, 7))];
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let mo = m - i, yr = y;
    while (mo < 1) { mo += 12; yr--; }
    months.push(`${yr}-${String(mo).padStart(2, '0')}`);
  }
  return months;
}

/** Epoch ms for the AEST instant just after the end of a YYYY-MM month. */
function monthEndMs(month: string): number {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return new Date(`${month}-${String(lastDay).padStart(2, '0')}T23:59:59+10:00`).getTime();
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const propRes = await fetch(`${HS_BASE}/crm/v3/properties/contacts/brand`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  if (!propRes.ok) {
    return NextResponse.json({ connected: false, error: 'Could not load the brand property' }, { status: 500 });
  }
  const brandProp = await propRes.json() as { options?: BrandOption[] };
  const brandNames = (brandProp.options ?? []).map(o => o.value);

  const months = lastNMonths(12);
  const MARKETABLE = { propertyName: 'hs_marketable_status', operator: 'EQ', value: 'true' };

  const failedQueries: string[] = [];
  const need = (label: string, n: number | null): number => {
    if (n === null) failedQueries.push(label);
    return n ?? 0;
  };

  const series: Record<string, number[]> = {};
  for (const brand of brandNames) {
    const points: number[] = [];
    for (const month of months) {
      const count = need(`${brand}:${month}`, await countContactsThrottled([
        MARKETABLE,
        { propertyName: 'brand', operator: 'CONTAINS_TOKEN', value: brand },
        { propertyName: 'createdate', operator: 'LTE', value: String(monthEndMs(month)) },
      ]));
      points.push(count);
    }
    series[brand] = points;
  }

  if (failedQueries.length > 0) {
    return NextResponse.json({
      connected: false,
      error: `HubSpot query failed after retries: ${failedQueries.join(', ')}`,
    }, { status: 502 });
  }

  return NextResponse.json({ connected: true, months, series });
}
