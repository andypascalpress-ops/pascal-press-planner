/**
 * POST /api/insights
 *
 * Accepts a rich `metrics` payload containing real campaign names, ad groups,
 * product names, and email subjects. Calls Claude Haiku to produce 5–8 specific,
 * named recommendations as a JSON array. Used by the redesigned Action Centre.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'edge';

const client = new Anthropic();

function fmt(n: number | undefined, prefix = '$'): string {
  if (n == null) return '?';
  return `${prefix}${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export async function POST(req: NextRequest) {
  try {
    const { metrics } = await req.json();

    const campaigns  = metrics?.campaigns ?? {};
    const emailData  = metrics?.email     ?? {};
    const band6      = metrics?.band6     ?? {};
    const spend      = metrics?.spend     ?? {};
    const bc         = metrics?.bc        ?? {};

    const ppCampaigns  = campaigns?.pp?.campaigns  ?? [];
    const ppAdGroups   = campaigns?.pp?.adGroups   ?? [];
    const etzCampaigns = campaigns?.etz?.campaigns ?? [];
    const etzAdGroups  = campaigns?.etz?.adGroups  ?? [];
    const emails       = emailData?.campaigns ?? emailData?.emails ?? [];
    const topProducts  = bc?.topProducts      ?? [];
    const abandoned    = bc?.abandonedCarts   ?? { count: 0, value: 0 };

    const today = new Date().toLocaleDateString('en-AU', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Australia/Sydney',
    });

    const campaignLines = (arr: any[], brand: string) => arr.length
      ? arr.map(c =>
          `  • [${brand}] ${c.name}: cost ${fmt(c.cost)}, conversions ${c.conversions ?? 0}, ROAS ${c.roas ?? 0}, CTR ${((c.ctr ?? 0) * 100).toFixed(2)}%, CPC ${fmt(c.avgCpc)}, ${c.clicks ?? 0} clicks`
        ).join('\n')
      : `  (no ${brand} campaign data)`;

    const adGroupLines = (arr: any[], brand: string) => arr.slice(0, 8).map(g =>
      `  • [${brand}] campaign="${g.campaign}" adGroup="${g.adGroup}": cost ${fmt(g.cost)}, conversions ${g.conversions ?? 0}, CTR ${((g.ctr ?? 0) * 100).toFixed(2)}%`
    ).join('\n');

    const emailLines = emails.length
      ? emails.slice(0, 10).map((e: any) => {
          const name     = e.name ?? e.subject ?? e.id ?? 'Unknown';
          const openRate = e.openRate  ?? e.open_rate  ?? '?';
          const clickRate= e.clickRate ?? e.click_rate ?? '?';
          const sends    = e.sends ?? e.recipients ?? '?';
          return `  • "${name}": open ${typeof openRate === 'number' ? openRate.toFixed(1) : openRate}%, click ${typeof clickRate === 'number' ? clickRate.toFixed(1) : clickRate}%, ${sends} sent`;
        }).join('\n')
      : '  (no email data)';

    const productLines = topProducts.length
      ? topProducts.slice(0, 10).map((p: any) => `  • ${p.name}: ${p.quantity ?? 0} units, ${fmt(p.revenue)} revenue`).join('\n')
      : '  (no product data)';

    const prompt = `You are a senior digital marketing strategist for Pascal Press and Excel Test Zone (Australian educational publisher — maths, English, science workbooks K–12; HSC/NAPLAN exam prep).

Today: ${today} — it's Australian Term 3 (peak season for NAPLAN prep, HSC prep, and Back to School).

Analyse the data below and return 5–8 specific, actionable insights as a JSON array. REFERENCE EXACT campaign names, ad group names, product names, and email subject lines from the data. Include real dollar amounts, percentages, and conversion counts. Be direct and specific — generic advice is useless.

=== GOOGLE ADS — Pascal Press ===
Campaigns this month:
${campaignLines(ppCampaigns, 'PP')}

Ad Groups:
${adGroupLines(ppAdGroups, 'PP')}

=== GOOGLE ADS — Excel Test Zone ===
Campaigns this month:
${campaignLines(etzCampaigns, 'ETZ')}

Ad Groups:
${adGroupLines(etzAdGroups, 'ETZ')}

=== EMAIL CAMPAIGNS (HubSpot) ===
${emailLines}

=== BIGCOMMERCE — Top Products This Month ===
${productLines}

=== BIGCOMMERCE — Abandoned Carts (last 30 days) ===
  ${abandoned.count} abandoned carts, estimated value: ${fmt(abandoned.value)}

=== BUDGET PACING ===
${JSON.stringify(spend, null, 2)}

=== BAND 6 TRACKER ===
${JSON.stringify(band6, null, 2)}

Return ONLY a valid JSON array (no markdown fences, no preamble) with this structure:
[{
  "id": "short-unique-kebab-id",
  "severity": "critical|warning|opportunity|info",
  "category": "google-ads|email|bigcommerce|band6|seasonal|budget",
  "title": "Title naming the exact campaign/product/email (max 70 chars)",
  "body": "2–3 sentences. Cite specific numbers from the data. State WHY this matters in Term 3. End with ONE concrete action step for this week.",
  "metric": "Key metric string, e.g. 'ROAS 0.0 · $840 spent' or 'Open rate 9.4% · 2,100 sent'",
  "chatPrompt": "Pre-filled question for the AI assistant — include the exact campaign/product name AND the specific numbers, so the assistant has full context",
  "action": "Short imperative label, e.g. 'Pause campaign' or 'Fix subject line' (max 30 chars)"
}]

Priority order: zero-conversion campaigns burning budget → high abandoned cart value → low email open/click rates → Term 3 seasonal gaps → product opportunities → wins to double down on.`;

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2400,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw  = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]';
    const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const insights = JSON.parse(json);

    return NextResponse.json({ insights });

  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
