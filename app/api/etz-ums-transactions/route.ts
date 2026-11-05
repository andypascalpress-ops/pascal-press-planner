/**
 * GET /api/etz-ums-transactions?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Aggregate counts from the UMS transaction report (same data as the UMS transactions export):
 * rows by purchase type, free trial rows and families, trials per day, and the response field names.
 * No names, emails or per-customer rows are returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchUmsTransactionSummary } from '@/lib/ums-transactions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start') ?? '';
  const end = req.nextUrl.searchParams.get('end') ?? '';
  if (!ymd.test(start) || !ymd.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end required (YYYY-MM-DD)' }, { status: 400 });
  }
  try {
    return NextResponse.json({ period: { start, end }, ...(await fetchUmsTransactionSummary(start, end)) });
  } catch (err) {
    return NextResponse.json({ period: { start, end }, error: String((err as Error).message ?? err).slice(0, 300) }, { status: 502 });
  }
}
