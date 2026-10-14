/**
 * GET /api/exec-report
 *
 * Excel HSC Copilot executive summary PDF for the CEO, built from live Stripe, HubSpot and Google Ads data.
 *
 * Access: requires the header  Authorization: Bearer <REPORT_TOKEN>.  REPORT_TOKEN is an environment variable
 * in Vercel. If it is not set the endpoint refuses every request, so it is never open by accident.
 * Add ?format=json to get the underlying numbers instead of the PDF.
 */
import { NextResponse } from 'next/server';
import { checkReportToken } from '@/lib/report-auth';
import { gatherExecReportData } from '@/lib/exec-report-data';
import { renderExecReport } from '@/lib/exec-report-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const refused = checkReportToken(request);
  if (refused) return refused;

  try {
    const data = await gatherExecReportData();
    if (new URL(request.url).searchParams.get('format') === 'json') {
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }
    const pdf = await renderExecReport(data);
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Executive-summary-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[exec-report]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to build the report' }, { status: 502 });
  }
}
