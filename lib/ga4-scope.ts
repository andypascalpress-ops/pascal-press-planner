/**
 * The ETZ GA4 property also receives hits from staging and test hosts
 * (staging-app., staging.dev., testing.dev., localhost, raw IPs, the Webflow
 * staging domain). Staging checkouts run Stripe test payments that GA4 records
 * as real purchases, which inflated ETZ GA4 revenue and orders from Aug 2026
 * (~40% in Sep 2026). Every ETZ GA4 report is limited to production hostnames.
 */
const hostContains = (value: string) => ({
  filter: { fieldName: 'hostname', stringFilter: { matchType: 'CONTAINS', value } },
});

const ETZ_PROD_HOSTS = {
  andGroup: {
    expressions: [
      hostContains('exceltestzone.com.au'),
      { notExpression: hostContains('staging') },
      { notExpression: hostContains('testing') },
    ],
  },
};

export function scopeEtzProdHosts<T extends object>(body: T): T & { dimensionFilter: unknown } {
  const existing = (body as { dimensionFilter?: unknown }).dimensionFilter;
  return {
    ...body,
    dimensionFilter: existing ? { andGroup: { expressions: [existing, ETZ_PROD_HOSTS] } } : ETZ_PROD_HOSTS,
  };
}
