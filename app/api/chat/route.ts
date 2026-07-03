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

const tools: Anthropic.Tool[] = [
  {
    name: 'create_campaign',
    description: 'Create a new marketing campaign in the planner. Use this when the user asks you to add, create, or schedule a campaign. Always confirm the details with the user first unless they have provided all the information.',
    input_schema: {
      type: 'object' as const,
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
      return NextResponse.json({ error: 'No messages provided.' }