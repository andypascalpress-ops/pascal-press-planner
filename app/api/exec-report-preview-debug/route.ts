import { NextResponse } from 'next/server';
import { gatherExecReportData } from '@/lib/exec-report-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// TEMPORARY, aggregate numbers only: remove after the report redesign is verified.
export async function GET() {
  try {
    return NextResponse.json(await gatherExecReportData(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 502 });
  }
}
