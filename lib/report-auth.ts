import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Shared bearer-token gate for the emailed report endpoints. REPORT_TOKEN is an environment variable in Vercel.
 * If it is not set (or too short) the endpoints refuse every request, so they are never open by accident.
 * Returns a NextResponse to send back when the request is refused, or null when it is allowed.
 */
export function checkReportToken(request: Request): NextResponse | null {
  // Tolerate whitespace or wrapping quotes pasted into the Vercel value.
  const token = (process.env.REPORT_TOKEN ?? '').trim().replace(/^["']|["']$/g, '');
  if (token.length < 24) {
    return NextResponse.json({ error: 'Report endpoint is not configured (REPORT_TOKEN missing or too short).' }, { status: 503 });
  }
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(supplied), b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  return null;
}
