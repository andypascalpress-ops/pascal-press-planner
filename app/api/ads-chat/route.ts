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
    case 'TODAY':        return { startDate: 'today', endDate: 'today' };
    case 'YESTERDAY':    return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'LAST_7_DAYS':  return { startDate: '7daysAgo', endDate: 'today' };
    case 'LAST_30_DAYS': return { startDate: '30daysAgo', endDate: 'today' };
    case 'THIS_WEEK': {
      const d = new Date(now); const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const mon = new Date(d); mon.setDate(d.getDate() - diff); mon.setHours(0,0,0,0);
      return { startDate: mon.toISOString().slice(0, 10), endDate: 'today' };
    }
    case 'LAST_WEEK': {
      const d = new Date(now); const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const thisMon = new Date(d); thisMon.setDate(d.getDate() - diff);
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
      return { startDate: lastMon.toISOString().slice(0, 10), endDate: lastSun.toISOString().slice(0, 10) };
    }
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
          campaign.advertising_channel_type,
          campaign.campaign_budget,
          campaign_budget.amount_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.search_impression_share,
          metrics.search_budget_lost_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        WHERE segments.date DURING ${dr}
        AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 25
      `);
      const campaigns = rows.map(r => {
        const isSearch = r.campaign?.advertisingChannelType === 'SEARCH';
        const imp_share = isSearch && r.metrics?.searchImpressionShare != null
          ? +(Number(r.metrics.searchImpressionShare) * 100).toFixed(1)
          : null;
        const budget_lost = isSearch && r.metrics?.searchBudgetLostImpressionShare != null
          ? +(Number(r.metrics.searchBudgetLostImpressionShare) * 100).toFixed(1)
          : null;
        const rank_lost = isSearch && r.metrics?.searchRankLostImpressionShare != null
          ? +(Number(r.metrics.searchRankLostImpressionShare) * 100).toFixed(1)
          : null;
        return {
          id:              String(r.campaign?.id ?? ''),
          name:            r.campaign?.name ?? '',
          status:          r.campaign?.status ?? '',
          type:            r.campaign?.advertisingChannelType ?? '',
          daily_budget:    +(Number(r.campaignBudget?.amountMicros ?? 0) / 1_000_000).toFixed(2),
          impressions:     Number(r.metrics?.impressions ?? 0),
          clicks:          Number(r.metrics?.clicks ?? 0),
          cost_aud:        +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
          conversions:     +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
          impression_share_pct:      imp_share,
          budget_lost_is_pct:        budget_lost,
          rank_lost_is_pct:          rank_lost,
        };
      });
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

    // ── Read: GA4 site overview ──────────────────────────────────────────────
    case 'get_ga4_overview': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const report = await runGA4Report(account, {
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'totalRevenue' },
          { name: 'keyEvents' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
        dateRanges: [{ startDate, endDate }],
      });
      const r = report.rows?.[0];
      if (!r) return JSON.stringify({ note: 'No data for this period', date_range: input.date_range });
      return JSON.stringify({
        date_range:              input.date_range ?? 'THIS_MONTH',
        sessions:                Number(r.metricValues[0].value),
        total_users:             Number(r.metricValues[1].value),
        new_users:               Number(r.metricValues[2].value),
        total_revenue_aud:       +Number(r.metricValues[3].value).toFixed(2),
        key_events:              Number(r.metricValues[4].value),
        engagement_rate_pct:     +(Number(r.metricValues[5].value) * 100).toFixed(1),
        avg_session_duration_sec: +Number(r.metricValues[6].value).toFixed(0),
        bounce_rate_pct:         +(Number(r.metricValues[7].value) * 100).toFixed(1),
      });
    }

    // ── Read: GA4 traffic sources ────────────────────────────────────────────
    case 'get_ga4_traffic_sources': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const report = await runGA4Report(account, {
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalRevenue' },
          { name: 'keyEvents' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
        ],
        dateRanges: [{ startDate, endDate }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        limit:      50,
      });
      const rows = (report.rows ?? []).map(row => ({
        source:          row.dimensionValues[0].value,
        medium:          row.dimensionValues[1].value,
        sessions:        Number(row.metricValues[0].value),
        revenue_aud:     +Number(row.metricValues[1].value).toFixed(2),
        key_events:      Number(row.metricValues[2].value),
        users:           Number(row.metricValues[3].value),
        bounce_rate_pct: +(Number(row.metricValues[4].value) * 100).toFixed(1),
      }));
      return JSON.stringify(rows, null, 2);
    }

    // ── Read: GA4 full ecommerce (all accounts, item + category level) ───────
    case 'get_ga4_ecommerce': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const byCategory    = input.group_by === 'category';
      const sessionMedium = input.session_medium as string | undefined; // e.g. 'cpc', 'organic'

      // NOTE: GA4 Data API does NOT allow mixing item-scoped dimensions (itemName, itemCategory)
      // with session-scoped dimensions (sessionCampaignName) in a single runReport call.
      // For campaign attribution use get_ga4_campaign_revenue; for item detail use this tool.
      const dims: { name: string }[] = byCategory
        ? [{ name: 'itemCategory' }]
        : [{ name: 'itemName' }, { name: 'itemId' }, { name: 'itemCategory' }];

      const reportReq: Record<string, unknown> = {
        dimensions: dims,
        metrics: [
          { name: 'itemRevenue' },
          { name: 'itemsPurchased' },
          { name: 'itemsViewed' },
          { name: 'addToCarts' },
          { name: 'checkouts' },
        ],
        dateRanges: [{ startDate, endDate }],
        orderBys:   [{ metric: { metricName: 'itemRevenue' }, desc: true }],
        limit:      input.limit ?? 100,
      };
      if (sessionMedium) {
        reportReq.dimensionFilter = {
          filter: { fieldName: 'sessionMedium', stringFilter: { matchType: 'EXACT', value: sessionMedium } },
        };
      }

      const report = await runGA4Report(account, reportReq);
      if (!report.rows?.length) {
        return JSON.stringify({ note: 'No ecommerce item data found for the given filters. If filtering by cpc, ensure GA4 ecommerce tracking is enabled. ETZ/HSC use event-based revenue (not item tracking) — use get_ga4_campaign_revenue instead.', date_range: input.date_range, session_medium: sessionMedium ?? 'all' });
      }

      const rows = (report.rows ?? []).map(row => {
        if (byCategory) {
          return {
            category:     row.dimensionValues[0].value,
            revenue_aud:  +Number(row.metricValues[0].value).toFixed(2),
            purchased:    Number(row.metricValues[1].value),
            viewed:       Number(row.metricValues[2].value),
            add_to_carts: Number(row.metricValues[3].value),
            checkouts:    Number(row.metricValues[4].value),
          };
        }
        return {
          name:         row.dimensionValues[0].value,
          item_id:      row.dimensionValues[1].value,
          category:     row.dimensionValues[2].value,
          revenue_aud:  +Number(row.metricValues[0].value).toFixed(2),
          purchased:    Number(row.metricValues[1].value),
          viewed:       Number(row.metricValues[2].value),
          add_to_carts: Number(row.metricValues[3].value),
          checkouts:    Number(row.metricValues[4].value),
        };
      });
      return JSON.stringify({ session_medium: sessionMedium ?? 'all', rows }, null, 2);
    }

    // ── Read: GA4 conversion / key events breakdown ──────────────────────────
    case 'get_ga4_conversions': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const report = await runGA4Report(account, {
        dimensions: [{ name: 'eventName' }],
        metrics:    [{ name: 'keyEvents' }, { name: 'totalRevenue' }],
        dateRanges: [{ startDate, endDate }],
        orderBys:   [{ metric: { metricName: 'keyEvents' }, desc: true }],
        limit:      50,
      });
      const rows = (report.rows ?? [])
        .filter(row => Number(row.metricValues[0].value) > 0)
        .map(row => ({
          event_name:  row.dimensionValues[0].value,
          key_events:  Number(row.metricValues[0].value),
          revenue_aud: +Number(row.metricValues[1].value).toFixed(2),
        }));
      return JSON.stringify(rows, null, 2);
    }

    // ── Read: GA4 landing pages ──────────────────────────────────────────────
    case 'get_ga4_landing_pages': {
      const { startDate, endDate } = ga4DateRange(input.date_range);
      const limit = Math.min(Number(input.limit ?? 25), 50);
      const report = await runGA4Report(account, {
        dimensions: [{ name: 'landingPage' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalRevenue' },
          { name: 'keyEvents' },
          { name: 'bounceRate' },
          { name: 'engagementRate' },
          { name: 'totalUsers' },
        ],
        dateRanges: [{ startDate, endDate }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        limit,
      });
      const rows = (report.rows ?? []).map(row => ({
        page:            row.dimensionValues[0].value,
        sessions:        Number(row.metricValues[0].value),
        revenue_aud:     +Number(row.metricValues[1].value).toFixed(2),
        key_events:      Number(row.metricValues[2].value),
        bounce_rate_pct: +(Number(row.metricValues[3].value) * 100).toFixed(1),
        engagement_pct:  +(Number(row.metricValues[4].value) * 100).toFixed(1),
        users:           Number(row.metricValues[5].value),
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

    // ── Read: RSA ads ────────────────────────────────────────────────────────
    case 'get_ads': {
      const dr = gaqlDateRange(input.date_range);
      const campaignFilter = input.campaign_id
        ? `AND campaign.id = ${input.campaign_id}`
        : '';
      const adGroupFilter = input.ad_group_id
        ? `AND ad_group.id = ${input.ad_group_id}`
        : '';
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group_ad.ad.id,
          ad_group_ad.ad.type,
          ad_group_ad.status,
          ad_group_ad.ad.final_urls,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.responsive_search_ad.path1,
          ad_group_ad.ad.responsive_search_ad.path2,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM ad_group_ad
        WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        AND ad_group_ad.status != 'REMOVED'
        AND campaign.status != 'REMOVED'
        AND segments.date DURING ${dr}
        ${campaignFilter}
        ${adGroupFilter}
        ORDER BY metrics.cost_micros DESC
        LIMIT 25
      `);
      const ads = rows.map(r => {
        const rsa = r.adGroupAd?.ad?.responsiveSearchAd ?? {};
        return {
          ad_id:        String(r.adGroupAd?.ad?.id ?? ''),
          campaign:     r.campaign?.name ?? '',
          campaign_id:  String(r.campaign?.id ?? ''),
          ad_group:     r.adGroup?.name ?? '',
          ad_group_id:  String(r.adGroup?.id ?? ''),
          status:       r.adGroupAd?.status ?? '',
          final_url:    (r.adGroupAd?.ad?.finalUrls ?? [])[0] ?? '',
          path1:        rsa.path1 ?? '',
          path2:        rsa.path2 ?? '',
          headlines:    (rsa.headlines ?? []).map((h: any) => h.text),
          descriptions: (rsa.descriptions ?? []).map((d: any) => d.text),
          impressions:  Number(r.metrics?.impressions ?? 0),
          clicks:       Number(r.metrics?.clicks ?? 0),
          cost_aud:     +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
          conversions:  +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
        };
      });
      return JSON.stringify(ads, null, 2);
    }

    // ── Write: update RSA headlines/descriptions ──────────────────────────────
    case 'update_rsa': {
      const { ad_group_id, ad_id, ad_name, headlines, descriptions, final_url } = input;
      const updatePayload: any = {
        resourceName: `customers/${customerId}/adGroupAds/${ad_group_id}~${ad_id}`,
        ad: {
          responsiveSearchAd: {
            headlines:    (headlines as string[]).map(t => ({ text: t })),
            descriptions: (descriptions as string[]).map(t => ({ text: t })),
          },
        },
      };
      if (final_url) updatePayload.ad.finalUrls = [final_url];
      const masks = ['ad.responsive_search_ad.headlines', 'ad.responsive_search_ad.descriptions'];
      if (final_url) masks.push('ad.final_urls');
      await runGaqlMutate(cfg, 'adGroupAds', [{
        updateMask: masks.join(','),
        update:     updatePayload,
      }]);
      return `✅ RSA "${ad_name ?? ad_id}" updated with ${(headlines as string[]).length} headlines and ${(descriptions as string[]).length} descriptions. Changes take effect after Google review (usually minutes).`;
    }

    // ── Write: create RSA in existing ad group ────────────────────────────────
    case 'create_rsa': {
      const { ad_group_id, ad_group_name, headlines, descriptions, final_url, path1, path2 } = input;
      const rsa: any = {
        headlines:    (headlines as string[]).map(t => ({ text: t })),
        descriptions: (descriptions as string[]).map(t => ({ text: t })),
      };
      if (path1) rsa.path1 = path1;
      if (path2) rsa.path2 = path2;
      const result = await runGaqlMutate(cfg, 'adGroupAds', [{
        create: {
          adGroup: `customers/${customerId}/adGroups/${ad_group_id}`,
          status:  'PAUSED',
          ad: {
            finalUrls:          [final_url],
            responsiveSearchAd: rsa,
          },
        },
      }]);
      return `✅ New RSA created in ad group "${ad_group_name}" — started PAUSED. Resource: ${result?.results?.[0]?.resourceName ?? 'created'}. Enable it when ready.`;
    }

    // ── Write: add keywords to existing ad group ──────────────────────────────
    case 'add_keywords': {
      const { ad_group_id, ad_group_name, keywords, match_type } = input;
      const operations = (keywords as string[]).map(kw => ({
        create: {
          adGroup:  `customers/${customerId}/adGroups/${ad_group_id}`,
          status:   'ENABLED',
          keyword: {
            text:      kw,
            matchType: match_type ?? 'PHRASE',
          },
        },
      }));
      await runGaqlMutate(cfg, 'adGroupCriteria', operations);
      const kwList = (keywords as string[]).map(k => `"${k}"`).join(', ');
      return `✅ Added ${(keywords as string[]).length} keywords (${match_type ?? 'PHRASE'} match) to ad group "${ad_group_name}": ${kwList}`;
    }

    // ── Write: permanently remove a campaign ─────────────────────────────────
    case 'remove_campaign': {
      const { campaign_id, campaign_name } = input;
      await runGaqlMutate(cfg, 'campaigns', [{
        updateMask: 'status',
        update: {
          resourceName: `customers/${customerId}/campaigns/${campaign_id}`,
          status: 'REMOVED',
        },
      }]);
      return `✅ Campaign "${campaign_name}" (ID: ${campaign_id}) has been permanently removed. This cannot be undone.`;
    }

    // ── Write: create ad group in existing campaign ───────────────────────────
    case 'create_ad_group': {
      const { campaign_id, campaign_name, ad_group_name, ad_group_type } = input;
      const result = await runGaqlMutate(cfg, 'adGroups', [{
        create: {
          name:     ad_group_name,
          campaign: `customers/${customerId}/campaigns/${campaign_id}`,
          status:   'ENABLED',
          type:     ad_group_type ?? 'SEARCH_STANDARD',
        },
      }]);
      const resourceName = result?.results?.[0]?.resourceName ?? '';
      const newAdGroupId = resourceName.split('/').pop() ?? '';
      return `✅ Ad group "${ad_group_name}" created in campaign "${campaign_name}". Ad group ID: ${newAdGroupId}. You can now add keywords and create RSA ads in it.`;
    }

    // ── Read: assets (extensions) on a campaign ───────────────────────────────
    case 'get_assets': {
      const { campaign_id } = input;
      const rows = await runGaqlQuery(cfg, `
        SELECT
          asset.id,
          asset.type,
          asset.name,
          asset.sitelink_asset.link_text,
          asset.sitelink_asset.final_urls,
          asset.sitelink_asset.description1,
          asset.sitelink_asset.description2,
          asset.callout_asset.callout_text,
          asset.structured_snippet_asset.header,
          asset.structured_snippet_asset.values,
          campaign_asset.field_type,
          campaign_asset.status
        FROM campaign_asset
        WHERE campaign.id = ${campaign_id}
        AND campaign_asset.status != 'REMOVED'
      `);
      const assets = rows.map(r => {
        const base: any = {
          asset_id:   String(r.asset?.id ?? ''),
          type:       r.asset?.type ?? '',
          field_type: r.campaignAsset?.fieldType ?? '',
          status:     r.campaignAsset?.status ?? '',
        };
        if (r.asset?.sitelinkAsset) {
          base.link_text    = r.asset.sitelinkAsset.linkText ?? '';
          base.final_url    = (r.asset.sitelinkAsset.finalUrls ?? [])[0] ?? '';
          base.description1 = r.asset.sitelinkAsset.description1 ?? '';
          base.description2 = r.asset.sitelinkAsset.description2 ?? '';
        }
        if (r.asset?.calloutAsset) {
          base.callout_text = r.asset.calloutAsset.calloutText ?? '';
        }
        if (r.asset?.structuredSnippetAsset) {
          base.header = r.asset.structuredSnippetAsset.header ?? '';
          base.values = r.asset.structuredSnippetAsset.values ?? [];
        }
        return base;
      });
      return JSON.stringify(assets, null, 2);
    }

    // ── Write: remove asset from campaign ────────────────────────────────────
    case 'remove_asset': {
      const { campaign_id, campaign_name, asset_id, field_type } = input;
      await runGaqlMutate(cfg, 'campaignAssets', [{
        remove: `customers/${customerId}/campaignAssets/${campaign_id}~${asset_id}~${field_type}`,
      }]);
      return `✅ Asset (ID: ${asset_id}, type: ${field_type}) removed from campaign "${campaign_name}".`;
    }

    // ── Write: add structured snippet ────────────────────────────────────────
    case 'add_structured_snippet': {
      const { campaign_id, campaign_name, header, values } = input;
      const assetResult = await runGaqlMutate(cfg, 'assets', [{
        create: {
          structuredSnippetAsset: {
            header: header,
            values: values as string[],
          },
        },
      }]);
      const assetResource = assetResult?.results?.[0]?.resourceName;
      if (!assetResource) return '❌ Failed to create structured snippet asset.';
      await runGaqlMutate(cfg, 'campaignAssets', [{
        create: {
          campaign:  `customers/${customerId}/campaigns/${campaign_id}`,
          asset:     assetResource,
          fieldType: 'STRUCTURED_SNIPPET',
        },
      }]);
      return `✅ Structured snippet added to campaign "${campaign_name}": "${header}" — ${(values as string[]).join(', ')}`;
    }

    // ── Read: device performance ─────────────────────────────────────────────
    case 'get_device_performance': {
      const dr = gaqlDateRange(input.date_range);
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          segments.device,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM campaign
        WHERE segments.date DURING ${dr}
        AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 150
      `);
      const byDevice: Record<string, any[]> = {};
      for (const r of rows) {
        const device = r.segments?.device ?? 'UNKNOWN';
        if (!byDevice[device]) byDevice[device] = [];
        byDevice[device].push({
          campaign:    r.campaign?.name ?? '',
          campaign_id: String(r.campaign?.id ?? ''),
          impressions: Number(r.metrics?.impressions ?? 0),
          clicks:      Number(r.metrics?.clicks ?? 0),
          cost_aud:    +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
          conversions: +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
        });
      }
      return JSON.stringify(byDevice, null, 2);
    }

    // ── Read: ad groups ──────────────────────────────────────────────────────
    case 'get_ad_groups': {
      const dr = gaqlDateRange(input.date_range);
      const campaignFilter = input.campaign_id
        ? `AND campaign.id = ${input.campaign_id}`
        : '';
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM ad_group
        WHERE ad_group.status != 'REMOVED'
        AND campaign.status != 'REMOVED'
        ${campaignFilter}
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `);
      const adGroups = rows.map(r => ({
        campaign:     r.campaign?.name ?? '',
        campaign_id:  String(r.campaign?.id ?? ''),
        ad_group_id:  String(r.adGroup?.id ?? ''),
        ad_group:     r.adGroup?.name ?? '',
        status:       r.adGroup?.status ?? '',
        impressions:  Number(r.metrics?.impressions ?? 0),
        clicks:       Number(r.metrics?.clicks ?? 0),
        cost_aud:     +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions:  +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
      }));
      return JSON.stringify(adGroups, null, 2);
    }

    // ── Write: pause / enable an ad group ────────────────────────────────────
    case 'set_ad_group_status': {
      const { ad_group_id, ad_group_name, status } = input;
      await runGaqlMutate(cfg, 'adGroups', [{
        updateMask: 'status',
        update: {
          resourceName: `customers/${customerId}/adGroups/${ad_group_id}`,
          status,
        },
      }]);
      const verb = status === 'ENABLED' ? 'enabled' : 'paused';
      return `✅ Ad group "${ad_group_name}" (ID: ${ad_group_id}) has been ${verb}.`;
    }

    // ── Read: keyword performance ────────────────────────────────────────────
    case 'get_keywords': {
      const dr = gaqlDateRange(input.date_range);
      const campaignFilter = input.campaign_id
        ? `AND campaign.id = ${input.campaign_id}`
        : '';
      const limit = Math.min(Number(input.limit ?? 50), 200);
      const rows = await runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          ad_group_criterion.effective_cpc_bid_micros,
          ad_group_criterion.quality_info.quality_score,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.average_cpc
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'
        AND campaign.status != 'REMOVED'
        ${campaignFilter}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);
      const keywords = rows.map(r => ({
        campaign:      r.campaign?.name ?? '',
        campaign_id:   String(r.campaign?.id ?? ''),
        ad_group:      r.adGroup?.name ?? '',
        ad_group_id:   String(r.adGroup?.id ?? ''),
        criterion_id:  String(r.adGroupCriterion?.criterionId ?? ''),
        keyword:       r.adGroupCriterion?.keyword?.text ?? '',
        match_type:    r.adGroupCriterion?.keyword?.matchType ?? '',
        status:        r.adGroupCriterion?.status ?? '',
        quality_score: r.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
        bid_aud:       r.adGroupCriterion?.effectiveCpcBidMicros
                         ? +(Number(r.adGroupCriterion.effectiveCpcBidMicros) / 1_000_000).toFixed(2)
                         : null,
        impressions:   Number(r.metrics?.impressions ?? 0),
        clicks:        Number(r.metrics?.clicks ?? 0),
        cost_aud:      +(Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2),
        conversions:   +(Number(r.metrics?.conversions ?? 0)).toFixed(1),
        avg_cpc_aud:   r.metrics?.averageCpc
                         ? +(Number(r.metrics.averageCpc) / 1_000_000).toFixed(2)
                         : null,
      }));
      return JSON.stringify(keywords, null, 2);
    }

    // ── Write: update keyword CPC bid ────────────────────────────────────────
    case 'update_keyword_bid': {
      const { ad_group_id, criterion_id, keyword_text, new_bid_aud } = input;
      const bidMicros = Math.round(Number(new_bid_aud) * 1_000_000);
      await runGaqlMutate(cfg, 'adGroupCriteria', [{
        updateMask: 'max_cpc_bid_micros',
        update: {
          resourceName:    `customers/${customerId}/adGroupCriteria/${ad_group_id}~${criterion_id}`,
          maxCpcBidMicros: String(bidMicros),
        },
      }]);
      return `✅ Keyword "${keyword_text}" bid updated to $${Number(new_bid_aud).toFixed(2)} CPC.`;
    }

    // ── Write: pause / enable a keyword ──────────────────────────────────────
    case 'set_keyword_status': {
      const { ad_group_id, criterion_id, keyword_text, status } = input;
      await runGaqlMutate(cfg, 'adGroupCriteria', [{
        updateMask: 'status',
        update: {
          resourceName: `customers/${customerId}/adGroupCriteria/${ad_group_id}~${criterion_id}`,
          status,
        },
      }]);
      const verb = status === 'ENABLED' ? 'enabled' : 'paused';
      return `✅ Keyword "${keyword_text}" has been ${verb}.`;
    }

    // ── Write: bulk negative keywords ────────────────────────────────────────
    case 'add_negative_keywords_bulk': {
      const { campaign_id, campaign_name, keywords, match_type } = input;
      const operations = (keywords as string[]).map(kw => ({
        create: {
          campaign: `customers/${customerId}/campaigns/${campaign_id}`,
          keyword: {
            text:      kw,
            matchType: match_type ?? 'BROAD',
          },
          negative: true,
        },
      }));
      await runGaqlMutate(cfg, 'campaignCriteria', operations);
      const kwList = (keywords as string[]).map(k => `"${k}"`).join(', ');
      return `✅ Added ${(keywords as string[]).length} negative keywords to "${campaign_name}": ${kwList}`;
    }

    // ── Read: period-over-period performance comparison ───────────────────────
    case 'compare_performance': {
      const p1 = gaqlDateRange(input.period1 ?? 'THIS_WEEK');
      const p2 = gaqlDateRange(input.period2 ?? 'LAST_WEEK');

      const campaignQuery = (dr: string) => runGaqlQuery(cfg, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
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

      const [rows1, rows2] = await Promise.all([campaignQuery(p1), campaignQuery(p2)]);

      const toMap = (rows: any[]) => new Map(rows.map(r => [
        String(r.campaign?.id ?? ''),
        {
          name:        r.campaign?.name ?? '',
          cost:        Number(r.metrics?.costMicros ?? 0) / 1_000_000,
          clicks:      Number(r.metrics?.clicks ?? 0),
          impressions: Number(r.metrics?.impressions ?? 0),
          conversions: Number(r.metrics?.conversions ?? 0),
        },
      ]));

      const map1 = toMap(rows1);
      const map2 = toMap(rows2);
      const allIds = new Set([...map1.keys(), ...map2.keys()]);

      const pct = (curr: number, prev: number) =>
        prev === 0 ? (curr > 0 ? '+∞%' : '—') : `${curr >= prev ? '+' : ''}${(((curr - prev) / prev) * 100).toFixed(0)}%`;

      const comparison = [...allIds].map(id => {
        const a = map1.get(id) ?? { name: map2.get(id)?.name ?? id, cost: 0, clicks: 0, impressions: 0, conversions: 0 };
        const b = map2.get(id) ?? { name: a.name, cost: 0, clicks: 0, impressions: 0, conversions: 0 };
        return {
          campaign:       a.name || b.name,
          curr_spend:     +a.cost.toFixed(2),
          prev_spend:     +b.cost.toFixed(2),
          spend_change:   pct(a.cost, b.cost),
          curr_clicks:    a.clicks,
          prev_clicks:    b.clicks,
          clicks_change:  pct(a.clicks, b.clicks),
          curr_conv:      +a.conversions.toFixed(1),
          prev_conv:      +b.conversions.toFixed(1),
          conv_change:    pct(a.conversions, b.conversions),
        };
      }).sort((a, b) => b.curr_spend - a.curr_spend);

      return JSON.stringify({
        period1: input.period1 ?? 'THIS_WEEK',
        period2: input.period2 ?? 'LAST_WEEK',
        note:    'curr = period1, prev = period2',
        campaigns: comparison,
      }, null, 2);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Claude tools definition ──────────────────────────────────────────────────

const DATE_RANGE_ENUM = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'LAST_7_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS'];

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
    name:        'get_ga4_overview',
    description: 'Get a high-level GA4 summary: sessions, users, revenue, engagement rate, bounce rate, avg session duration. Use as the starting point for any GA4 question or to give a quick health check on the website.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM, description: 'Reporting period. Default THIS_MONTH.' },
      },
    },
  },
  {
    name:        'get_ga4_traffic_sources',
    description: 'Break down website sessions, revenue and conversions by source/medium (e.g. google/cpc, google/organic, direct/none, email/newsletter). Use to see where revenue is coming from across ALL channels, not just paid ads.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM },
      },
    },
  },
  {
    name:        'get_ga4_ecommerce',
    description: 'Get ecommerce item performance from GA4: revenue, units purchased, views, add-to-carts, and checkouts per product or category. Works for Pascal Press (book/pack titles). For ETZ/HSC which use subscription revenue, this may return empty — use get_ga4_campaign_revenue instead. Supports filtering by session_medium (e.g. "cpc" for paid traffic only). NOTE: GA4 does not allow item dimensions and campaign dimensions in the same query — use get_ga4_campaign_revenue for per-campaign totals.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:     { type: 'string', enum: DATE_RANGE_ENUM },
        group_by:       { type: 'string', enum: ['item', 'category'], description: 'Group by individual item (default) or by category.' },
        session_medium: { type: 'string', description: 'Filter to a specific traffic medium. Use "cpc" to see only paid-ad-attributed ecommerce. Omit for all traffic combined.' },
        limit:          { type: 'number', description: 'Max rows (default 100).' },
      },
    },
  },
  {
    name:        'get_ga4_conversions',
    description: 'List all GA4 conversion (key event) counts by event name. Use to see which events are firing — purchases, form submissions, sign-ups, trials — and how many times.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM },
      },
    },
  },
  {
    name:        'get_ga4_landing_pages',
    description: 'Top landing pages by sessions with revenue, conversions, bounce rate and engagement rate. Use to find which pages ads are landing on and how they perform.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM },
        limit:      { type: 'number', description: 'Max rows (default 25, max 50).' },
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
    description: 'Add a single negative keyword to a campaign. For multiple negatives use add_negative_keywords_bulk instead.',
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
    name:        'add_negative_keywords_bulk',
    description: 'Add multiple negative keywords to a campaign in one operation. After reviewing get_search_terms, identify all wasteful queries and block them at once. Much faster than adding one at a time.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name (for confirmation).' },
        keywords:      { type: 'array', items: { type: 'string' }, description: 'List of keyword texts to add as negatives, e.g. ["free", "jobs", "salary"].' },
        match_type:    { type: 'string', enum: ['BROAD', 'PHRASE', 'EXACT'], description: 'Match type for all negatives. Default BROAD.' },
      },
      required: ['campaign_id', 'campaign_name', 'keywords'],
    },
  },
  {
    name:        'get_ads',
    description: 'Get all responsive search ads (RSAs) with their headlines, descriptions, final URL and performance. Use before editing ad copy or to audit what ads are running.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        campaign_id: { type: 'string', description: 'Filter to one campaign. Leave blank for all.' },
        ad_group_id: { type: 'string', description: 'Filter to one ad group. Leave blank for all.' },
      },
    },
  },
  {
    name:        'update_rsa',
    description: 'Update the headlines and/or descriptions of an existing RSA. You MUST provide the full new list of headlines and descriptions (replaces everything). Get ad_id and ad_group_id from get_ads first. Changes go through Google review but typically take effect within minutes.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:  { type: 'string', description: 'Ad group ID from get_ads.' },
        ad_id:        { type: 'string', description: 'Ad ID from get_ads.' },
        ad_name:      { type: 'string', description: 'Ad description for confirmation message.' },
        headlines:    { type: 'array', items: { type: 'string' }, description: 'Complete list of headlines (3–15). Max 30 chars each.' },
        descriptions: { type: 'array', items: { type: 'string' }, description: 'Complete list of descriptions (2–4). Max 90 chars each.' },
        final_url:    { type: 'string', description: 'Landing page URL — only provide if changing it.' },
      },
      required: ['ad_group_id', 'ad_id', 'headlines', 'descriptions'],
    },
  },
  {
    name:        'create_rsa',
    description: 'Create a new responsive search ad in an existing ad group. Always starts PAUSED. Get ad_group_id from get_ad_groups. Confirm full ad details with the user before calling.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:   { type: 'string', description: 'Ad group ID from get_ad_groups.' },
        ad_group_name: { type: 'string', description: 'Ad group name for confirmation.' },
        headlines:     { type: 'array', items: { type: 'string' }, description: 'RSA headlines — 3 to 15, max 30 chars each.' },
        descriptions:  { type: 'array', items: { type: 'string' }, description: 'RSA descriptions — 2 to 4, max 90 chars each.' },
        final_url:     { type: 'string', description: 'Landing page URL.' },
        path1:         { type: 'string', description: 'Optional URL path 1, e.g. "books".' },
        path2:         { type: 'string', description: 'Optional URL path 2, e.g. "year-12".' },
      },
      required: ['ad_group_id', 'ad_group_name', 'headlines', 'descriptions', 'final_url'],
    },
  },
  {
    name:        'add_keywords',
    description: 'Add one or more keywords to an existing ad group. Get ad_group_id from get_ad_groups or get_keywords.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:   { type: 'string', description: 'Ad group ID to add keywords to.' },
        ad_group_name: { type: 'string', description: 'Ad group name for confirmation.' },
        keywords:      { type: 'array', items: { type: 'string' }, description: 'Keyword texts to add, e.g. ["pascal press maths", "year 12 books"].' },
        match_type:    { type: 'string', enum: ['BROAD', 'PHRASE', 'EXACT'], description: 'Match type for all keywords. Default PHRASE.' },
      },
      required: ['ad_group_id', 'ad_group_name', 'keywords'],
    },
  },
  {
    name:        'remove_campaign',
    description: 'PERMANENTLY DELETE a campaign. This is irreversible — the campaign and all its data will be removed. Only call after the user explicitly confirms they want to permanently delete, not just pause.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Numeric Google Ads campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name for confirmation.' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name:        'create_ad_group',
    description: 'Create a new ad group within an existing campaign. Returns the new ad_group_id so you can immediately add keywords or create an RSA in it.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:    { type: 'string', description: 'Campaign ID to create the ad group in.' },
        campaign_name:  { type: 'string', description: 'Campaign name for confirmation.' },
        ad_group_name:  { type: 'string', description: 'Name for the new ad group.' },
        ad_group_type:  { type: 'string', enum: ['SEARCH_STANDARD', 'SHOPPING_PRODUCT_ADS'], description: 'Ad group type. Default SEARCH_STANDARD.' },
      },
      required: ['campaign_id', 'campaign_name', 'ad_group_name'],
    },
  },
  {
    name:        'get_assets',
    description: 'List all assets (sitelinks, callouts, structured snippets) attached to a campaign. Use before adding new assets to avoid duplicates, or to get asset_id and field_type needed for remove_asset.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID to list assets for.' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name:        'remove_asset',
    description: 'Remove (detach) an asset from a campaign. Get asset_id and field_type from get_assets first. This detaches it from the campaign but does not delete the underlying asset.',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name for confirmation.' },
        asset_id:      { type: 'string', description: 'Asset ID from get_assets.' },
        field_type:    { type: 'string', enum: ['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET'], description: 'Asset type from get_assets.' },
      },
      required: ['campaign_id', 'campaign_name', 'asset_id', 'field_type'],
    },
  },
  {
    name:        'add_structured_snippet',
    description: 'Add a structured snippet extension to a campaign. Structured snippets highlight features using a header category and a list of values, e.g. header="Subjects", values=["Maths","English","Science"].',
    input_schema: {
      type:       'object',
      properties: {
        campaign_id:   { type: 'string', description: 'Campaign ID.' },
        campaign_name: { type: 'string', description: 'Campaign name for confirmation.' },
        header:        { type: 'string', description: 'Snippet header — must be a Google-approved category, e.g. "Subjects", "Types", "Courses", "Brands", "Services".' },
        values:        { type: 'array', items: { type: 'string' }, description: 'List of 3–10 values, e.g. ["Maths", "English", "Science"]. Max 25 chars each.' },
      },
      required: ['campaign_id', 'campaign_name', 'header', 'values'],
    },
  },
  {
    name:        'get_device_performance',
    description: 'Break down campaign performance by device: DESKTOP, MOBILE, TABLET. Use to identify if mobile has poor ROAS and should have a bid adjustment, or if spend is wasted on a particular device.',
    input_schema: {
      type:       'object',
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_ENUM },
      },
    },
  },
  {
    name:        'get_ad_groups',
    description: 'List all ad groups with their IDs, status, and performance metrics. Use this to get the ad_group_id needed to pause, enable, or drill into ad groups.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        campaign_id: { type: 'string', description: 'Filter to one campaign. Leave blank for all.' },
      },
    },
  },
  {
    name:        'set_ad_group_status',
    description: 'Pause or enable a specific ad group. Get the ad_group_id from get_ad_groups first.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:   { type: 'string', description: 'Numeric ad group ID from get_ad_groups.' },
        ad_group_name: { type: 'string', description: 'Ad group name for the confirmation message.' },
        status:        { type: 'string', enum: ['ENABLED', 'PAUSED'], description: 'New status.' },
      },
      required: ['ad_group_id', 'ad_group_name', 'status'],
    },
  },
  {
    name:        'get_keywords',
    description: 'Get keyword-level performance including Quality Score, effective CPC bid, clicks, conversions and spend. Use to find low-QS keywords (score < 5), expensive keywords with no conversions, or bid optimisation opportunities.',
    input_schema: {
      type:       'object',
      properties: {
        date_range:  { type: 'string', enum: DATE_RANGE_ENUM },
        campaign_id: { type: 'string', description: 'Filter to one campaign. Leave blank for all.' },
        limit:       { type: 'number', description: 'Max rows (default 50, max 200).' },
      },
    },
  },
  {
    name:        'update_keyword_bid',
    description: 'Update the max CPC bid on a specific keyword. Get ad_group_id and criterion_id from get_keywords first.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:  { type: 'string', description: 'Ad group ID from get_keywords.' },
        criterion_id: { type: 'string', description: 'Keyword criterion ID from get_keywords.' },
        keyword_text: { type: 'string', description: 'Keyword text (for confirmation message).' },
        new_bid_aud:  { type: 'number', description: 'New max CPC bid in AUD, e.g. 1.50.' },
      },
      required: ['ad_group_id', 'criterion_id', 'keyword_text', 'new_bid_aud'],
    },
  },
  {
    name:        'set_keyword_status',
    description: 'Pause or enable a specific keyword within an ad group. Get ad_group_id and criterion_id from get_keywords first.',
    input_schema: {
      type:       'object',
      properties: {
        ad_group_id:  { type: 'string', description: 'Ad group ID from get_keywords.' },
        criterion_id: { type: 'string', description: 'Keyword criterion ID from get_keywords.' },
        keyword_text: { type: 'string', description: 'Keyword text (for confirmation message).' },
        status:       { type: 'string', enum: ['ENABLED', 'PAUSED'], description: 'New status.' },
      },
      required: ['ad_group_id', 'criterion_id', 'keyword_text', 'status'],
    },
  },
  {
    name:        'compare_performance',
    description: 'Compare campaign performance between two periods to detect spend spikes, click drops, or conversion anomalies. Use for week-over-week or month-over-month health checks.',
    input_schema: {
      type:       'object',
      properties: {
        period1: { type: 'string', enum: DATE_RANGE_ENUM, description: 'Current period (default THIS_WEEK).' },
        period2: { type: 'string', enum: DATE_RANGE_ENUM, description: 'Comparison period (default LAST_WEEK).' },
      },
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
- ROAS = GA4 revenue ÷ Google Ads spend. Below 2× is poor; above 4× is good.
- Always call get_ga4_campaign_revenue alongside get_campaigns when the user asks about ROAS or campaign performance.
- Use get_ga4_overview for a site health check (sessions, revenue, engagement, bounce rate).
- Use get_ga4_traffic_sources to see revenue across ALL channels — not just paid.
- Use get_ga4_ecommerce for item/category level ecommerce data (purchases, views, add-to-carts). Pascal Press has full ecommerce tracking; ETZ/HSC use event revenue so this may return empty for them.
  - IMPORTANT: When the user asks about ecommerce sales from paid ads, ALWAYS pass session_medium="cpc" so you only see paid-traffic-attributed purchases — never report all-traffic combined as if it were paid.
  - GA4 LIMITATION: item-scoped dimensions (itemName, itemCategory) and session-scoped dimensions (sessionCampaignName) CANNOT be combined in one query — the API will error. Do NOT attempt this combination.
  - To answer "which products did Campaign X sell?": call get_ga4_ecommerce with session_medium="cpc" for the item list (all paid campaigns combined), AND call get_ga4_campaign_revenue for the campaign's total revenue. Cross-reference both to give a complete picture. Be transparent that GA4 cannot break item revenue down by individual campaign.
- Use get_ga4_conversions to see what conversion events are firing and how often.
- Use get_ga4_landing_pages to see how ad landing pages are performing.${ppExtra}

**How to approach analysis:**
- Start with get_campaigns + get_ga4_campaign_revenue together to build the spend vs revenue picture
- Use get_shopping_products to drill into product-level spend
- Use get_search_terms to find irrelevant queries and negative keyword opportunities
- Use get_keywords to view Quality Score, bids, and keyword-level spend — QS 1–3 = poor, 4–6 = average, 7–10 = good; flag QS < 5 as needing new ad copy or landing page work
- Impression share (search campaigns only): impression_share_pct = % of eligible impressions won; budget_lost_is_pct = % lost due to budget running out; rank_lost_is_pct = % lost due to low ad rank. If budget_lost_is > rank_lost_is → increase budget. If rank_lost_is > budget_lost_is → improve QS or bids.
- Use compare_performance (THIS_WEEK vs LAST_WEEK, or THIS_MONTH vs LAST_MONTH) to spot anomalies — flag any campaign with >30% spend change or >25% click drop

**Negative keywords workflow:**
- After get_search_terms, identify all irrelevant queries and call add_negative_keywords_bulk to block them all at once — do not add one at a time unless there's only one

**Before making changes:**
- Confirm what you're about to do in plain language before calling a mutate tool
- After a successful change, summarise what was done
- To pause or enable an ad group: call get_ad_groups first to get the ad_group_id, then call set_ad_group_status

**Creating campaigns:** Gather all required details from the user before calling create_search_campaign or create_shopping_campaign. Always confirm the full details back to the user ("Here's what I'm about to create: …") and wait for a yes before calling the create tool. New campaigns are always created PAUSED.

**Creating ad groups and ads:** Use create_ad_group to add a new ad group to an existing campaign. Use create_rsa to create a new responsive search ad — always starts PAUSED. To add keywords to an existing ad group use add_keywords. Confirm all details before creating.

**Viewing and editing ads:** Call get_ads to see current RSA headlines, descriptions and performance before suggesting edits. When updating copy with update_rsa, provide the COMPLETE list of headlines and descriptions (it replaces everything). Always confirm the new copy with the user before calling update_rsa.

**Asset management:** Call get_assets to see what sitelinks, callouts and structured snippets are already on a campaign before adding more (avoids duplicates). Use remove_asset with the asset_id and field_type from get_assets to detach an extension. Use add_structured_snippet for snippet extensions with a header + values list.

**Removing campaigns:** Before calling remove_campaign, warn the user explicitly that this is PERMANENT and irreversible. Only call it after they confirm they want to delete, not just pause. Pausing is almost always the better choice.

**Device performance:** Use get_device_performance to break down ROAS by DESKTOP, MOBILE, TABLET. If mobile has poor ROAS, recommend a negative bid adjustment (e.g. -30%) rather than pausing — that preserves mobile traffic at lower cost.

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

    // Agentic loop — up to 10 turns (complex operations need multiple sequential API calls)
    for (let turn = 0; turn < 10; turn++) {
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
