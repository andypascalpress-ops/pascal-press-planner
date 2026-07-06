/**
 * POST /api/insights
 *
 * Compact prompt → Anthropic SDK → JSON response.
 * Keeps total execution well under 10 s (Vercel Hobby limit).
 * Edge runtime: Anthropic SDK is compatible and has no cold-start.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'edge';

const client = new Anthropic();

function money(n: number | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString('en-AU')}`;
}

export async function POST(req: NextRequest) {
  try {
    const { metrics } = await req.json();

    const campaigns = metrics?.campaigns  ?? {};
    const emailData = metrics?.email      ?? {};
    const bc        = metrics?.bc         ?? {};

    // Compact: top 4 per brand, top 5 emails, top 5 products
    const ppCamps  = (campaigns?.pp?.campaigns  ?? []).slice(0, 4);
    const etzCamps = (campaigns?.etz?.campaigns ?? []).slice(0, 4);
    const ppAGs    = (campaigns?.pp?.adGroups   ?? []).slice(0, 4);
    const emails   = (emailData?.campaigns ?? emailData?.emails ?? []).slice(0, 5);
    const products = (bc?.topProducts  ?? []).slice(0, 5);
    const abandoned = bc?.abandonedCarts ?? { count: 0, value: 0 };

    const cRow = (c: any, brand: string) =>
      `  [${brand}] ${c.name}: spend ${money(c.cost)}, conv ${c.conversions ?? 0}, ROAS ${c.roas ?? 0}, CTR ${((c.ctr ?? 0) * 100).toFixed(1)}%`;

    const agRow = (g: any, brand: string) =>
      `  [${brand}] "${g.adGroup}" in "${g.campaign}": spend ${money(g.cost)}, conv ${g.conversions ?? 0}, CTR ${((g.ctr ?? 0) * 100).toFixed(1)}%`;

    const eRow = (e: any) => {
      const name  = e.name ?? e.subject ?? e.id ?? 'Unknown';
      const open  = typeof e.openRate  === 'number' ? e.openRate.toFixed(1)  : (e.open_rate  ?? '?');
      const click = typeof e.clickRate === 'number' ? e.clickRate.toFixed(1) : (e.click_rate ?? '?');
      return `  "${name}": open ${open}%, click ${click}%, ${e.sends ?? e.recipients ?? '?'} sent`;
    };

    const sections: string[] = [];

    if (ppCamps.length)  sections.push('PP Google Ads:\n'  + ppCamps.map((c: any)  => cRow(c, 'PP')).join('\n'));
    if (etzCamps.length) sections.push('ETZ Google Ads:\n' + etzCamps.map((c: any) => cRow(c, 'ETZ')).join('\n'));
    if (ppAGs.length)    sections.push('Ad Groups:\n'      + ppAGs.map((g: any)    => agRow(g, 'PP')).join('\n'));
    if (emails.length)   sections.push('Email:\n'          + emails.map(eRow).join('\n'));
    if (products.length) sections.push(
      'Top products:\n' + products.map((p: any) => `  ${p.name}: ${p.quantity ?? 0} units, ${money(p.revenue)}`).join('\n'),
    );
    sections.push(`Abandoned carts: ${abandoned.count} carts, ${money(abandoned.value)}`);

    const today = new Date().toLocaleDateString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short',
      timeZone: 'Australia/Sydney',
    });

    const prompt = `Marketing strategist for Pascal Press (K–12 AU workbooks) + Excel Test Zone (HSC/NAPLAN prep). Today: ${today}, Term 3 peak.

${sections.join('\n\n')}

Return 4–6 insights as a JSON array. Use exact campaign/product/email names. Include real numbers. No markdown.

[{"id":"x","severity":"critical|warning|opportunity|info","category":"google-ads|email|bigcommerce|band6|seasonal","title":"<60 chars with specific name","body":"2 sentences: numbers + one concrete action","metric":"key stat","chatPrompt":"specific AI question with name+numbers","action":"short label"}]`;

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]';
    // Strip any markdown fences Claude might add
    const start = text.indexOf('[');
    const end   = text.lastIndexOf(']');
    const json  = start !== -1 && end > start ? text.slice(start, end + 1) : '[]';
    const insights = JSON.parse(json);

    return NextResponse.json({ insights });

  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
