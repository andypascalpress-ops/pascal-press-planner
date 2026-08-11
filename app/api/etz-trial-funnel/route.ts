/**
 * GET /api/etz-trial-funnel?month=YYYY-MM
 *
 * Returns ETZ free-trial funnel data from HubSpot:
 *  - Trials started this month  (contacts created this month whose lead status is the trial value)
 *  - Converted this month       (contacts created this month who are now "active")
 *  - All-time totals + overall conversion rate
 *
 * How it works:
 *   1. Fetches the hs_lead_status property definition to discover the exact enum values
 *      used for "trial" and "active" (case-insensitive match).
 *   2. Counts contacts using HubSpot's CRM search API with date + status filters.
 *
 * Required Vercel env var:  HUBSPOT_API_KEY  (Private App token)
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

async function hsGet(path: string) {
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: hsHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot GET ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function hsSearchCount(filters: object[]): Promise<number> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters }],
      limit: 1,
      properties: ['hs_lead_status'],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot search → ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.total as number) ?? 0;
}

/** Convert YYYY-MM to epoch ms range for the month (AEST-aware: use UTC midnight) */
function monthToEpochRange(month: string): { startMs: number; endMs: number } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  // First ms of next month = last ms + 1
  const end   = new Date(Date.UTC(y!, m!, 1));
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export async function GET(request: Request) {
  const token = process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'No HubSpot token configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ?debug=1 — returns distinct hs_lead_status values to identify the correct casing
  if (searchParams.get('debug') === '1') {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hsHeaders(),
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'hs_lead_status', operator: 'HAS_PROPERTY' }] }],
        limit: 100,
        properties: ['hs_lead_status'],
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    const values = [...new Set((json.results ?? []).map((c: { properties: { hs_lead_status: string } }) => c.properties?.hs_lead_status))].filter(Boolean);
    return NextResponse.json({ total: json.total, distinctValues: values });
  }

  try {
    // ── 1. HubSpot lead status values (confirmed via debug endpoint) ──────────
    // "Active"       = converted to paying subscriber
    // "Trial Expired"= trialled but never converted
    // "Expired"      = was paying, subscription has since lapsed
    // (no status)    = currently on free trial

    // ── 2. Date range for selected month ──────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);
    const createdThisMonth = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ];

    // ── 3. Counts — sequential to respect HubSpot's search rate limit ─────────
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // This month: all new signups (any status = started a trial this month)
    const signupsThisMonth   = await hsSearchCount(createdThisMonth);
    await delay(300);
    // This month: already converted within the same month
    const convertedThisMonth = await hsSearchCount([...createdThisMonth, { propertyName: 'hs_lead_status', operator: 'EQ', value: 'Active' }]);
    await delay(300);

    // All time
    const totalActive        = await hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: 'Active'       }]);
    await delay(300);
    const totalTrialExpired  = await hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: 'Trial Expired' }]);
    await delay(300);
    const totalExpired       = await hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: 'Expired'      }]);

    // ── 4. Derived metrics ────────────────────────────────────────────────────
    // Currently on trial = no status set yet (total - all known statuses)
    const totalAll       = await (async () => { await delay(300); return hsSearchCount([]); })();
    const currentlyOnTrial = Math.max(0, totalAll - totalActive - totalTrialExpired - totalExpired);

    // Conversion rate = Active / (Active + Trial Expired)  — excludes still-trialling
    const concluded      = totalActive + totalTrialExpired;
    const convRateAllTime = concluded > 0 ? totalActive / concluded : null;
    const convRateMonth   = signupsThisMonth > 0 ? convertedThisMonth / signupsThisMonth : null;

    return NextResponse.json({
      month,

      thisMonth: {
        signups:        signupsThisMonth,
        converted:      convertedThisMonth,
        conversionRate: convRateMonth,        // 0–1
      },

      allTime: {
        total:          totalAll,
        onTrial:        currentlyOnTrial,
        active:         totalActive,
        trialExpired:   totalTrialExpired,
        expired:        totalExpired,
        conversionRate: convRateAllTime,      // Active ÷ (Active + Trial Expired)
      },
    });

  } catch (e) {
    console.error('[etz-trial-funnel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
