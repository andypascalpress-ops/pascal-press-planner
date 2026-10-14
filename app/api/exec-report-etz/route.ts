/**
 * GET /api/exec-report-etz
 *
 * Excel Test Zone executive summary PDF for the CEO, built from live Stripe, HubSpot, Google Analytics and ad data.
 * Same access rule as /api/exec-report: header  Authorization: Bearer <REPORT_TOKEN>  (see lib/report-auth.ts).
 * Add ?format=json to get the underlying numbers instead of the PDF.
 */
import { NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';
import { gatherEtzReportData } from '@/lib/etz-report-data';
import { renderEtzReport } from '@/lib/etz-report-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const refused = checkReportToken(request);
  if (refused) return refused;

  try {
    const data = await gatherEtzReportData();
    if (new URL(request.url).searchParams.get('format') === 'json') {
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }
    const pdf = await renderEtzReport(data);
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ETZ-executive-summary-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[exec-report-etz]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to build the report' }, { status: 502 });
  }
}
