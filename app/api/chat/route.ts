import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCampaigns, createCampaign } from '@/lib/monday';
import { Campaign } from '@/lib/types';

const client = new Anthropic();

const CAMPAIGN_TYPES = ['Sale', 'Content', 'Product Launch', 'Seasonal', 'Trade', 'Brand', 'Other'];
const MONTHS = [
  'July', 'August', 'September', 'October', 'November', 'December',
  'January', 'February', 'March', 'April', 'May', 'June',
];
const BRANDS = ['Pascal Press', 'Blake Education', 'Both'];

function formatCampaignsForContext(campaigns: Campaign[]): string {
  if (campaigns.length === 0) return 'No campaigns found.';
  const byFY: Record<string, Campaign[]> = {};
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: any[] = [
  {
    name: 'create_campaign',
    description: 'Create a new marketing campaign in the planner. Use this when the user asks to add, create, or schedule a campaign. If key details are missing ask first, otherwise create immediately.',
    input_schema: {
      type: 'object',
      properties: {
        name:      { type: 'string', description: 'Campaign name, e.g. "PP_Back_to_School_2026"' },
        type:      { type: 'string', enum: CAMPAIGN_TYPES, description: 'Campaign type' },
        month:     { type: 'string', enum: MONTHS, description: 'Month the campaign runs' },
        brand:     { type: 'string', enum: BRANDS, description: 'Brand this campaign is for' },
        fy:        { type: 'string', description: 'Financial year, e.g. "FY26"' },
        status:    { type: 'string', enum: ['Planned', 'Complete'], description: 'Campaign status' },
        promoCode: { type: 'string', description: 'Promo code if applicable' },
        dateRange: { type: 'string', description: 'Date range, e.g. "1-14 Feb 2026"' },
        notes:     { type: 'string', description: 'Any additional notes' },
      },
      required: ['name', 'type', 'month', 'brand', 'fy'],
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set.' }, { status: 500 });
    }

    const { messages } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided.' }, { status: 400 });
    }

    let campaignContext = '';
    try {
      const campaigns = await getCampaigns();
      campaignContext = formatCampaignsForContext(campaigns);
    } catch {
      campaignContext = 'Campaign data could not be loaded at this time.';
    }

    const systemPrompt = `You are a marketing campaign assistant for Pascal Press, an Australian educational publisher. You help the marketing team analyse performance, identify trends, suggest strategies, and CREATE new campaigns directly in the planner.

CAPABILITIES:
- Analyse campaign performance and compare periods
- Identify trends and patterns
- Suggest new campaigns based on historical data
- CREATE campaigns using the create_campaign tool

WHEN CREATING CAMPAIGNS:
- If the user asks to create or add a campaign and they have given enough detail, use the tool immediately
- If key details are missing (name, type, month), ask for them first
- After creating, confirm what was added and say it now appears in the calendar
- Financial year: FY26 = July 2025 to June 2026, FY27 = July 2026 to June 2027

Format responses clearly. Use bullet points for lists. Include specific numbers when available.

LIVE CAMPAIGN DATA:
${campaignContext}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiMessages: any[] = messages.map(m => ({ role: m.role, content: m.content }));

    let createdCampaign: Campaign | null = null;
    let finalText = '';

    // Agentic loop: handle tool calls (up to 3 turns)
    for (let turn = 0; turn < 3; turn++) {
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1500,
        system:     systemPrompt,
        tools,
        messages:   apiMessages,
      });

      if (response.stop_reason === 'end_turn') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBlock = (response.content as any[]).find((b: any) => b.type === 'text');
        finalText = textBlock ? textBlock.text : '';
        break;
      }

      if (response.stop_reason === 'tool_use') {
        apiMessages.push({ role: 'assistant', content: response.content });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResults: any[] = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const block of response.content as any[]) {
          if (block.type !== 'tool_use') continue;

          if (block.name === 'create_campaign') {
            try {
              const input = block.input as Partial<Campaign>;
              const newCampaign = await createCampaign({
                name:      input.name      ?? 'New Campaign',
                type:      input.type      ?? 'Other',
                month:     input.month     ?? 'July',
                brand:     input.brand     ?? 'Pascal Press',
                fy:        input.fy        ?? 'FY26',
                status:    (input.status as 'Planned' | 'Complete') ?? 'Planned',
                promoCode: input.promoCode ?? '',
                dateRange: input.dateRange ?? '',
                notes:     input.notes     ?? '',
                revenue:   0,
                orders:    0,
                unitsSold: 0,
              });
              createdCampaign = newCampaign;
              toolResults.push({
                type:        'tool_result',
                tool_use_id: block.id,
                content:     `Campaign created: "${newCampaign.name}" in ${newCampaign.month} ${newCampaign.fy}`,
              });
            } catch (err) {
              toolResults.push({
                type:        'tool_result',
                tool_use_id: block.id,
                content:     `Error: ${err instanceof Error ? err.message : String(err)}`,
                is_error:    true,
              });
            }
          }
        }

        apiMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    return NextResponse.json({ reply: finalText, createdCampaign });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
