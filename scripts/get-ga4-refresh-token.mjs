/**
 * One-time helper script to generate a Google OAuth2 refresh token
 * with Google Analytics read-only scope.
 *
 * Uses the same OAuth2 Desktop app client as Google Ads.
 *
 * Prerequisites:
 *   1. The same Google Cloud project / OAuth2 Desktop client used for Google Ads
 *   2. Node.js 18+
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=your-id GOOGLE_CLIENT_SECRET=your-secret node scripts/get-ga4-refresh-token.mjs
 *
 * Then copy the printed refresh_token into Vercel as GOOGLE_ANALYTICS_REFRESH_TOKEN.
 * (Keep your existing GOOGLE_ADS_REFRESH_TOKEN — it is separate and still needed.)
 */

import http from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:8080/oauth2callback';
const SCOPES        = 'https://www.googleapis.com/auth/analytics.readonly';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars before running.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id',     CLIENT_ID);
authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope',         SCOPES);
authUrl.searchParams.set('access_type',   'offline');
authUrl.searchParams.set('prompt',        'consent'); // forces refresh_token to be returned

console.log('\n─── Google Analytics 4 OAuth2 Refresh Token Generator ───\n');
console.log('Property: 153293282 (Pascal Press)');
console.log('Scope:    analytics.readonly\n');
console.log('1. Open this URL in your browser.');
console.log('   Use the Google account that owns GA4 property 153293282:\n');
console.log(authUrl.toString());
console.log('\n2. Approve access, then wait for the redirect…\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8080');
  if (url.pathname !== '/oauth2callback') return;

  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code returned. Try again.');
    return;
  }

  res.end('<h2>Authorised! Check your terminal for the refresh token.</h2>');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.error) {
    console.error('Token exchange failed:', tokens.error_description ?? tokens.error);
    process.exit(1);
  }

  console.log('─── SUCCESS ───\n');
  console.log('Add this to Vercel environment variables:\n');
  console.log(`GOOGLE_ANALYTICS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('Keep your existing GOOGLE_ADS_REFRESH_TOKEN — it is a separate token.\n');
  console.log('(Access token for reference — not needed in Vercel):');
  console.log(tokens.access_token?.slice(0, 20) + '…');
});

server.listen(8080, () => {
  console.log('Waiting for OAuth callback on http://localhost:8080 …\n');
});
