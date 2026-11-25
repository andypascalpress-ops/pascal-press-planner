/**
 * GET /api/ads-compare?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Side-by-side diagnostic of the Pascal Press and Excel Study Guides Google Ads accounts: campaign set-up and bidding,
 * conversion tracking, impression share, devices, search terms, product spend spread, the product feed (prices and
 * listing problems), and what each store itself recorded from paid Google (GA4 for Pascal Press, Shopify for ESG).
 * Guarded by the planner login cookie; never cached. Totals and settings only, no customer details.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildConfig, runGaqlQuery } from '@/lib/google-ads';
import { fetchPaidCampaignRevenue } from '@/lib/google-analytics';
import { fetchShopifySales } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const m = (v: unknown) => Number(v ?? 0) / 1e6;
const n = (v: unknown) => Number(v ?? 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function q(brand: 'pp' | 'esg', query: string): Promise<Row[] | { error: string }> {
  try { return await runGaqlQuery(buildConfig(brand), query); }
  catch (e) { return { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }; }
}
const ok = (x: Row[] | { error: string }): x is Row[] => Array.isArray(x);

async function account(brand: 'pp' | 'esg', start: string, end: string) {
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const [cust, camps, convs, convByAction, devices, terms, products, feed, assetGroups, listingGroups] = await Promise.all([
    q(brand, `SELECT customer.descriptive_name, customer.currency_code, customer.auto_tagging_enabled, customer.conversion_tracking_setting.conversion_tracking_status, customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled FROM customer`),
    q(brand, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type,
      campaign.maximize_conversion_value.target_roas, campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros, campaign.manual_cpc.enhanced_cpc_enabled,
      campaign_budget.amount_micros, campaign.shopping_setting.campaign_priority, campaign.shopping_setting.feed_label, campaign.shopping_setting.enable_local,
      campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network,
      campaign.geo_target_type_setting.positive_geo_target_type,
      metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.all_conversions_value,
      metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, metrics.search_absolute_top_impression_share, metrics.search_click_share
      FROM campaign WHERE ${range} AND campaign.status != 'REMOVED' AND metrics.impressions > 0`),
    q(brand, `SELECT conversion_action.name, conversion_action.category, conversion_action.type, conversion_action.status, conversion_action.primary_for_goal, conversion_action.counting_type,
      conversion_action.include_in_conversions_metric, conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value, conversion_action.origin,
      conversion_action.attribution_model_settings.attribution_model, conversion_action.click_through_lookback_window_days FROM conversion_action WHERE conversion_action.status = 'ENABLED'`),
    q(brand, `SELECT segments.conversion_action_name, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM customer WHERE ${range}`),
    q(brand, `SELECT segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions_value FROM customer WHERE ${range}`),
    q(brand, `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM search_term_view WHERE ${range} ORDER BY metrics.cost_micros DESC LIMIT 40`),
    q(brand, `SELECT segments.product_item_id, segments.product_title, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM shopping_performance_view WHERE ${range} AND metrics.impressions > 0`),
    q(brand, `SELECT shopping_product.item_id, shopping_product.title, shopping_product.price_micros, shopping_product.status, shopping_product.availability, shopping_product.issues, shopping_product.brand, shopping_product.custom_attribute0 FROM shopping_product LIMIT 5000`),
    q(brand, `SELECT asset_group.name, asset_group.status, campaign.name, asset_group.ad_strength FROM asset_group WHERE asset_group.status != 'REMOVED'`),
    q(brand, `SELECT ad_group_criterion.listing_group.type, ad_group_criterion.cpc_bid_micros, ad_group_criterion.negative, campaign.name, ad_group.name FROM ad_group_criterion WHERE ad_group_criterion.type = 'LISTING_GROUP' AND ad_group_criterion.listing_group.type = 'UNIT' AND campaign.status = 'ENABLED' LIMIT 2000`),
  ]);

  const campaigns = ok(camps) ? camps.map(r => {
    const cost = m(r.metrics?.costMicros), val = n(r.metrics?.conversionsValue);
    return {
      name: r.campaign?.name, status: r.campaign?.status, type: r.campaign?.advertisingChannelType, subType: r.campaign?.advertisingChannelSubType,
      bidding: r.campaign?.biddingStrategyType,
      targetRoas: r.campaign?.maximizeConversionValue?.targetRoas ?? r.campaign?.targetRoas?.targetRoas ?? null,
      targetCpa: r.campaign?.maximizeConversions?.targetCpaMicros ? m(r.campaign.maximizeConversions.targetCpaMicros) : null,
      dailyBudget: r2(m(r.campaignBudget?.amountMicros)),
      shoppingPriority: r.campaign?.shoppingSetting?.campaignPriority ?? null, feedLabel: r.campaign?.shoppingSetting?.feedLabel ?? null,
      networks: { search: r.campaign?.networkSettings?.targetSearchNetwork, display: r.campaign?.networkSettings?.targetContentNetwork, partners: r.campaign?.networkSettings?.targetPartnerSearchNetwork },
      geoTargetType: r.campaign?.geoTargetTypeSetting?.positiveGeoTargetType ?? null,
      cost: r2(cost), clicks: n(r.metrics?.clicks), impressions: n(r.metrics?.impressions), conversions: r2(n(r.metrics?.conversions)),
      googleValue: r2(val), googleRoas: cost > 0 ? r2(val / cost) : null,
      cpc: n(r.metrics?.clicks) ? r2(cost / n(r.metrics?.clicks)) : null, ctr: n(r.metrics?.impressions) ? r2((n(r.metrics?.clicks) / n(r.metrics?.impressions)) * 100) : null,
      impressionShare: r.metrics?.searchImpressionShare ?? null, lostToBudget: r.metrics?.searchBudgetLostImpressionShare ?? null, lostToRank: r.metrics?.searchRankLostImpressionShare ?? null,
      absTopShare: r.metrics?.searchAbsoluteTopImpressionShare ?? null, clickShare: r.metrics?.searchClickShare ?? null,
    };
  }).sort((a, b) => b.cost - a.cost) : camps;

  // product spend spread: how concentrated spend is, and how much goes to products with no conversions
  let productSpread: unknown = products;
  if (ok(products)) {
    const by = new Map<string, { title: string; cost: number; clicks: number; conv: number }>();
    for (const r of products) {
      const id = String(r.segments?.productItemId ?? '');
      const e = by.get(id) ?? { title: String(r.segments?.productTitle ?? ''), cost: 0, clicks: 0, conv: 0 };
      e.cost += m(r.metrics?.costMicros); e.clicks += n(r.metrics?.clicks); e.conv += n(r.metrics?.conversions);
      by.set(id, e);
    }
    const list = [...by.values()].sort((a, b) => b.cost - a.cost);
    const total = list.reduce((s, x) => s + x.cost, 0);
    const share = (k: number) => (total ? r2((list.slice(0, k).reduce((s, x) => s + x.cost, 0) / total) * 100) : null);
    const zero = list.filter(x => x.conv < 0.5);
    productSpread = {
      productsWithImpressions: list.length, productsWithSpend: list.filter(x => x.cost > 0).length, totalCost: r2(total),
      top10SharePct: share(10), top50SharePct: share(50),
      zeroConversionProducts: zero.filter(x => x.cost > 0).length, zeroConversionCost: r2(zero.reduce((s, x) => s + x.cost, 0)),
      top25: list.slice(0, 25).map(x => ({ title: x.title, cost: r2(x.cost), clicks: x.clicks, conv: r2(x.conv) })),
    };
  }

  // feed: size, approval, price spread, common listing problems
  let feedSummary: unknown = feed;
  if (ok(feed)) {
    const prices = feed.map(r => m(r.shoppingProduct?.priceMicros)).filter(p => p > 0).sort((a, b) => a - b);
    const pct = (p: number) => (prices.length ? r2(prices[Math.min(prices.length - 1, Math.floor(p * prices.length))]) : null);
    const statuses: Record<string, number> = {}, avail: Record<string, number> = {}, issues: Record<string, number> = {};
    for (const r of feed) {
      const s = String(r.shoppingProduct?.status ?? 'UNKNOWN'); statuses[s] = (statuses[s] ?? 0) + 1;
      const a = String(r.shoppingProduct?.availability ?? 'UNKNOWN'); avail[a] = (avail[a] ?? 0) + 1;
      for (const i of r.shoppingProduct?.issues ?? []) { const k = `${i.severity ?? ''} ${i.errorCode ?? i.description ?? ''}`.trim(); issues[k] = (issues[k] ?? 0) + 1; }
    }
    feedSummary = {
      products: feed.length, statuses, availability: avail,
      priceMedian: pct(0.5), priceP25: pct(0.25), priceP75: pct(0.75),
      topIssues: Object.entries(issues).sort((a, b) => b[1] - a[1]).slice(0, 15),
      titleSamples: feed.slice(0, 15).map(r => ({ title: r.shoppingProduct?.title, price: r2(m(r.shoppingProduct?.priceMicros)), brand: r.shoppingProduct?.brand })),
      // price by normalised title, for comparing the same book across the two stores
      priceIndex: Object.fromEntries(feed.map(r => [String(r.shoppingProduct?.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), r2(m(r.shoppingProduct?.priceMicros))])),
    };
  }

  const sumBy = (rows: Row[] | { error: string }, keyFn: (r: Row) => string) => ok(rows) ? Object.entries(rows.reduce((acc: Record<string, { cost: number; clicks: number; impressions: number; value: number }>, r) => {
    const k = keyFn(r); const e = acc[k] ?? { cost: 0, clicks: 0, impressions: 0, value: 0 };
    e.cost += m(r.metrics?.costMicros); e.clicks += n(r.metrics?.clicks); e.impressions += n(r.metrics?.impressions); e.value += n(r.metrics?.conversionsValue);
    acc[k] = e; return acc;
  }, {})).map(([k, v]) => ({ key: k, cost: r2(v.cost), clicks: v.clicks, impressions: v.impressions, cpc: v.clicks ? r2(v.cost / v.clicks) : null })) : rows;

  let listingSummary: unknown = listingGroups;
  if (ok(listingGroups)) {
    const bids = listingGroups.filter(r => !r.adGroupCriterion?.negative).map(r => m(r.adGroupCriterion?.cpcBidMicros)).filter(b => b > 0).sort((a, b) => a - b);
    listingSummary = { units: listingGroups.length, excluded: listingGroups.filter(r => r.adGroupCriterion?.negative).length, bidsSet: bids.length, bidMedian: bids.length ? r2(bids[Math.floor(bids.length / 2)]) : null, bidMax: bids.length ? r2(bids[bids.length - 1]) : null };
  }

  return {
    customer: ok(cust) ? cust[0]?.customer : cust,
    campaigns,
    conversionActions: ok(convs) ? convs.map(r => ({ name: r.conversionAction?.name, category: r.conversionAction?.category, type: r.conversionAction?.type, primary: r.conversionAction?.primaryForGoal, counting: r.conversionAction?.countingType, inConversions: r.conversionAction?.includeInConversionsMetric, defaultValue: r.conversionAction?.valueSettings?.defaultValue, alwaysDefault: r.conversionAction?.valueSettings?.alwaysUseDefaultValue, origin: r.conversionAction?.origin, attribution: r.conversionAction?.attributionModelSettings?.attributionModel, lookbackDays: r.conversionAction?.clickThroughLookbackWindowDays })) : convs,
    conversionsByAction: ok(convByAction) ? convByAction.map(r => ({ action: r.segments?.conversionActionName, conversions: r2(n(r.metrics?.conversions)), value: r2(n(r.metrics?.conversionsValue)), allConversions: r2(n(r.metrics?.allConversions)), allValue: r2(n(r.metrics?.allConversionsValue)) })).filter(x => x.allConversions > 0 || x.conversions > 0).sort((a, b) => b.allValue - a.allValue) : convByAction,
    devices: sumBy(devices, r => String(r.segments?.device ?? '')),
    searchTerms: ok(terms) ? terms.map(r => ({ term: r.searchTermView?.searchTerm, cost: r2(m(r.metrics?.costMicros)), clicks: n(r.metrics?.clicks), conv: r2(n(r.metrics?.conversions)) })) : terms,
    productSpread,
    feed: feedSummary,
    assetGroups: ok(assetGroups) ? assetGroups.map(r => ({ campaign: r.campaign?.name, name: r.assetGroup?.name, status: r.assetGroup?.status, strength: r.assetGroup?.adStrength })) : assetGroups,
    listingGroups: listingSummary,
  };
}

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401, headers: NO_STORE });
  }
  const start = req.nextUrl.searchParams.get('start') ?? '', end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400, headers: NO_STORE });

  const [pp, esg, ga4, shop] = await Promise.allSettled([
    account('pp', start, end), account('esg', start, end),
    fetchPaidCampaignRevenue(start, end, 'pp'),
    fetchShopifySales(start, end),
  ]);
  const err = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? String(r.reason).slice(0, 300) : null);

  // what each store itself recorded from paid Google clicks
  const storeRecorded = {
    pp: ga4.status === 'fulfilled' ? { source: 'GA4, paid Google sessions', revenue: r2(ga4.value.totalRevenue), transactions: ga4.value.totalTx, byCampaign: ga4.value.byCampaign } : { error: err(ga4) },
    esg: shop.status === 'fulfilled' ? {
      source: 'Shopify last click',
      googleChannels: shop.value.bySource.filter(s => /^Google/.test(s.source)),
      totalRevenue: shop.value.revenue, orders: shop.value.orders,
      googleCampaignTags: (shop.value.byCampaign ?? []).filter(c => /^Google/.test(c.channel)).slice(0, 20),
    } : { error: err(shop) },
  };

  return NextResponse.json({
    period: { start, end },
    pp: pp.status === 'fulfilled' ? pp.value : { error: err(pp) },
    esg: esg.status === 'fulfilled' ? esg.value : { error: err(esg) },
    storeRecorded,
  }, { headers: NO_STORE });
}
