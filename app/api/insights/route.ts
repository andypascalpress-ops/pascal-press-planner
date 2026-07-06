/**
 * POST /api/insights
 *
 * Builds a compact, data-driven briefing for Claude Haiku and returns 4–6
 * specific, named insights as a JSON array.
 *
 * ALWAYS returns at least 4 insights — if live data is sparse, Claude falls
 * back to Term 3 strategic recommendations for PP + ETZ.
 *
 * Edge runtime: Anthropic SDK compatible, no cold-start.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { MONTHLY_GOOGLE_BUDGETS } from '@/lib/constants';

export const runtime = 'edge';

const client = new Anthropic();

function money(n: number | undefined | null): string {
  return `$${Math.round(n ?? 0).toLocaleString('en-AU')}`;
}

function pct(n: number | undefined | null, dp = 1): string {
  return `${(n ?? 0).toFixed(dp)}%`;
}

export async function POST(req: NextRequest) {
  try {
    const { metrics } = await req.json();

    const campaigns = metrics?.campaigns  ?? {};
    const emailData = metrics?.email      ?? {};
    const band6Data = metrics?.band6      ?? {};
    const spendData = metrics?.spend      ?? [];
    const bc        = metrics?.bc         ?? {};
    const sources   = metrics?.sources    ?? {};

    // ── Spend records: filter to current AEST month ──────────────────────────
    const nowSyd = new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }));
    const curMonth = nowSyd.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' }); // e.g. "July"
    const spendRecords: any[] = Array.isArray(spendData) ? spendData : [];
    const thisMonthSpend = spendRecords.filter(r =>
      (r.month ?? '').toLowerCase() === curMonth.toLowerCase()
    );

    // Aggregate Google Ads spend per brand for this month
    const adSpend: Record<string, { budget: number; actual: number; revenue: number }> = {};
    for (const r of thisMonthSpend) {
      if (!(r.channel ?? '').toLowerCase().includes('google')) continue;
      const brand = r.brand ?? 'Unknown';
      if (!adSpend[brand]) adSpend[brand] = { budget: 0, actual: 0, revenue: 0 };
      adSpend[brand].budget  += Number(r.budget           ?? 0);
      adSpend[brand].actual  += Number(r.actualSpend      ?? 0);
      adSpend[brand].revenue += Number(r.attributedRevenue ?? 0);
    }

    // Fall back to constants if no Monday records yet
    if (!adSpend['Pascal Press'])    adSpend['Pascal Press']    = { budget: MONTHLY_GOOGLE_BUDGETS['Pascal Press']    ?? 8300,  actual: 0, revenue: 0 };
    if (!adSpend['Excel Test Zone']) adSpend['Excel Test Zone'] = { budget: MONTHLY_GOOGLE_BUDGETS['Excel Test Zone'] ?? 3700,  actual: 0, revenue: 0 };

    // Days elapsed / days in month (for pacing)
    const daysInMonth  = new Date(nowSyd.getFullYear(), nowSyd.getMonth() + 1, 0).getDate();
    const daysPassed   = nowSyd.getDate();
    const monthPctDone = (daysPassed / daysInMonth) * 100;

    // ── Campaign data ─────────────────────────────────────────────────────────
    const ppCamps  = (campaigns?.pp?.campaigns  ?? []).slice(0, 5);
    const etzCamps = (campaigns?.etz?.campaigns ?? []).slice(0, 5);
    const ppAGs    = (campaigns?.pp?.adGroups   ?? []).slice(0, 4);

    // ── Email data ────────────────────────────────────────────────────────────
    const emails = (emailData?.campaigns ?? emailData?.emails ?? []).slice(0, 6);

    // ── BigCommerce ───────────────────────────────────────────────────────────
    const topProducts = (bc?.topProducts  ?? []).slice(0, 5);
    const abandoned   = bc?.abandonedCarts ?? { count: 0, value: 0 };

    // ── Band 6 ────────────────────────────────────────────────────────────────
    const b6 = band6Data?.summary ?? band6Data ?? {};

    // ── Build prompt sections ─────────────────────────────────────────────────
    const today = nowSyd.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const spendSection = Object.entries(adSpend).map(([brand, s]) => {
      const pacing = s.budget > 0 ? ((s.actual / s.budget) * 100).toFixed(0) : '?';
      const expected = ((monthPctDone / 100) * s.budget);
      const diff = s.actual - expected;
      const diffStr = diff >= 0 ? `+${money(diff)} over pace` : `${money(Math.abs(diff))} under pace`;
      const roas = s.actual > 0 ? (s.revenue / s.actual).toFixed(2) : '0';
      return `  ${brand}: budget ${money(s.budget)}, spent ${money(s.actual)} (${pacing}% of budget, ${diffStr}), ROAS ${roas}`;
    }).join('\n');

    const campSection = ppCamps.length || etzCamps.length ? [
      ...ppCamps.map((c: any)  => `  [PP]  ${c.name}: spend ${money(c.cost)}, ${c.conversions ?? 0} conv, ROAS ${c.roas ?? 0}, CTR ${pct((c.ctr ?? 0) * 100)}`),
      ...etzCamps.map((c: any) => `  [ETZ] ${c.name}: spend ${money(c.cost)}, ${c.conversions ?? 0} conv, ROAS ${c.roas ?? 0}, CTR ${pct((c.ctr ?? 0) * 100)}`),
      ...ppAGs.map((g: any)    => `  [AD GROUP] "${g.adGroup}" in "${g.campaign}": spend ${money(g.cost)}, ${g.conversions ?? 0} conv, CTR ${pct((g.ctr ?? 0) * 100)}`),
    ].join('\n') : '  (live campaign data unavailable — use spend + email data below)';

    const emailSection = emails.length ? emails.map((e: any) => {
      const name  = e.name ?? e.subject ?? e.id ?? 'Unknown';
      const open  = typeof e.openRate  === 'number' ? pct(e.openRate)  : (e.open_rate  ?? '?');
      const click = typeof e.clickRate === 'number' ? pct(e.clickRate) : (e.click_rate ?? '?');
      return `  "${name}": open ${open}, click ${click}, ${e.sends ?? e.recipients ?? '?'} sent`;
    }).join('\n') : '  (no email data)';

    const bcSection = [
      topProducts.length
        ? 'Top products:\n' + topProducts.map((p: any) => `  ${p.name}: ${p.quantity ?? 0} units, ${money(p.revenue)}`).join('\n')
        : '  (BigCommerce product data unavailable)',
      `Abandoned carts: ${abandoned.count} carts, ${money(abandoned.value)}`,
    ].join('\n');

    const b6Section = Object.keys(b6).length
      ? JSON.stringify(b6)
      : '  (band 6 data unavailable)';

    const sourceNote = Object.entries(sources).length
      ? 'Connected sources: ' + Object.entries(sources).map(([k, v]) => `${k}:${v ? '✅' : '❌'}`).join(' ')
      : '';

    const prompt = `You are a digital marketing strategist for Pascal Press (K–12 AU workbooks: maths, English, science) and Excel Test Zone (HSC/NAPLAN online exam prep).

TODAY: ${today}. Month is ${Math.round(monthPctDone)}% complete (day ${daysPassed} of ${daysInMonth}).
TERM 3 starts late July — this is the HIGHEST-VALUE period of the year for both brands.
${sourceNote}

=== GOOGLE ADS BUDGET PACING ===
${spendSection}

=== GOOGLE ADS CAMPAIGNS (this month) ===
${campSection}

=== EMAIL CAMPAIGNS ===
${emailSection}

=== BIGCOMMERCE ===
${bcSection}

=== BAND 6 TRACKER ===
${b6Section}

IMPORTANT: You MUST return exactly 4–6 insights. Do NOT return an empty array. If live campaign data is missing, generate strategic Term 3 recommendations based on what you know about PP and ETZ (e.g. budget pacing, NAPLAN/HSC timing, email best practices, seasonal product campaigns). Name specific products, campaign types, and audience segments where possible.

Return ONLY a valid JSON array — no markdown fences, no preamble:
[{
  "id": "kebab-unique-id",
  "severity": "critical|warning|opportunity|info",
  "category": "google-ads|email|bigcommerce|band6|seasonal",
  "title": "<60 chars — specific: name a campaign, product, or metric",
  "body": "2 sentences max. Real numbers if available. One concrete action for this week.",
  "metric": "key stat e.g. 'Pacing 42% · $3,486 under budget'",
  "chatPrompt": "Specific question with context for the AI assistant",
  "action": "Short label e.g. 'Increase daily budget'"
}]`;

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text   = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]';
    const start  = text.indexOf('[');
    const end    = text.lastIndexOf(']');
    const json   = start !== -1 && end > start ? text.slice(start, end + 1) : '[]';
    const insights = JSON.parse(json);

    return NextResponse.json({ insights });

  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
