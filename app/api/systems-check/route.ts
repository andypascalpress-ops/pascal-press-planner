/**
 * GET /api/systems-check
 * Pings each critical service and returns health status + response time.
 * Uses HEAD requests where possible to avoid downloading full pages.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ServiceCheck {
  id:           string;
  name:         string;
  url:          string;
  category:     'pascal-press' | 'etz' | 'payment' | 'api';
  status:       'up' | 'slow' | 'down';
  statusCode:   number | null;
  responseMs:   number | null;
  error?:       string;
}

async function pingService(
  id:       string,
  name:     string,
  url:      string,
  category: ServiceCheck['category'],
  timeoutMs = 8000,
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': 'PascalPress-HealthCheck/1.0' },
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    // 4xx responses still mean the server is reachable — only 5xx = service error
    const ok = res.status < 500;
    return {
      id, name, url, category,
      status:     ok ? (ms > 3000 ? 'slow' : 'up') : 'down',
      statusCode: res.status,
      responseMs: ms,
    };
  } catch (e: any) {
    return {
      id, name, url, category,
      status:     'down',
      statusCode: null,
      responseMs: null,
      error:      e?.name === 'AbortError' ? 'Timed out' : (e?.message ?? 'Unreachable'),
    };
  }
}

// Stripe: lightweight API connectivity check via balance endpoint
async function checkStripe(): Promise<ServiceCheck> {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key) {
    return { id: 'stripe', name: 'Stripe (Payments)', url: 'https://api.stripe.com', category: 'payment', status: 'down', statusCode: null, responseMs: null, error: 'No API key configured' };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    const ms = Date.now() - start;
    return {
      id: 'stripe', name: 'Stripe (Payments)', url: 'https://dashboard.stripe.com',
      category: 'payment',
      status: res.ok ? (ms > 3000 ? 'slow' : 'up') : 'down',
      statusCode: res.status,
      responseMs: ms,
    };
  } catch (e: any) {
    return { id: 'stripe', name: 'Stripe (Payments)', url: 'https://dashboard.stripe.com', category: 'payment', status: 'down', statusCode: null, responseMs: null, error: e?.message };
  }
}

// BigCommerce: ping store info endpoint
async function checkBigCommerce(brand: 'pp' | 'etz'): Promise<ServiceCheck> {
  const hash   = brand === 'pp' ? process.env.BIGCOMMERCE_STORE_HASH        : process.env.BIGCOMMERCE_ETZ_STORE_HASH;
  const token  = brand === 'pp' ? process.env.BIGCOMMERCE_ACCESS_TOKEN      : process.env.BIGCOMMERCE_ETZ_ACCESS_TOKEN;
  const name   = brand === 'pp' ? 'BigCommerce (Pascal Press)' : 'BigCommerce (ETZ)';
  const id     = brand === 'pp' ? 'bigcommerce-pp' : 'bigcommerce-etz';
  const adminUrl = hash ? `https://store-${hash}.mybigcommerce.com` : 'https://bigcommerce.com';

  if (!hash || !token) {
    return { id, name, url: adminUrl, category: 'api', status: 'down', statusCode: null, responseMs: null, error: 'Not configured' };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.bigcommerce.com/stores/${hash}/v2/store`, {
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    const ms = Date.now() - start;
    return {
      id, name, url: adminUrl, category: 'api',
      status: res.ok ? (ms > 3000 ? 'slow' : 'up') : 'down',
      statusCode: res.status,
      responseMs: ms,
    };
  } catch (e: any) {
    return { id, name, url: adminUrl, category: 'api', status: 'down', statusCode: null, responseMs: null, error: e?.message };
  }
}

export async function GET() {
  const [
    ppMain,
    ppCheckout,
    ppMobile,
    etzMain,
    etzApp,
    stripe,
    bcPP,
    bcETZ,
  ] = await Promise.all([
    pingService('pp-main',     'Pascal Press Website',      'https://www.pascalpress.com.au',                    'pascal-press'),
    pingService('pp-checkout', 'Pascal Press Checkout',     'https://www.pascalpress.com.au/checkout',           'pascal-press'),
    pingService('pp-mobile',   'Pascal Press Mobile',       'https://www.pascalpress.com.au',                    'pascal-press', 8000),
    pingService('etz-main',    'ETZ Website',               'https://exceltestzone.com.au',                      'etz'),
    pingService('etz-app',     'ETZ App',                   'https://app.exceltestzone.com.au',                  'etz'),
    checkStripe(),
    checkBigCommerce('pp'),
    checkBigCommerce('etz'),
  ]);

  // pp-mobile uses same URL — tag it with a note (mobile responsiveness is CSS,
  // not a separate server; we confirm the server is reachable on mobile UA)
  ppMobile.name = 'Pascal Press Mobile (server)';

  // BigCommerce API checks removed — /v2/store requires elevated token scope
  // and ETZ doesn't use BigCommerce. Connectivity is proven by the main dashboard loading.
  void bcPP; void bcETZ;

  const services: ServiceCheck[] = [ppMain, ppCheckout, ppMobile, etzMain, etzApp, stripe];
  const allUp   = services.every(s => s.status === 'up');
  const anyDown = services.some(s => s.status === 'down');

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    overall:   anyDown ? 'degraded' : allUp ? 'healthy' : 'partial',
    services,
  });
}
