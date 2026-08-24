/**
 * /api/ads-chat — Agentic Claude route for the Ads Manager tab.
 *
 * POST body: { messages: Message[], account: 'pp' | 'etz' | 'hsc' }
 * Response:  { reply: string }
 *
 * Provides 8 tools: read campaigns, shopping products, search terms,
 * GA4 product revenue; write pause/enable, budget, negative keywords.
 *
 * Credentials stay server-side via env vars — nothing is exposed to the browser.
 */

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { buildConfig, runGaqlQuery, runGaqlMutate } from '@/lib/google-ads';

// ─── GA4 auth (service account JWT, replicated from google-analytics.ts) ─────

const GA4_PROPERTIES: Record<string, string> = {
  pp:  '354651290',
  etz: process.env.GOOGLE_ANALYTICS_ETZ_PROPERTY_ID ?? '',
  hsc: process.env.GOOGLE_ANALYTICS_HSC_PROPERTY_ID ?? '',
};

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGA4AccessToken(): Promise<string> {
  const raw = Buffer.from(
    process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON!,
    'base64',
  ).toString('utf8');
  const { client_email, private_key } = JSON.parse(raw) as {
    client_email: string;
    private_key:  string;
  };
  const now     = Math.floor(Date.now() / 1000);
  const header  = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss:   client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    }),
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = base64urlEncode(signer.sign(private_key));
  const jwt = `${header}.${payload}.${signature}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`GA4 service account auth failed: ${data.error_description ?? JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

async function runGA4Report(
  account: string,
  reportRequest: Record<string, unknown>,
): Promise<{ rows: Array<{ dimensionValues: Array<{value: string}>; metricValues: Array<{value: string}> }> }> {
  const propertyId = GA4_PROPERTIES[account];
  if (!propertyId) throw new Error(`No GA4 property configured for account "${account}"`);
  const token = await getGA4AccessToken();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(reportRequest),
      cache:   'no-store',
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GA4 report error: ${data.error?.message ?? JSON.stringify(data)}`);
  return data;
}

// ─── Date range helper ────────────────────────────────────────────────────────

const DATE_RANGES: Record<string, string> = {
  TODAY:       'TODAY',
  YESTERDAY:   'YESTERDAY',
  THIS_WEEK:   'THIS_WEEK_SUN_TODAY',
  LAST_WEEK:   'LAST_WEEK_SUN_SAT',
  THIS_MONTH:  'THIS_MONTH',
  LAST_MONTH:  'LAST_MONTH',
  LAST_30_DAYS:'LAST_30_DAYS',
};

function gaqlDateRange(key?: string): string {
  return DATE_RANGES[key ?? 'THIS_MONTH'] ?? 'THIS_MONTH';
}

function ga4DateRange(key?: string): { startDate: string; endDate: string } {
  const now = new Date();
  switch (key) {
    case 'TODAY':       return { startDate: 'today', endDate: 'today' };
    case 'YESTERDAY':   return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'LAST_30_DAYS':return { startDate: '30daysAgo', endDate: 'today' };
    case 'LAST_MONTH': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: first.toISOString().slice(0, 10), endDate: last.toISOString().slice(0, 10) };
    }
    default: { // THIS_MONTH
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: first.toISOString().slice(0, 10), endDate: 'today' };
    }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTool(name: string, input: any, account: string): Promise<string> {
  const cfg = buildConfig(account as 'pp' | 'etz' | 'hsc');
  const customerId = cfg.customerId;

  switch (name) {
    // ── Read: campaigns ──────────────────────────────────────────────────────
    case 'get_campaigns': {
      const dr = gaqlDateRange(input.date_range);
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.campaign_budget,
          campaign_budget.amount_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM campaign
        WHERE segments.date DURING ${dr}
        AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 25
      `);
      const campaigns = rows.map(r => ({
        id:              String(r.campaign?.id ?? ''),
        name:            r.campaign?.name ?? '',
        status:          r.campaign?.status ?? '',
        daily_budget:    +(Number(r.campaignBudget?.amountMicros ?? 0) / 1_000_000).toFixed(2),
        impressions:     Number(r.metrics?.impressions ?? 0),
        clicks:          Number(r.metrics?.clicks ?? 0),
        cost_aud:        +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions:     +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
      }));
      return JSON.stringify(campaigns, null, 2);
    }

    // ── Read: shopping product performance ───────────────────────────────────
    case 'get_shopping_products': {
      const dr = gaqlDateRange(input.date_range);
      const campaignFilter = input.campaign_id
        ? `AND campaign.id = ${input.campaign_id}`
        : '';
      const limit = Math.min(Number(input.limit ?? 50), 100);
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          segments.product_title,
          segments.product_item_id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM shopping_performance_view
        WHERE segments.date DURING ${dr}
        ${campaignFilter}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);
      const products = rows.map(r => ({
        campaign:      r.campaign?.name ?? '',
        campaign_id:   String(r.campaign?.id ?? ''),
        title:         r.segments?.productTitle ?? '',
        item_id:       r.segments?.productItemId ?? '',
        impressions:   Number(r.metrics?.impressions ?? 0),
        clicks:        Number(r.metrics?.clicks ?? 0),
        cost_aud:      +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions:   +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
      }));
      return JSON.stringify(products, null, 2);
    }

    // ── Read: search terms ───────────────────────────────────────────────────
    case 'get_search_terms': {
      const dr = gaqlDateRange(input.date_range);
      const campaignFilter = input.campaign_id
        ? `AND campaign.id = ${input.campaign_id}`
        : '';
      const limit = Math.min(Number(input.limit ?? 30), 100);
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM search_term_view
        WHERE segments.date DURING ${dr}
        ${campaignFilter}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);
      const terms = rows.map(r => ({
        campaign:    r.campaign?.name ?? '',
        campaign_id: String(r.campaign?.id ?? ''),
        search_term: r.searchTermView?.searchTerm ?? '',
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks:      Number(r.metrics?.clicks ?? 0),
        cost_aud:    +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions: +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
      }));
      return JSON.stringify(terms, null, 2);
    }

    // ── Read: GA4 product revenue ────────────────────────────────────────────
    case 'get_ga4_product_revenue': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const report = await runGA4Report(account, {
        dimensions: [{ name: 'itemName' }, { name: 'itemId' }],
        metrics:    [{ name: 'itemRevenue' }, { name: 'itemsPurchased' }, { name: 'itemsViewed' }],
        dateRanges: [{ startDate, endDate }],
        orderBys:   [{ metric: { metricName: 'itemRevenue' }, desc: true }],
        limit:      100,
      });
      const minRevenue = Number(input.min_revenue ?? 0);
      const products = (report.rows ?? [])
        .map(row => ({
          name:       row.dimensionValues[0].value,
          item_id:    row.dimensionValues[1].value,
          revenue:    +Number(row.metricValues[0].value).toFixed(2),
          purchased:  Number(row.metricValues[1].value),
          viewed:     Number(row.metricValues[2].value),
        }))
        .filter(p => p.revenue >= minRevenue);
      return JSON.stringify(products, null, 2);
    }

    // ── Write: pause campaign ────────────────────────────────────────────────
    case 'pause_campaign': {
      const { campaign_id, campaign_name } = input;
      await runGaqlMutate(cfg, 'campaigns', [{
        updateMask: 'status',
        update: {
          resourceName: `customers/${customerId}/campaigns/${campaign_id}`,
          status: 'PAUSED',
        },
      }]);
      return `✅ Campaign "${campaign_name}" (ID: ${campaign_id}) has been paused.`;
    }

    // ── Write: enable campaign ───────────────────────────────────────────────
    case 'enable_campaign': {
      const { campaign_id, campaign_name } = input;
      await runGaqlMutate(cfg, 'campaigns', [{
        updateMask: 'status',
        update: {
          resourceName: `customers/${customerId}/campaigns/${campaign_id}`,
          status: 'ENABLED',
        },
      }]);
      return `✅ Campaign "${campaign_name}" (ID: ${campaign_id}) has been enabled.`;
    }

    // ── Write: update daily budget ───────────────────────────────────────────
    case 'update_campaign_budget': {
      const { campaign_id, campaign_name, new_daily_budget_aud } = input;
      // Step 1: get budget resource name
      const rows = await runGaqlQuery(cfg, `
        SELECT campaign.campaign_budget
        FROM campaign
        WHERE campaign.id = ${campaign_id}
        LIMIT 1
      `);
      if (!rows.length || !rows[0].campaign?.campaignBudget) {
        return `❌ Could not find budget for campaign ID ${campaign_id}.`;
      }
      const budgetResource = rows[0].campaign.campaignBudget as string;
      const amountMicros   = Math.round(new_daily_budget_aud * 1_000_000);
      // Step 2: mutate budget
      await runGaqlMutate(cfg, 'campaignBudgets', [{
        updateMask: 'amount_micros',
        update: {
          resourceName:  budgetResource,
          amountMicros:  String(amountMicros),
        },
      }]);
      return `✅ Budget for "${campaign_name}" updated to $${new_daily_budget_aud.toFixed(2)}/day AUD.`;
    }

    // ── Write: add negative keyword ──────────────────────────────────────────
    case 'add_negative_keyword': {
      const { campaign_id, campaign_name, keyword, match_type } = input;
      await runGaqlMutate(cfg, 'campaignCriteria', [{
        create: {
          campaign: `customers/${customerId}/campaigns/${campaign_id}`,
          keyword: {
            text:      keyword,
            matchType: match_type ?? 'BROAD',
          },
          negative: true,
        },
      }]);
      return `✅ Negative keyword "${keyword}" (${match_type ?? 'BROAD'} match) added to campaign "${campaign_name}".`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Claude tools definition ──────────────────────────────────────────────────

const DATE_RANGE_ENUM = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS'];

const TOOLS: Anthropic.Tool[] = [
  {
    name:        'get_campaigns',
    description: 'Get all campaigns (active + paused) with spend, clicks, impressions, daily budget and conversions. Always call this first when the user asks about campaigns or account overview.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM, description: 'Reporting period. Defaults to THIS_MONTH.' },
      },
    },
  },
  {
    name:        'get_shopping_products',
    description: 'Get product-level shopping performance (title, spend, clicks, conversions). Use to diagnose which products are burning budget or converting well.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        campaign_id: { type: 'string', description: 'Filter to one campaign. Leave blank for all shopping campaigns.' },
        limit:       { type: 'number', description: 'Max rows (default 50, max 100).' },
      },
    },
  },
  {
    name:        'get_search_terms',
    description: 'Get top search terms for search campaigns sorted by spend. Use to find irrelevant or wasted queries and negative keyword opportunities.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        campaign_id: { type: 'string', description: 'Filter to one campaign. Leave blank for all.' },
        limit:       { type: 'number', description: 'Max rows (default 30, max 100).' },
      },
    },
  },
  {
    name:        'get_ga4_product_revenue',
    description: 'Get product revenue from Google Analytics 4 — the source of truth for revenue (Google Ads conversion values are NOT reliable). Cross-reference with ad spend to calculate true ROAS.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        min_revenue: { type: 'number', description: 'Only return products with at least this revenue (AUD). Useful for filtering noise.' },
      },
    },
  },
  {
    name:        'pause_campaign',
    description: 'Pause a campaign immediately. Only use when the user explicitly asks to pause.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name (for confirmation message).' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name:        'enable_campaign',
    description: 'Re-enable a paused campaign. Only use when the user explicitly asks to enable or unpause.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name (for confirmation message).' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name:        'update_campaign_budget',
    description: 'Change a campaign\'s daily budget (AUD). Only use when the user explicitly provides a new budget amount.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:          { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name:        { type: 'string', description: 'Campaign name (for confirmation message).' },
        new_daily_budget_aud: { type: 'number', description: 'New daily budget in Australian dollars (e.g. 50 for $50/day).' },
      },
      required: ['campaign_id', 'campaign_name', 'new_daily_budget_aud'],
    },
  },
  {
    name:        'add_negative_keyword',
    description: 'Add a negative keyword to a campaign to stop ads showing for irrelevant searches.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name (for confirmation message).' },
        keyword:       { type: 'string', description: 'The keyword text to exclude (e.g. "www ricgroup com au").' },
        match_type:    { type: 'string', enum: ['BROAD', 'PHRASE', 'EXACT'], description: 'BROAD = any order, PHRASE = in order, EXACT = exact match.' },
      },
      required: ['campaign_id', 'campaign_name', 'keyword', 'match_type'],
    },
  },
];

// ─── Account display names ────────────────────────────────────────────────────

const ACCOUNT_NAMES: Record<string, string> = {
  pp:  'Pascal Press (246-104-2966)',
  etz: 'Excel Test Zone (893-408-4207)',
  hsc: 'HSC Copilot (140-426-6935)',
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages, account = 'pp' } = await req.json() as {
      messages: Anthropic.MessageParam[];
      account?: 'pp' | 'etz' | 'hsc';
    };

    if (!messages?.length) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

    const accountName = ACCOUNT_NAMES[account] ?? account;
    const today       = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    const systemPrompt = `You are a Google Ads assistant for the Pascal Press team. You have full read and write access to the Google Ads account.

**Currently managing:** ${accountName}
**Today's date:** ${today}
**GA4 is the source of truth for revenue.** Google Ads conversion numbers are unreliable — always use the get_ga4_product_revenue tool when calculating ROAS or evaluating product performance.

**How to approach analysis:**
- Use get_campaigns for an account overview first
- Use get_shopping_products for product-level shopping breakdowns
- Use get_search_terms to find wasted spend or negative keyword opportunities
- Cross-reference ad spend with GA4 revenue to calculate true ROAS (revenue ÷ cost)
- A ROAS below 2× is generally poor for Pascal Press; above 4× is good

**Before making changes:**
- Confirm what you're about to do in plain language before calling a mutate tool
- After a successful change, summarise what was done

**Output format:** Use markdown with headers and bullet points for data summaries. Use ✅ for completed actions. Always include AUD amounts.`;

    const client     = new Anthropic();
    const apiMessages: Anthropic.MessageParam[] = [...messages];
    let   finalText  = '';

    // Agentic loop — up to 5 turns to allow multi-step operations (e.g. get budget resource → update it)
    for (let turn = 0; turn < 5; turn++) {
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2000,
        system:     systemPrompt,
        tools:      TOOLS,
        messages:   apiMessages,
      });

      if (response.stop_reason === 'end_turn') {
        finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Append assistant message
        apiMessages.push({ role: 'assistant', content: response.content });

        // Process each tool call and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          let result: string;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result = await handleTool(block.name, block.input as any, account);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            result    = `Error: ${msg}. The action was not completed.`;
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        // Append tool results
        apiMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      // max_tokens or other stop reason — grab whatever text exists
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');
      break;
    }

    return NextResponse.json({ reply: finalText || '(No response)' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ads-chat]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
