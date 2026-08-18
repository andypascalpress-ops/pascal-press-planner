/**
 * Meta (Facebook) Ads – Graph API client
 *
 * Required Vercel env vars:
 *   META_ADS_ACCESS_TOKEN    — System User access token (never expires).
 *                              Create in Meta Business Suite → Settings → Users → System Users.
 *                              Grant the user "Analyst" access to both ad accounts,
 *                              then Generate Token → select your app → ads_read permission.
 *   META_PP_AD_ACCOUNT_ID    — Pascal Press ad account, e.g. "act_1234567890"
 *   META_ETZ_AD_ACCOUNT_ID   — Excel Test Zone ad account, e.g. "act_0987654321"
 *
 * Currency: the API returns spend in the ad account's currency (assumed AUD).
 *
 * Campaign filtering: when PP and ETZ share one ad account, pass a `campaignFilter`
 * to split by campaign name. ETZ campaigns should contain "ETZ" in their name;
 * PP campaigns should NOT (i.e. excludes: 'ETZ').
 */

const META_GRAPH_API = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN   = process.env.META_ADS_ACCESS_TOKEN   ?? '';

export const META_PP_ACCOUNT_ID  = process.env.META_PP_AD_ACCOUNT_ID  ?? '';
export const META_ETZ_ACCOUNT_ID = process.env.META_ETZ_AD_ACCOUNT_ID ?? '';

/** Optional campaign-name filter (case-insensitive substring match). */
export interface MetaCampaignFilter {
  contains?: string;  // campaign name MUST contain this string
  excludes?: string;  // campaign name must NOT contain this string
}

/**
 * Returns total ad spend (AUD) for an account over a date range.
 *
 * - When `campaignFilter` is omitted: returns the account-level total (fast, 1 request).
 * - When `campaignFilter` is provided: fetches campaign-level breakdown and sums only
 *   matching campaigns. Handles Meta's pagination automatically.
 *
 * Returns 0 (not an error) when no credentials are configured.
 * Throws on API errors so the caller can surface them as adsError.
 */
export async function fetchMetaSpend(
  adAccountId:    string,            // include "act_" prefix, e.g. "act_123456789"
  startDate:      string,            // "YYYY-MM-DD"
  endDate:        string,            // "YYYY-MM-DD"
  campaignFilter?: MetaCampaignFilter,
): Promise<number> {
  if (!ACCESS_TOKEN || !adAccountId) return 0;

  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // ── No filter: account-level total (single request) ───────────────────────
  if (!campaignFilter) {
    const params = new URLSearchParams({
      fields:       'spend',
      time_range:   timeRange,
      access_token: ACCESS_TOKEN,
    });
    const res = await fetch(`${META_GRAPH_API}/${adAccountId}/insights?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `Meta Ads ${adAccountId} → HTTP ${res.status}: ${(err as any)?.error?.message ?? 'unknown error'}`
      );
    }
    const json = await res.json();
    const spend = (json as any).data?.[0]?.spend;
    return spend ? Math.round(parseFloat(spend) * 100) / 100 : 0;
  }

  // ── With filter: campaign-level breakdown, paginated ──────────────────────
  const { contains, excludes } = campaignFilter;
  const containsLower = contains?.toLowerCase();
  const excludesLower = excludes?.toLowerCase();

  let total = 0;
  let nextUrl: string | null = null;

  // First page
  const firstParams = new URLSearchParams({
    fields:       'campaign_name,spend',
    level:        'campaign',
    time_range:   timeRange,
    access_token: ACCESS_TOKEN,
    limit:        '500',
  });
  nextUrl = `${META_GRAPH_API}/${adAccountId}/insights?${firstParams}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `Meta Ads campaigns ${adAccountId} → HTTP ${res.status}: ${(err as any)?.error?.message ?? 'unknown error'}`
      );
    }
    const json = await res.json() as {
      data?: Array<{ campaign_name?: string; spend?: string }>;
      paging?: { next?: string };
    };

    for (const c of json.data ?? []) {
      const name = (c.campaign_name ?? '').toLowerCase();
      if (containsLower && !name.includes(containsLower)) continue;
      if (excludesLower &&  name.includes(excludesLower)) continue;
      total += parseFloat(c.spend ?? '0');
    }

    // Follow pagination cursor (but replace the access_token each time — Meta
    // sometimes strips it from the next URL).
    const rawNext = json.paging?.next ?? null;
    if (rawNext) {
      const u = new URL(rawNext);
      if (!u.searchParams.get('access_token')) {
        u.searchParams.set('access_token', ACCESS_TOKEN);
      }
      nextUrl = u.toString();
    } else {
      nextUrl = null;
    }
  }

  return Math.round(total * 100) / 100;
}

// ── Campaign breakdown ────────────────────────────────────────────────────────

export interface MetaCampaign {
  id:          string;
  name:        string;
  spend:       number;
  impressions: number;
  clicks:      number;
  ctr:         number;   // already in percent, e.g. 2.5 = 2.5%
  cpm:         number;   // AUD cost per 1 000 impressions
  reach:       number;
  frequency:   number;
}

/**
 * Returns all campaigns (sorted by spend desc) for an account + date range.
 * Optionally filters by campaign name (same contains/excludes pattern as fetchMetaSpend).
 * Returns [] when no credentials are configured; throws on API errors.
 */
export async function fetchMetaCampaigns(
  adAccountId:     string,
  startDate:       string,
  endDate:         string,
  campaignFilter?: MetaCampaignFilter,
): Promise<MetaCampaign[]> {
  if (!ACCESS_TOKEN || !adAccountId) return [];

  const timeRange     = JSON.stringify({ since: startDate, until: endDate });
  const containsLower = campaignFilter?.contains?.toLowerCase();
  const excludesLower = campaignFilter?.excludes?.toLowerCase();

  const results: MetaCampaign[] = [];
  let nextUrl: string | null = null;

  const firstParams = new URLSearchParams({
    fields:       'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,reach,frequency',
    level:        'campaign',
    time_range:   timeRange,
    access_token: ACCESS_TOKEN,
    limit:        '500',
  });
  nextUrl = `${META_GRAPH_API}/${adAccountId}/insights?${firstParams}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `Meta campaigns ${adAccountId} → HTTP ${res.status}: ${(err as any)?.error?.message ?? 'unknown'}`
      );
    }
    const json = await res.json() as {
      data?: Array<{
        campaign_id?:   string;
        campaign_name?: string;
        spend?:         string;
        impressions?:   string;
        clicks?:        string;
        ctr?:           string;
        cpm?:           string;
        reach?:         string;
        frequency?:     string;
      }>;
      paging?: { next?: string };
    };

    for (const c of json.data ?? []) {
      const name = (c.campaign_name ?? '').toLowerCase();
      if (containsLower && !name.includes(containsLower)) continue;
      if (excludesLower &&  name.includes(excludesLower)) continue;
      results.push({
        id:          c.campaign_id   ?? '',
        name:        c.campaign_name ?? '',
        spend:       parseFloat(c.spend       ?? '0'),
        impressions: parseInt(c.impressions   ?? '0', 10),
        clicks:      parseInt(c.clicks        ?? '0', 10),
        ctr:         parseFloat(c.ctr         ?? '0'),
        cpm:         parseFloat(c.cpm         ?? '0'),
        reach:       parseInt(c.reach         ?? '0', 10),
        frequency:   parseFloat(c.frequency   ?? '0'),
      });
    }

    const rawNext = json.paging?.next ?? null;
    if (rawNext) {
      const u = new URL(rawNext);
      if (!u.searchParams.get('access_token')) u.searchParams.set('access_token', ACCESS_TOKEN);
      nextUrl = u.toString();
    } else {
      nextUrl = null;
    }
  }

  return results.sort((a, b) => b.spend - a.spend);
}
