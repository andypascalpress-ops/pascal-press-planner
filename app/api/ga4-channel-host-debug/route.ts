import { NextResponse } from 'next/server';
import { etzChannelByHostDiag } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const rows = await etzChannelByHostDiag(sp.get('start') ?? '2026-10-01', sp.get('end') ?? '2026-10-07');
  return NextResponse.json({ rows });
}
