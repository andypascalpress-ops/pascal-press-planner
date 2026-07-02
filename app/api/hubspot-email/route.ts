import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailCampaigns }       from '@/lib/hubspot-email';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? undefined;

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: 'month param must be in YYYY-MM format' },
      { status: 400 },
    );
  }

  const data = await fetchEmailCampaigns(month);
  return NextResponse.json({ month: month ?? null, ...data });
}
