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
 */

const META_GRAPH_API  = 'https://graph.facebook.com/v20.0';
const ACCESS_TOKEN    = process.env.META_ADS_ACCESS_TOKEN   ?? '';

export const META_PP_ACCOUNT_ID  = process.env.META_PP_AD_ACCOUNT_ID  ?? '';
export const META_ETZ_ACCOUNT_ID = process.env.META_ETZ_AD_ACCOUNT_ID ?? '';

/**
 * Returns total ad spend (AUD) for an account over a date range.
 * Returns 0 (not an error) when no credentials are configured.
 * Throws on API errors so the caller can surface them as adsError.
 */
export async function fetchMetaSpend(
  adAccountId: string, // include "act_" prefix, e.g. "act_123456789"
  startDate:   string, // "YYYY-MM-DD"
  endDate:     string, // "YYYY-MM-DD"
): Promise<number> {
  if (!ACCESS_TOKEN || !adAccountId) return 0;

  const params = new URLSearchParams({
    fields:       'spend',
    time_range:   JSON.stringify({ since: startDate, until: endDate }),
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
  // data array is empty when there are no impressions for the range
  const spend = (json as any).data?.[0]?.spend;
  return spend ? Math.round(parseFloat(spend) * 100) / 100 : 0;
}
