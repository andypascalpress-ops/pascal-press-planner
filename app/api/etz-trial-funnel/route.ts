/**
 * GET /api/etz-trial-funnel
 * Calculates free-trial → paid conversion rate for ETZ from Stripe subscriptions.
 *
 * Strategy: two paginated passes (active+trialing default, then canceled) with a
 * 2-year date cap so the function stays well inside Vercel's 60s timeout.
 */
import { NextResponse } from 'next/server';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_BASE = 'https://api.stripe.com/v1';

export const revalidate = 0;

function stripeHeaders() {
  return { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
}

interface StripeSub {
  id:          string;
  status:      string;
  trial_start: number | null;
  trial_end:   number | null;
  canceled_at: number | null;
  created:     number;
}

// Fetch up to maxPages * 100 subscriptions for a given status
async function fetchSubs(status: string, createdGte: number, maxPages = 20): Promise<StripeSub[]> {
  const all: StripeSub[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      status,
      'created[gte]': String(createdGte),
      limit: '100',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`${STRIPE_BASE}/subscriptions?${params}`, {
      headers: stripeHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Stripe /subscriptions?status=${status} → ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: { data: StripeSub[]; has_more: boolean } = await res.json();
    all.push(...data.data);
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1]!.id;
  }
  return all;
}

export async function GET() {
  if (!STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }

  try {
    // 2-year lookback window (unix seconds)
    const twoYearsAgo = Math.floor(Date.now() / 1000) - 2 * 365 * 24 * 3600;

    // Fetch active+trialing and canceled in parallel (these cover the full funnel)
    // past_due and paused are treated as "still alive" (not decided) so lower priority
    const [activeSubs, trialingSubs, canceledSubs, pastDueSubs] = await Promise.all([
      fetchSubs('active',   twoYearsAgo),
      fetchSubs('trialing', twoYearsAgo),
      fetchSubs('canceled', twoYearsAgo),
      fetchSubs('past_due', twoYearsAgo),
    ]);

    const all = [...activeSubs, ...trialingSubs, ...canceledSubs, ...pastDueSubs];

    // Split by whether they ever had a trial
    const hadTrial = all.filter(s => s.trial_start != null);

    const trialConverted = hadTrial.filter(s => s.status === 'active');
    const trialStillIn   = hadTrial.filter(s => s.status === 'trialing');
    const trialCanceled  = hadTrial.filter(s => s.status === 'canceled');
    const trialPastDue   = hadTrial.filter(s => s.status === 'past_due');

    // Conversion rate denominator: people whose trial outcome is decided
    const decided        = trialConverted.length + trialCanceled.length + trialPastDue.length;
    const conversionRate = decided > 0
      ? Math.round((trialConverted.length / decided) * 1000) / 10
      : null;

    // Monthly breakdown — trial start month
    const monthly: Record<string, { started: number; converted: number; canceled: number }> = {};
    for (const s of hadTrial) {
      const d   = new Date((s.trial_start ?? s.created) * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { started: 0, converted: 0, canceled: 0 };
      monthly[key].started++;
      if (s.status === 'active')   monthly[key].converted++;
      if (s.status === 'canceled') monthly[key].canceled++;
    }

    const monthlySeries = Object.entries(monthly)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 12)
      .map(([month, v]) => ({
        month,
        started:   v.started,
        converted: v.converted,
        canceled:  v.canceled,
        rate:      v.started > 0 ? Math.round((v.converted / v.started) * 1000) / 10 : 0,
      }));

    return NextResponse.json({
      lookback: '2 years',
      totalFetched:    all.length,
      totalWithTrial:  hadTrial.length,
      trialCurrently:  trialStillIn.length,
      trialConverted:  trialConverted.length,
      trialCanceled:   trialCanceled.length,
      trialPastDue:    trialPastDue.length,
      decided,
      conversionRate,          // % — null if no data
      activeTotal:     activeSubs.length,
      activeFromTrial: trialConverted.length,
      activeDirect:    activeSubs.filter(s => s.trial_start == null).length,
      monthlySeries,
    });

  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
