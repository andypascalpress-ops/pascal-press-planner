/** @type {import('next').NextConfig} */

// Read-only data routes the dashboard calls on every page load. Without a cache header each call runs the server code;
// with one, Vercel serves a saved copy for a while and the function only runs when that copy has expired.
// Not included: routes that can be edited through the dashboard (campaigns, spend, spend-board) and the chat routes.
const TEN_MINUTES = 'public, s-maxage=600, stale-while-revalidate=300';
const FIVE_MINUTES = 'public, s-maxage=300, stale-while-revalidate=300';
const cachedRoutes = [
  ['ga4-revenue', TEN_MINUTES], ['ga4-channel-revenue', TEN_MINUTES], ['ga-email-revenue', TEN_MINUTES],
  ['google-ads-campaigns', TEN_MINUTES], ['google-ads-history', TEN_MINUTES], ['google-ads-spend', TEN_MINUTES],
  ['revenue', TEN_MINUTES], ['website-conversion', TEN_MINUTES],
  ['hubspot-contacts-breakdown', TEN_MINUTES], ['hubspot-contacts-growth', TEN_MINUTES], ['hubspot-email', TEN_MINUTES],
  ['pp-contacts-segments', TEN_MINUTES], ['pp-marketing-contacts', TEN_MINUTES], ['pp-coupons', TEN_MINUTES],
  ['bc-performance', TEN_MINUTES], ['bc-product-yoy', TEN_MINUTES], ['bc-abandoned-carts', TEN_MINUTES],
  ['etz-app-traffic', TEN_MINUTES], ['etz-funnel-traffic', TEN_MINUTES], ['etz-monthly-update', TEN_MINUTES],
  ['daily-pulse', FIVE_MINUTES],
];

const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return cachedRoutes.map(([route, value]) => ({
      source: `/api/${route}`,
      headers: [{ key: 'Cache-Control', value }],
    }));
  },
};

module.exports = nextConfig;
