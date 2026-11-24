/**
 * GET /api/etz-exec-report[?asOf=YYYY-MM-DD][&format=html]
 *
 * The 10-page Excel Test Zone executive summary as a PDF (default) or as the HTML it is printed from.
 * Access: the planner login cookie, or header  Authorization: Bearer <REPORT_TOKEN>  (for Power Automate).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';
import { buildEtzExecData } from '@/lib/etz-exec-data';
import { renderEtzExecHtml } from '@/lib/etz-exec-html';
import { buildConfig, fetchMonthlySpend } from '@/lib/google-ads';
import { fetchEtzMetaSpend } from '@/lib/meta-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function etzAdSpend(month: string, start: string, end: string): Promise<{ google: number; meta: number }> {
  let google = 0;
  try {
    if (month >= '2026-07') google = (await fetchMonthlySpend(buildConfig('etz'), start, end)).reduce((s, r) => s + r.actualSpend, 0);
    else google = (await fetchMonthlySpend(buildConfig('pp'), start, end, { contains: 'ETZ' })).reduce((s, r) => s + r.actualSpend, 0);
  } catch { google = 0; }
  const meta = await fetchEtzMetaSpend(start, end).catch(() => 0);
  return { google, meta };
}

async function htmlToPdf(html: string): Promise<Uint8Array> {
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

export async function GET(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  const signedIn = !!sitePassword && req.cookies.get('pp_auth')?.value === sitePassword;
  if (!signedIn) {
    const refused = checkReportToken(req);
    if (refused) return refused;
  }
  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 });
  try {
    const data = await buildEtzExecData(asOf, etzAdSpend);
    const html = renderEtzExecHtml(data);
    if (req.nextUrl.searchParams.get('format') === 'html') {
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
    }
    const pdf = await htmlToPdf(html);
    const d = new Date(`${data.preparedOn}T12:00:00Z`);
    const name = `ETZ Executive Summary ${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
