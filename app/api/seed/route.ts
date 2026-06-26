import { NextRequest, NextResponse } from 'next/server';
import { getBoardId, getColumnMap, bulkCreateCampaigns } from '@/lib/monday';
import { Campaign } from '@/lib/types';

// POST /api/seed — bulk-create campaigns from JSON array
// Body: { campaigns: Campaign[], secret: string }
// Protect with a one-time secret to prevent accidental re-seeding
export async function POST(req: NextRequest) {
  try {
    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json({ error: 'MONDAY_API_TOKEN not set.' }, { status: 500 });
    }

    const body = await req.json() as {
      campaigns: Omit<Campaign, 'id'>[];
      secret?: string;
    };

    if (!body.campaigns || !Array.isArray(body.campaigns)) {
      return NextResponse.json({ error: 'Body must contain a campaigns array.' }, { status: 400 });
    }

    // Optional: protect with SEED_SECRET env var
    if (process.env.SEED_SECRET && body.secret !== process.env.SEED_SECRET) {
      return NextResponse.json({ error: 'Invalid seed secret.' }, { status: 403 });
    }

    const boardId = await getBoardId();
    const colMap = await getColumnMap(boardId);
    const count = await bulkCreateCampaigns(body.campaigns, boardId, colMap);

    return NextResponse.json({ success: true, created: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
