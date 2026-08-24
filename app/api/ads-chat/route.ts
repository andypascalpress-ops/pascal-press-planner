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

    // ── Read: GA4 product revenue (Pascal Press — ecommerce item-level) ─────
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


    // ── Read: GA4 campaign revenue (ETZ / HSC / PP campaign-level view) ─────
    case 'get_ga4_campaign_revenue': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const report = await runGA4Report(account, {
        dimensions: [
          { name: 'sessionCampaignName' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'totalRevenue' },
          { name: 'sessions' },
          { name: 'keyEvents' },
        ],
        dateRanges: [{ startDate, endDate }],
        // Only paid traffic
        dimensionFilter: {
          filter: {
            fieldName: 'sessionMedium',
            stringFilter: { matchType: 'EXACT', value: 'cpc' },
          },
        },
        orderBys: [{ metric: { metricName: 'totalRevenue' }, desc: true }],
        limit: 50,
      });
      const rows = (report.rows ?? []).map(row => ({
        campaign:   row.dimensionValues[0].value,
        medium:     row.dimensionValues[1].value,
        revenue:    +Number(row.metricValues[0].value).toFixed(2),
        sessions:   Number(row.metricValues[1].value),
        key_events: Number(row.metricValues[2].value),
      }));
      return JSON.stringify(rows, null, 2);
    }

    // ── Write: create search campaign ───────────────────────────────────────
    case 'create_search_campaign': {
      const {
        campaign_name, daily_budget_aud, headlines, descriptions,
        final_url, keywords, match_type, geo_target_ids, bidding_strategy, target_cpa_aud,
      } = input;

      // 1. Budget
      const budgetRes = await runGaqlMutate(cfg, 'campaignBudgets', [{
        create: {
          name:          `Budget — ${campaign_name}`,
          amountMicros:  String(Math.round(daily_budget_aud * 1_000_000)),
          deliveryMethod: 'STANDARD',
        },
      }]);
      const budgetResource = budgetRes.results[0].resourceName as string;

      // 2. Campaign
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const campaignBody: Record<string, any> = {
        name:                    campaign_name,
        status:                  'PAUSED',
        advertisingChannelType:  'SEARCH',
        campaignBudget:          budgetResource,
        networkSettings: {
          targetGoogleSearch:    true,
          targetSearchNetwork:   false,
          targetContentNetwork:  false,
        },
      };
      if (bidding_strategy === 'TARGET_CPA' && target_cpa_aud) {
        campaignBody.targetCpa = { targetCpaMicros: String(Math.round(target_cpa_aud * 1_000_000)) };
      } else if (bidding_strategy === 'MAXIMIZE_CLICKS') {
        campaignBody.maximizeClicks = {};
      } else if (bidding_strategy === 'MANUAL_CPC') {
        campaignBody.manualCpc = { enhancedCpcEnabled: true };
      } else {
        campaignBody.maximizeConversions = {};
      }
      const campaignRes = await runGaqlMutate(cfg, 'campaigns', [{ create: campaignBody }]);
      const campaignResource = campaignRes.results[0].resourceName as string;
      const campaignId = campaignResource.split('/').pop();

      // 3. Geo targeting (default to Australia if not specified)
      const geoIds: number[] = geo_target_ids?.length ? geo_target_ids : [2036];
      await runGaqlMutate(cfg, 'campaignCriteria', geoIds.map((id: number) => ({
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${id}` },
        },
      })));

      // 4. Ad group
      const adGroupRes = await runGaqlMutate(cfg, 'adGroups', [{
        create: {
          name:          `${campaign_name} — Ad Group 1`,
          campaign:      campaignResource,
          status:        'ENABLED',
          type:          'SEARCH_STANDARD',
          cpcBidMicros:  '1000000',
        },
      }]);
      const adGroupResource = adGroupRes.results[0].resourceName as string;

      // 5. Responsive Search Ad
      await runGaqlMutate(cfg, 'adGroupAds', [{
        create: {
          adGroup: adGroupResource,
          status:  'ENABLED',
          ad: {
            finalUrls:          [final_url],
            responsiveSearchAd: {
              headlines:    (headlines as string[]).map(text => ({ text })),
              descriptions: (descriptions as string[]).map(text => ({ text })),
            },
          },
        },
      }]);

      // 6. Keywords
      if (keywords?.length) {
        await runGaqlMutate(cfg, 'adGroupCriteria', (keywords as string[]).map(kw => ({
          create: {
            adGroup:  adGroupResource,
            status:   'ENABLED',
            keyword:  { text: kw, matchType: match_type ?? 'PHRASE' },
          },
        })));
      }

      return `✅ Search campaign **"${campaign_name}"** created (ID: ${campaignId}).

- Status: **PAUSED** — review in Google Ads before enabling
- Daily budget: $${daily_budget_aud}/day
- Bidding: ${bidding_strategy ?? 'MAXIMIZE_CONVERSIONS'}
- ${(headlines as string[]).length} headlines · ${(descriptions as string[]).length} descriptions
- ${(keywords as string[])?.length ?? 0} keywords (${match_type ?? 'PHRASE'} match)
- Geo: ${geoIds.join(', ')} (2036 = Australia, 21471 = NSW)`;
    }

    // ── Write: create shopping campaign ─────────────────────────────────────
    case 'create_shopping_campaign': {
      const {
        campaign_name, daily_budget_aud, merchant_center_id,
        geo_target_ids, bidding_strategy,
      } = input;

      // 1. Budget
      const budgetRes = await runGaqlMutate(cfg, 'campaignBudgets', [{
        create: {
          name:          `Budget — ${campaign_name}`,
          amountMicros:  String(Math.round(daily_budget_aud * 1_000_000)),
          deliveryMethod: 'STANDARD',
        },
      }]);
      const budgetResource = budgetRes.results[0].resourceName as string;

      // 2. Campaign
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const campaignBody: Record<string, any> = {
        name:                   campaign_name,
        status:                 'PAUSED',
        advertisingChannelType: 'SHOPPING',
        campaignBudget:         budgetResource,
        shoppingSetting: {
          merchantId:       Number(merchant_center_id),
          salesCountry:     'AU',
          campaignPriority: 0,
          enableLocal:      false,
        },
      };
      if (bidding_strategy === 'MAXIMIZE_CLICKS') {
        campaignBody.maximizeClicks = {};
      } else {
        campaignBody.maximizeConversionValue = {};
      }
      const campaignRes = await runGaqlMutate(cfg, 'campaigns', [{ create: campaignBody }]);
      const campaignResource = campaignRes.results[0].resourceName as string;
      const campaignId = campaignResource.split('/').pop();

      // 3. Geo targeting
      const geoIds: number[] = geo_target_ids?.length ? geo_target_ids : [2036];
      await runGaqlMutate(cfg, 'campaignCriteria', geoIds.map((id: number) => ({
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${id}` },
        },
      })));

      // 4. Ad group
      const adGroupRes = await runGaqlMutate(cfg, 'adGroups', [{
        create: {
          name:     `${campaign_name} — Ad Group 1`,
          campaign: campaignResource,
          status:   'ENABLED',
          type:     'SHOPPING_PRODUCT_ADS',
        },
      }]);
      const adGroupResource = adGroupRes.results[0].resourceName as string;

      // 5. Product ad
      await runGaqlMutate(cfg, 'adGroupAds', [{
        create: {
          adGroup: adGroupResource,
          status:  'ENABLED',
          ad:      { shoppingProductAd: {} },
        },
      }]);

      return `✅ Shopping campaign **"${campaign_name}"** created (ID: ${campaignId}).

- Status: **PAUSED** — review in Google Ads before enabling
- Daily budget: $${daily_budget_aud}/day
- Merchant Center ID: ${merchant_center_id}
- Bidding: ${bidding_strategy ?? 'MAXIMIZE_CONVERSION_VALUE'}
- Ad group: "${campaign_name} — Ad Group 1" (all products)`;
    }

    // ── Write: add sitelink asset ────────────────────────────────────────────
    case 'add_sitelink': {
      const { campaign_id, campaign_name, link_text, final_url, description1, description2 } = input;

      // 1. Create the asset
      const assetRes = await runGaqlMutate(cfg, 'assets', [{
        create: {
          name:          `Sitelink — ${link_text}`,
          sitelinkAsset: {
            linkText:     link_text,
            finalUrls:    [final_url],
            description1: description1 ?? '',
            description2: description2 ?? '',
          },
        },
      }]);
      const assetResource = assetRes.results[0].resourceName as string;

      // 2. Link to campaign
      await runGaqlMutate(cfg, 'campaignAssets', [{
        create: {
          asset:     assetResource,
          campaign:  `customers/${customerId}/campaigns/${campaign_id}`,
          fieldType: 'SITELINK',
        },
      }]);

      return `✅ Sitelink **"${link_text}"** → ${final_url} added to campaign "${campaign_name}".`;
    }

    // ── Write: add callout asset ─────────────────────────────────────────────
    case 'add_callout': {
      const { campaign_id, campaign_name, callout_text } = input;

      const assetRes = await runGaqlMutate(cfg, 'assets', [{
        create: {
          name:          `Callout — ${callout_text}`,
          calloutAsset:  { calloutText: callout_text },
        },
      }]);
      const assetResource = assetRes.results[0].resourceName as string;

      await runGaqlMutate(cfg, 'campaignAssets', [{
        create: {
          asset:     assetResource,
          campaign:  `customers/${customerId}/campaigns/${campaign_id}`,
          fieldType: 'CALLOUT',
        },
      }]);

      return `✅ Callout **"${callout_text}"** added to campaign "${campaign_name}".`;
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
    description: 'Get product-level ecommerce revenue from Google Analytics 4. Pascal Press (pp) only — returns books and packs with revenue, units purchased, and views. Use to cross-reference shopping ad spend with actual product sales. Do NOT call for ETZ or HSC.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        min_revenue: { type: 'number', description: 'Only return products with at least this revenue (AUD). Useful for filtering noise.' },
      },
    },
  },
  {
    name:        'get_ga4_campaign_revenue',
    description: 'Get GA4 revenue broken down by paid ad campaign (cpc medium only). Works for all accounts. Use this to cross-reference Google Ads spend with actual GA4 revenue per campaign and calculate true ROAS. Always call this alongside get_campaigns when the user asks about ROAS, revenue, or campaign performance — it gives the same view as the Finance tab Ad Campaigns section.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM },
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
  {
    name:        'create_search_campaign',
    description: 'Create a complete Google Search campaign including budget, campaign, ad group, responsive search ad, and keywords. Always start campaigns as PAUSED so the user can review before going live. Gather all required info from the user before calling this tool.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_name:     { type: 'string', description: 'Campaign name, e.g. "PP_Search_Brand_FY27".' },
        daily_budget_aud:  { type: 'number', description: 'Daily budget in AUD, e.g. 20 for $20/day.' },
        headlines:         { type: 'array', items: { type: 'string' }, description: 'RSA headlines — minimum 3, maximum 15. Each max 30 characters.' },
        descriptions:      { type: 'array', items: { type: 'string' }, description: 'RSA descriptions — minimum 2, maximum 4. Each max 90 characters.' },
        final_url:         { type: 'string', description: 'Landing page URL, e.g. "https://pascalpress.com.au".' },
        keywords:          { type: 'array', items: { type: 'string' }, description: 'Keywords to target, e.g. ["pascal press books", "hsc study guides"].' },
        match_type:        { type: 'string', enum: ['BROAD', 'PHRASE', 'EXACT'], description: 'Match type for all keywords. Default PHRASE.' },
        bidding_strategy:  { type: 'string', enum: ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC', 'TARGET_CPA'], description: 'Bidding strategy. Default MAXIMIZE_CONVERSIONS.' },
        target_cpa_aud:    { type: 'number', description: 'Target CPA in AUD — only used when bidding_strategy is TARGET_CPA.' },
        geo_target_ids:    { type: 'array', items: { type: 'number' }, description: 'Google Ads geo target constant IDs. Common: 2036 = Australia, 21471 = NSW, 21473 = VIC, 21474 = QLD. Default [2036].' },
      },
      required: ['campaign_name', 'daily_budget_aud', 'headlines', 'descriptions', 'final_url', 'keywords'],
    },
  },
  {
    name:        'create_shopping_campaign',
    description: 'Create a Google Shopping campaign including budget, campaign, ad group, and product ad. Requires a Google Merchant Center ID. Starts PAUSED for review.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_name:      { type: 'string', description: 'Campaign name, e.g. "PP_Shopping_Books_FY27".' },
        daily_budget_aud:   { type: 'number', description: 'Daily budget in AUD.' },
        merchant_center_id: { type: 'string', description: 'Google Merchant Center account ID (ask the user if unsure).' },
        bidding_strategy:   { type: 'string', enum: ['MAXIMIZE_CONVERSION_VALUE', 'MAXIMIZE_CLICKS'], description: 'Default MAXIMIZE_CONVERSION_VALUE.' },
        geo_target_ids:     { type: 'array', items: { type: 'number' }, description: 'Geo target IDs. Default [2036] = Australia.' },
      },
      required: ['campaign_name', 'daily_budget_aud', 'merchant_center_id'],
    },
  },
  {
    name:        'add_sitelink',
    description: 'Add a sitelink extension to a campaign. Sitelinks show additional links below the main ad.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name for confirmation.' },
        link_text:     { type: 'string', description: 'Link anchor text, max 25 characters, e.g. "Free Trial".' },
        final_url:     { type: 'string', description: 'URL the sitelink points to.' },
        description1:  { type: 'string', description: 'Optional first description line, max 35 characters.' },
        description2:  { type: 'string', description: 'Optional second description line, max 35 characters.' },
      },
      required: ['campaign_id', 'campaign_name', 'link_text', 'final_url'],
    },
  },
  {
    name:        'add_callout',
    description: 'Add a callout extension to a campaign. Callouts are short snippets of text that appear with ads highlighting features or offers, e.g. "Free Shipping", "HSC Experts", "Est. 1990".',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name for confirmation.' },
        callout_text:  { type: 'string', description: 'Callout text, max 25 characters.' },
      },
      required: ['campaign_id', 'campaign_name', 'callout_text'],
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

    const ppExtra = account === 'pp'
      ? '\n- For Pascal Press shopping campaigns, also call get_ga4_product_revenue to see ROAS per individual book or pack title.'
      : '\n- For this account, use get_ga4_campaign_revenue for all revenue data (do NOT call get_ga4_product_revenue — that is Pascal Press ecommerce only and returns nothing here).';

    const systemPrompt = `You are a Google Ads assistant for the Pascal Press team. You have full read and write access to the Google Ads account.

**Currently managing:** ${accountName}
**Today's date:** ${today}

**GA4 is the source of truth for revenue — Google Ads conversion numbers are unreliable.**
- Always use get_ga4_campaign_revenue when the user asks about revenue, ROAS, or campaign performance. Call it alongside get_campaigns so you can show spend and GA4 revenue side by side.
- ROAS = GA4 revenue ÷ Google Ads spend. Below 2× is poor; above 4× is good.${ppExtra}

**How to approach analysis:**
- Start with get_campaigns + get_ga4_campaign_revenue together to build the spend vs revenue picture
- Use get_shopping_products to drill into product-level spend
- Use get_search_terms to find irrelevant queries and negative keyword opportunities

**Before making changes:**
- Confirm what you're about to do in plain language before calling a mutate tool
- After a successful change, summarise what was done

**Creating campaigns:** Gather all required details from the user before calling create_search_campaign or create_shopping_campaign. Always confirm the full details back to the user ("Here's what I'm about to create: …") and wait for a yes before calling the create tool. New campaigns are always created PAUSED.

**Adding assets:** Use add_sitelink and add_callout to add extensions to existing campaigns. Get the campaign ID first via get_campaigns if needed.

**Recommending new campaigns for better ROAS:**
When asked for campaign recommendations, run get_campaigns + get_ga4_campaign_revenue + get_search_terms (and get_ga4_product_revenue for Pascal Press) to understand the full picture, then recommend specific new campaigns based on:
- High-converting search terms that lack a dedicated campaign or ad group (segment them out for better relevance + Quality Score)
- Products or product categories generating strong GA4 revenue with no dedicated campaign
- Geographic gaps — e.g. a top-performing NSW campaign with no equivalent for VIC/QLD/WA
- Campaign type gaps — e.g. strong Shopping performance with no branded Search campaign to capture intent
- Underserved audience signals — e.g. a brand (HSC Copilot, ETZ) with only one campaign and no product-specific split
For each recommendation output: **Campaign name | Type | Suggested budget | Target geo | Why | Expected ROAS impact**. Then ask if they want to create any of them now.

**Output format:** Use markdown. When showing campaign performance, present a table: Campaign | Spend | GA4 Revenue | ROAS. Use ✅ for completed actions. Always show AUD amounts.`;

    const client     = new Anthropic();
    const apiMessages: Anthropic.MessageParam[] = [...messages];
    let   finalText  = '';

    // Agentic loop — up to 8 turns (campaign creation needs budget + campaign + geo + adGroup + ad + keywords)
    for (let turn = 0; turn < 8; turn++) {
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
