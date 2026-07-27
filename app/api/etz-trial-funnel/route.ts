/**
 * GET /api/etz-trial-funnel
 * Queries Stripe subscriptions to calculate free-trial → paid conversion rate for ETZ.
 * Paginates through all subscriptions and groups by trial/status.
 */
import { NextResponse } from 'next/server';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_BASE = 'https://api.stripe.com/v1';

export const revalidate = 0;

function stripeHeaders() {
  return { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
}

interface StripeSub {
  id: string;
  status: string;          // trialing | active | canceled | past_due | incomplete | incomplete_expired | paused | unpaid
  trial_start: number | null;
  trial_end:   number | null;
  canceled_at: number | null;
  created:     number;
  current_period_start: number;
  current_period_end:   number;
}

async function fetchAllSubscriptions(status?: string): Promise<StripeSub[]> {
  const all: StripeSub[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`${STRIPE_BASE}/subscriptions?${params}`, {
      headers: stripeHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Stripe subscriptions (${status ?? 'all'}) → ${res.status}`);
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
    // Fetch subscriptions across all statuses in parallel
    const [active, trialing, canceled, pastDue, paused] = await Promise.all([
      fetchAllSubscriptions('active'),
      fetchAllSubscriptions('trialing'),
      fetchAllSubscriptions('canceled'),
      fetchAllSubscriptions('past_due'),
      fetchAllSubscriptions('paused'),
    ]);

    const all = [...active, ...trialing, ...canceled, ...pastDue, ...paused];

    // Subscriptions that ever had a trial (trial_start is set)
    const hadTrial   = all.filter(s => s.trial_start != null);
    const noTrial    = all.filter(s => s.trial_start == null);

    // Of those that had a trial:
    const trialConverted  = hadTrial.filter(s => s.status === 'active');
    const trialStillIn    = hadTrial.filter(s => s.status === 'trialing');
    const trialCanceled   = hadTrial.filter(s => s.status === 'canceled');
    const trialPastDue    = hadTrial.filter(s => s.status === 'past_due');
    const trialPaused     = hadTrial.filter(s => s.status === 'paused');

    // Conversion rate = converted / (converted + cancelled + past_due)
    // Exclude currently trialing (outcome unknown) and paused (ambiguous)
    const trialDecided   = trialConverted.length + trialCanceled.length + trialPastDue.length;
    const conversionRate = trialDecided > 0
      ? Math.round((trialConverted.length / trialDecided) * 1000) / 10   // one decimal
      : null;

    // Monthly breakdown of trial starts (last 12 months)
    const now = Date.now() / 1000;
    const monthlyTrials: Record<string, { started: number; converted: number; canceled: number }> = {};
    for (const s of hadTrial) {
      const d = new Date((s.trial_start ?? s.created) * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthlyTrials[key]) monthlyTrials[key] = { started: 0, converted: 0, canceled: 0 };
      monthlyTrials[key].started++;
      if (s.status === 'active')   monthlyTrials[key].converted++;
      if (s.status === 'canceled') monthlyTrials[key].canceled++;
    }

    // Sort by month descending, keep last 12
    const monthlySeries = Object.entries(monthlyTrials)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 12)
      .map(([month, v]) => ({ month, ...v }));

    return NextResponse.json({
      // Total counts
      totalSubscriptions:  all.length,
      totalWithTrial:      hadTrial.length,
      totalWithoutTrial:   noTrial.length,

      // Trial funnel
      trialCurrently:  trialStillIn.length,
      trialConverted:  trialConverted.length,
      trialCanceled:   trialCanceled.length,
      trialPastDue:    trialPastDue.length,
      trialPaused:     trialPaused.length,

      // Key metric
      conversionRate,        // % of decided trials that converted
      trialDecided,          // denominator used

      // Active breakdown
      activeTotal:     active.length,
      activeFromTrial: trialConverted.length,
      activeDirect:    active.filter(s => s.trial_start == null).length,

      monthlySeries,         // last 12 months of trial starts
    });

  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
