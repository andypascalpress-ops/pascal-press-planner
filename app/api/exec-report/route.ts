/**
 * GET /api/exec-report
 *
 * Executive summary PDF (Excel Test Zone free trials and orders; Excel HSC Copilot deals and subscriptions)
 * for the CEO, built from live Stripe and HubSpot data.
 *
 * Access: requires the header  Authorization: Bearer <REPORT_TOKEN>.  REPORT_TOKEN is an environment variable
 * in Vercel. If it is not set the endpoint refuses every request, so it is never open by accident.
 * Add ?format=json to get the underlying numbers instead of the PDF.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { gatherExecReportData } from '@/lib/exec-report-data';
import { renderExecReport } from '@/lib/exec-report-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(request: Request, token: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  // Tolerate whitespace or wrapping quotes pasted into the Vercel value.
  const token = (process.env.REPORT_TOKEN ?? '').trim().replace(/^["']|["']$/g, '');
  if (token.length < 24) {
    return NextResponse.json({ error: 'Report endpoint is not configured (REPORT_TOKEN missing or too short).' }, { status: 503 });
  }
  if (!authorised(request, token)) {
    // TEMPORARY diagnostic (lengths only, never the values): remove once the token is confirmed working.
    const header = request.headers.get('authorization') ?? '';
    return NextResponse.json({
      error: 'Unauthorised',
      hint: {
        headerReceived: header.length > 0,
        startsWithBearer: header.startsWith('Bearer '),
        receivedTokenLength: header.startsWith('Bearer ') ? header.slice(7).trim().length : 0,
        expectedTokenLength: token.length,
      },
    }, { status: 401 });
  }

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
