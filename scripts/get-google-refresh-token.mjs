/**
 * Helper script to generate a Google OAuth2 refresh token
 * for use as GOOGLE_ADS_REFRESH_TOKEN in Vercel.
 *
 * ─── WHY TOKENS EXPIRE EVERY 7 DAYS ───────────────────────────────────────────
 * Google only grants long-lived refresh tokens to *published* OAuth apps.
 * While your app is in "Testing" mode (the default), tokens expire after 7 days.
 *
 * PERMANENT FIX — do this once in Google Cloud Console:
 *   1. Go to: APIs & Services → OAuth consent screen
 *   2. Click "Publish App" (changes status from Testing → In production)
 *   3. Confirm. No Google review required for internal/ads scopes.
 *   4. Then run this script once more to get a fresh, permanent refresh token.
 *   5. Update GOOGLE_ADS_REFRESH_TOKEN in Vercel → Settings → Environment Variables.
 *
 * After publishing, refresh tokens never expire unless the user revokes access.
 *
 * ─── QUICK FIX (if the app is still in Testing) ───────────────────────────────
 * Run this script to get a new token. It lasts another 7 days.
 *
 * Prerequisites:
 *   1. A Google Cloud project with the Google Ads API enabled
 *   2. An OAuth2 "Desktop app" credential (Client ID + Secret)
 *   3. Node.js 18+
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=your-id GOOGLE_CLIENT_SECRET=your-secret node scripts/get-google-refresh-token.mjs
 *
 * Then copy the printed refresh_token into Vercel as GOOGLE_ADS_REFRESH_TOKEN and redeploy.
 */

import http from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:8080/oauth2callback';
const SCOPES        = 'https://www.googleapis.com/auth/adwords';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars before running.');
  process.exit(1);
}

// Step 1: Print the authorisation URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id',     CLIENT_ID);
authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope',         SCOPES);
authUrl.searchParams.set('access_type',   'offline');
authUrl.searchParams.set('prompt',        'consent'); // forces refresh_token to be returned

console.log('\n─── Google Ads OAuth2 Refresh Token Generator ───\n');
console.log('1. Open this URL in your browser (use the Google account that owns the Ads account):');
console.log('\n' + authUrl.toString() + '\n');
console.log('2. Approve access, then wait for the redirect…\n');

// Step 2: Local callback server to capture the code
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

  // Step 3: Exchange code for tokens
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
  console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('(Access token for reference — not needed in Vercel):');
  console.log(tokens.access_token?.slice(0, 20) + '…');
});

server.listen(8080, () => {
  console.log('Waiting for OAuth callback on http://localhost:8080 …\n');
});
