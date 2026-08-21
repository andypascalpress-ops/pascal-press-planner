/**
 * GET /api/speed-check
 *
 * Runs Google PageSpeed Insights (Lighthouse) for PP and ETZ on mobile + desktop.
 * Results are cached on Vercel's edge for 4 hours — the analysis takes 15–30 s per URL
 * so we never block the UI on repeat visits.
 *
 * Optional env var: PAGESPEED_API_KEY — a Google Cloud API key with
 * "PageSpeed Insights API" enabled. Without it the endpoint still works but
 * is rate-limited to ~a few requests per 100 seconds per IP.
 */

import { NextResponse } from 'next/server';

export const dynamic  = 'force-dynamic'; // required for Next 14 revalidate
export const revalidate = 14400;         // Vercel ISR: revalidate every 4 hours

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const API_KEY  = process.env.PAGESPEED_API_KEY ?? '';

interface CoreWebVitals {
  lcp:  number | null;   // Largest Contentful Paint, seconds
  cls:  number | null;   // Cumulative Layout Shift, unitless
  inp:  number | null;   // Interaction to Next Paint, ms
  fcp:  number | null;   // First Contentful Paint, seconds
  ttfb: number | null;   // Time to First Byte, seconds
}

interface SpeedResult {
  url:       string;
  strategy:  'mobile' | 'desktop';
  score:     number | null;     // 0–100
  grade:     'good' | 'needs-improvement' | 'poor' | 'error';
  vitals:    CoreWebVitals;
  fetchedAt: string;
  error?:    string;
}

function grade(score: number | null): SpeedResult['grade'] {
  if (score === null) return 'error';
  if (score >= 90)   return 'good';
  if (score >= 50)   return 'needs-improvement';
  return 'poor';
}

function metricValue(audit: any): number | null {
  const v = audit?.numericValue;
  return typeof v === 'number' ? Math.round(v * 100) / 100 : null;
}

async function runPSI(url: string, strategy: 'mobile' | 'desktop'): Promise<SpeedResult> {
  const params = new URLSearchParams({ url, strategy });
  if (API_KEY) params.set('key', API_KEY);
  // Request only the performance category to reduce response size
  params.set('category', 'performance');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000); // 55 s timeout
    const res = await fetch(`${PSI_BASE}?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        url, strategy, score: null, grade: 'error',
        vitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
        fetchedAt: new Date().toISOString(),
        error: (() => {
          const msg: string = (err as any)?.error?.message ?? `HTTP ${res.status}`;
          if (msg.includes('Quota') || msg.includes('quota')) return 'API quota exceeded — add PAGESPEED_API_KEY to Vercel env vars';
          return msg;
        })(),
      };
    }

    const data = await res.json();
    const cats   = data?.lighthouseResult?.categories;
    const audits = data?.lighthouseResult?.audits ?? {};

    const score = typeof cats?.performance?.score === 'number'
      ? Math.round(cats.performance.score * 100)
      : null;

    const vitals: CoreWebVitals = {
      lcp:  metricValue(audits['largest-contentful-paint']),
      cls:  metricValue(audits['cumulative-layout-shift']),
      inp:  metricValue(audits['interaction-to-next-paint'] ?? audits['total-blocking-time']),
      fcp:  metricValue(audits['first-contentful-paint']),
      ttfb: metricValue(audits['server-response-time']),
    };

    // Convert LCP, FCP, TTFB from ms → seconds for display
    if (vitals.lcp  !== null) vitals.lcp  = Math.round(vitals.lcp  / 10) / 100;
    if (vitals.fcp  !== null) vitals.fcp  = Math.round(vitals.fcp  / 10) / 100;
    if (vitals.ttfb !== null) vitals.ttfb = Math.round(vitals.ttfb / 10) / 100;
    // CLS stays unitless; INP stays in ms

    return { url, strategy, score, grade: grade(score), vitals, fetchedAt: new Date().toISOString() };
  } catch (e: any) {
    return {
      url, strategy, score: null, grade: 'error',
      vitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      fetchedAt: new Date().toISOString(),
      error: e?.name === 'AbortError' ? 'Timed out (>55s)' : (e?.message ?? 'Failed'),
    };
  }
}

export async function GET() {
  // Run all 4 checks in parallel
  const [ppMobile, ppDesktop, etzMobile, etzDesktop] = await Promise.all([
    runPSI('https://www.pascalpress.com.au', 'mobile'),
    runPSI('https://www.pascalpress.com.au', 'desktop'),
    runPSI('https://exceltestzone.com.au',   'mobile'),
    runPSI('https://exceltestzone.com.au',   'desktop'),
  ]);

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    pp:  { mobile: ppMobile,  desktop: ppDesktop  },
    etz: { mobile: etzMobile, desktop: etzDesktop },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600' },
  });
}
