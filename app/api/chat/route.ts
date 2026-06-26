import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCampaigns } from '@/lib/monday';

const client = new Anthropic();

function formatCampaignsForContext(campaigns: Awaited<ReturnType<typeof getCampaigns>>): string {
  if (campaigns.length === 0) return 'No campaigns found.';

  // Group by FY for a readable summary
  const byFY: Record<string, typeof campaigns> = {};
  for (const c of campaigns) {
    const fy = c.fy || 'Unknown';
    if (!byFY[fy]) byFY[fy] = [];
    byFY[fy].push(c);
  }

  const lines: string[] = [];
  for (const [fy, items] of Object.entries(byFY).sort()) {
    lines.push(`\n=== ${fy} (${items.length} campaigns) ===`);
    for (const c of items) {
      lines.push(
        `• ${c.name} | ${c.type} | ${c.month} | ${c.brand} | Status: ${c.status}` +
        (c.promoCode ? ` | Promo: ${c.promoCode}` : '') +
        (c.dateRange ? ` | Dates: ${c.dateRange}` : '') +
        (c.revenue > 0 ? ` | Revenue: $${c.revenue.toLocaleString()}` : '') +
        (c.orders > 0 ? ` | Orders: ${c.orders.toLocaleString()}` : '') +
        (c.unitsSold > 0 ? ` | Units Sold: ${c.unitsSold.toLocaleString()}` : '') +
        (c.notes ? ` | Notes: ${c.notes}` : '')
      );
    }
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not set.' },
        { status: 500 }
      );
    }

    const { messages } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided.' }, { status: 400 });
    }

    // Fetch live campaign data
    let campaignContext = '';
    try {
      const campaigns = await getCampaigns();
      campaignContext = formatCampaignsForContext(campaigns);
    } catch {
      campaignContext = 'Campaign data could not be loaded at this time.';
    }

    const systemPrompt = `You are a marketing campaign analyst for Pascal Press, an Australian educational publisher. You help the marketing team analyse campaign performance, identify trends, and suggest strategies.

You have full visibility of the current campaign data below. Use it to answer questions accurately. When asked to compare years, calculate totals and percentages. When asked to suggest campaigns, consider seasonal patterns and what has worked before.

Format your responses clearly. Use bullet points for lists. Include specific numbers when available.

LIVE CAMPAIGN DATA:
${campaignContext}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response type' }, { status: 500 });
    }

    return NextResponse.json({ reply: content.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
