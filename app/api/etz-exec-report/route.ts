/**
 * GET /api/etz-exec-report[?asOf=YYYY-MM-DD][&format=html]
 *
 * The 10-page Excel Test Zone executive summary as a PDF (default) or as the HTML it is printed from.
 * Access: the planner login cookie, or header  Authorization: Bearer <REPORT_TOKEN>  (for Power Automate).
 */
import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { checkReportToken } from '@/lib/report-auth';
import { buildEtzExecData } from '@/lib/etz-exec-data';
import { renderEtzExecHtml } from '@/lib/etz-exec-html';
import { buildConfig, fetchMonthlySpend } from '@/lib/google-ads';
import { fetchEtzMetaSpend } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function etzAdSpendLive(month: string, start: string, end: string): Promise<{ google: number; meta: number }> {
  let google = 0;
  try {
    if (month >= '2026-07') google = (await fetchMonthlySpend(buildConfig('etz'), start, end)).reduce((s, r) => s + r.actualSpend, 0);
    else google = (await fetchMonthlySpend(buildConfig('pp'), start, end, { contains: 'ETZ' })).reduce((s, r) => s + r.actualSpend, 0);
  } catch { google = 0; }
  const meta = await fetchEtzMetaSpend(start, end).catch(() => 0);
  return { google, meta };
}

// finished months do not change: keep their spend for a day so each run only asks the ad platforms about the current month
const etzAdSpendCached = unstable_cache(async (month: string, start: string, end: string) => etzAdSpendLive(month, start, end), ['etz-exec-ad-spend-v1'], { revalidate: 86_400 });
async function etzAdSpend(month: string, start: string, end: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  return end < today.slice(0, 8) + '01' ? etzAdSpendCached(month, start, end) : etzAdSpendLive(month, start, end);
}

async function htmlToPdf(html: string): Promise<Uint8Array> {
  // Vercel runs on Amazon Linux 2023 but does not set the Lambda variable the Chromium package looks for; without it the
  // package skips unpacking Chrome's system libraries (libnss3 and friends) and Chrome cannot start.
  if (!process.env.AWS_LAMBDA_JS_RUNTIME && !process.env.AWS_EXECUTION_ENV) process.env.AWS_LAMBDA_JS_RUNTIME = `nodejs${process.versions.node.split('.')[0] === '20' ? '20' : '22'}.x`;
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1123, height: 794 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
    return await page.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

/** The three headline lines for the email body: month-to-date revenue, last 12 months, families trialling. */
function summaryLines(data: Awaited<ReturnType<typeof buildEtzExecData>>): string[] {
  const aud = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / b) * 100))}%` : 'n/a');
  const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const yr = (ymd: string) => ymd.slice(0, 4);
  const [ms, me] = data.periods.mtd, [r1, r2] = data.periods.r12;
  const m = data.mtd, l = data.mtdLy;
  return [
    `Revenue month to date (${day(ms)} – ${day(me)}): ${aud(m.total)} vs ${aud(l.total)} same dates last year (${pct(m.total, l.total)}). Online ${aud(m.online)} vs ${aud(l.online)} (${pct(m.online, l.online)}).`,
    `Sales, last 12 months (${day(r1)} ${yr(r1)} – ${day(r2)} ${yr(r2)}): ${aud(data.r12.total)} vs ${aud(data.p12.total)} the 12 months before (${pct(data.r12.total, data.p12.total)}).`,
    `Families trialling month to date: ${m.trialCustomers.toLocaleString('en-AU')} vs ${l.trialCustomers.toLocaleString('en-AU')} same dates last year (${pct(m.trialCustomers, l.trialCustomers)}).`,
  ];
}

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  const signedIn = !!sitePassword && req.cookies.get('pp_auth')?.value === sitePassword;
  if (!signedIn) {
    const refused = checkReportToken(req);
    if (refused) {
      // a person in a browser (no Authorization header): show a sign-in link rather than bare JSON
      if (!req.headers.get('authorization')) {
        return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in needed</title><body style="font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:grid;place-items:center;min-height:100vh"><div style="background:#fff;padding:32px;border-radius:14px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,.08)"><h1 style="font-size:18px;margin:0 0 8px">Sign in to the planner first</h1><p style="color:#475569;font-size:14px;line-height:1.5">This report needs the Marketing Planner sign-in in this browser (it lasts 24 hours).</p><ol style="color:#334155;font-size:14px;line-height:1.7;padding-left:18px"><li><a href="/" target="_blank" rel="noopener">Open the planner and sign in</a></li><li>Come back to this tab and reload it</li></ol></div></body>`, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return refused;
    }
  }
  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 });
  try {
    const data = await buildEtzExecData(asOf, etzAdSpend);
    const lines = summaryLines(data);
    if (req.nextUrl.searchParams.get('format') === 'summary') {
      const y = data.yesterday;
      return NextResponse.json({ preparedOn: data.preparedOn, asOf: data.asOf, yesterday: { trials: y.trialCustomers, payingCustomers: y.customers, online: y.online, schools: y.schools }, lines }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    // the same three lines ride along with the PDF so Power Automate can put them in the email body without a second run:
    // base64 of an HTML list (decode in the flow with base64ToString)
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const y = data.yesterday;
    const yDay = new Date(`${data.asOf}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const aud = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
    const yLines = [
      `Trials \u2013 ${y.trialCustomers.toLocaleString('en-AU')}`,
      `Paying customers \u2013 ${y.customers.toLocaleString('en-AU')}`,
      `Online revenue \u2013 ${aud(y.online)}`,
      `School revenue \u2013 ${aud(y.schools)}`,
    ];
    const summaryHtml = `<p><b>Yesterday's results (${esc(yDay)})</b></p><ul>${yLines.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
      + `<p><b>Headlines</b></p><ul>${lines.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    const summaryB64 = Buffer.from(summaryHtml, 'utf-8').toString('base64');
    const html = renderEtzExecHtml(data);
    if (req.nextUrl.searchParams.get('format') === 'html') {
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
    }
    const pdf = await htmlToPdf(html);
    const d = new Date(`${data.preparedOn}T12:00:00Z`);
    const name = `ETZ Executive Summary ${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Report-Summary': summaryB64, 'X-Report-Filename': name },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
