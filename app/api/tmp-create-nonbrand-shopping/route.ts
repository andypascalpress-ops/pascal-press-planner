/**
 * TEMPORARY (one-off, remove after use): creates the PAUSED Standard Shopping campaign
 * "Pascal Press - Shopping - Non-Brand - All Products" in the Pascal Press Google Ads account.
 * POST only, planner login cookie required. Refuses to run if a campaign with that name already exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildConfig, runGaqlMutate, runGaqlQuery } from '@/lib/google-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NAME = 'Pascal Press - Shopping - Non-Brand - All Products';
const MERCHANT_ID = '105020904';

// Microsoft Excel / software searches and competitors (from the existing Shopping campaigns, with "word" narrowed so
// "word problems" and "sight words" books still show), plus Pascal Press brand searches.
const NEGATIVES: [string, 'BROAD' | 'PHRASE' | 'EXACT'][] = [
  ['activation', 'BROAD'], ['crack', 'BROAD'], ['csv', 'BROAD'], ['download', 'BROAD'], ['installer', 'BROAD'], ['invoice', 'BROAD'],
  ['macro', 'BROAD'], ['outlook', 'BROAD'], ['powerpoint', 'BROAD'], ['template', 'BROAD'], ['vba', 'BROAD'], ['vlookup', 'BROAD'],
  ['xls', 'BROAD'], ['xlsx', 'BROAD'], ['formulas', 'BROAD'], ['app', 'BROAD'],
  ['budget sheet', 'PHRASE'], ['conditional formatting', 'PHRASE'], ['data validation', 'PHRASE'], ['excel for mac', 'PHRASE'],
  ['financial model', 'PHRASE'], ['google sheets', 'PHRASE'], ['license key', 'PHRASE'], ['macbook excel', 'PHRASE'],
  ['merge cells', 'PHRASE'], ['microsoft', 'PHRASE'], ['ms excel', 'PHRASE'], ['office 365', 'PHRASE'], ['office suite', 'PHRASE'],
  ['pivot table', 'PHRASE'], ['power bi', 'PHRASE'], ['print gridlines', 'PHRASE'], ['serial number', 'PHRASE'],
  ['shortcut keys', 'PHRASE'], ['spreadsheet', 'PHRASE'], ['pdf', 'PHRASE'], ['free', 'PHRASE'],
  ['big w', 'PHRASE'], ['dymocks', 'PHRASE'], ['teachers superstore', 'EXACT'],
  // brand: these go to a separate brand campaign later
  ['pascal press', 'PHRASE'], ['pascalpress', 'PHRASE'], ['pascal', 'PHRASE'],
  ['excel books', 'EXACT'], ['excel book', 'EXACT'], ['excel workbooks', 'EXACT'], ['excel workbook', 'EXACT'],
];

export async function POST(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword || req.cookies.get('pp_auth')?.value !== sitePassword) {
    return NextResponse.json({ error: 'Please sign in to the planner first.' }, { status: 401 });
  }
  const cfg = buildConfig('pp');
  const cid = cfg.customerId;
  const steps: string[] = [];
  try {
    const existing = await runGaqlQuery(cfg, `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.name = '${NAME}' AND campaign.status != 'REMOVED'`);
    if (existing.length) return NextResponse.json({ error: 'Campaign already exists', existing }, { status: 409 });

    const budget = await runGaqlMutate(cfg, 'campaignBudgets', [{ create: {
      name: `${NAME} (budget, ${new Date().toISOString().slice(0, 10)})`, amountMicros: '100000000', deliveryMethod: 'STANDARD', explicitlyShared: false,
    } }]);
    const budgetRn = budget.results[0].resourceName; steps.push(`budget ${budgetRn}`);

    const camp = await runGaqlMutate(cfg, 'campaigns', [{ create: {
      name: NAME, status: 'PAUSED', advertisingChannelType: 'SHOPPING', campaignBudget: budgetRn,
      shoppingSetting: { merchantId: MERCHANT_ID, campaignPriority: 2, enableLocal: false },
      targetRoas: { targetRoas: 5.0 },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    } }]);
    const campRn = camp.results[0].resourceName; steps.push(`campaign ${campRn}`);

    await runGaqlMutate(cfg, 'campaignCriteria', [
      { create: { campaign: campRn, location: { geoTargetConstant: 'geoTargetConstants/2036' } } },
      ...NEGATIVES.map(([text, matchType]) => ({ create: { campaign: campRn, negative: true, keyword: { text, matchType } } })),
    ]);
    steps.push(`Australia + ${NEGATIVES.length} negatives`);

    const ag = await runGaqlMutate(cfg, 'adGroups', [{ create: { name: 'All products', campaign: campRn, type: 'SHOPPING_PRODUCT_ADS', status: 'ENABLED' } }]);
    const agRn = ag.results[0].resourceName; steps.push(`ad group ${agRn}`);

    await runGaqlMutate(cfg, 'adGroupAds', [{ create: { adGroup: agRn, status: 'ENABLED', ad: { shoppingProductAd: {} } } }]);
    steps.push('product ad');

    await runGaqlMutate(cfg, 'adGroupCriteria', [{ create: { adGroup: agRn, status: 'ENABLED', listingGroup: { type: 'UNIT' }, cpcBidMicros: '10000' } }]);
    steps.push('all products (single listing group)');

    return NextResponse.json({ ok: true, customerId: cid, campaign: campRn, steps });
  } catch (e) {
    return NextResponse.json({ ok: false, steps, error: e instanceof Error ? e.message.slice(0, 600) : String(e) }, { status: 502 });
  }
}
