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
  if (!process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ error: 'HUBSPOT_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  // Default to current month
  const now   = new Date();
  const month = searchParams.get('month')
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    // ── 1. Status values (Andy confirmed: lead status = "trial" / "active") ───
    // We try common casing variants in parallel and use whichever returns results.
    const CANDIDATES = {
      trial:  ['TRIAL',  'trial',  'Trial',  'free_trial', 'FREE_TRIAL'],
      active: ['ACTIVE', 'active', 'Active', 'subscriber', 'SUBSCRIBER'],
    };

    // Quick probe: find the casing that actually returns contacts
    async function findValue(candidates: string[]): Promise<string> {
      const counts = await Promise.all(
        candidates.map(v =>
          hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: v }])
            .then(n => ({ v, n }))
            .catch(() => ({ v, n: 0 }))
        )
      );
      const match = counts.find(c => c.n > 0);
      return match?.v ?? candidates[0]!; // fall back to first candidate
    }

    const [TRIAL_VALUE, ACTIVE_VALUE] = await Promise.all([
      findValue(CANDIDATES.trial),
      findValue(CANDIDATES.active),
    ]);

    // ── 2. Date range for selected month ──────────────────────────────────────
    const { startMs, endMs } = monthToEpochRange(month);
    const createdThisMonth = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LT',  value: String(endMs)   },
    ];

    // ── 3. Counts (run in parallel) ───────────────────────────────────────────
    const [
      trialsThisMonth,      // signed up this month, still on trial
      convertedThisMonth,   // signed up this month, already active
      totalTrialAllTime,    // all contacts ever with trial status (still on trial)
      totalActiveAllTime,   // all contacts ever who converted
    ] = await Promise.all([
      hsSearchCount([...createdThisMonth, { propertyName: 'hs_lead_status', operator: 'EQ', value: TRIAL_VALUE  }]),
      hsSearchCount([...createdThisMonth, { propertyName: 'hs_lead_status', operator: 'EQ', value: ACTIVE_VALUE }]),
      hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: TRIAL_VALUE  }]),
      hsSearchCount([{ propertyName: 'hs_lead_status', operator: 'EQ', value: ACTIVE_VALUE }]),
    ]);

    // ── 4. Derived metrics ────────────────────────────────────────────────────
    const signupsThisMonth   = trialsThisMonth + convertedThisMonth;  // all new signups (trial + already-converted)
    const convRateThisMonth  = signupsThisMonth  > 0 ? convertedThisMonth  / signupsThisMonth  : null;
    const totalSignupsAllTime = totalTrialAllTime + totalActiveAllTime;
    const convRateAllTime     = totalSignupsAllTime > 0 ? totalActiveAllTime / totalSignupsAllTime : null;

    return NextResponse.json({
      month,
      // Internal: so the UI knows which values were matched
      _statusValues: { trial: TRIAL_VALUE, active: ACTIVE_VALUE },

      // This month
      thisMonth: {
        signups:         signupsThisMonth,
        trialsRemaining: trialsThisMonth,
        converted:       convertedThisMonth,
        conversionRate:  convRateThisMonth,   // 0–1
      },

      // All-time
      allTime: {
        signups:   totalSignupsAllTime,
        onTrial:   totalTrialAllTime,
        converted: totalActiveAllTime,
        conversionRate: convRateAllTime,     // 0–1
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
