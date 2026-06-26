import { NextRequest, NextResponse } from 'next/server';
import { getSpendBoardIdOrThrow, getSpendColumnMap, bulkCreateSpendRecords } from '@/lib/monday-spend';
import { SpendRecord } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { records }: { records: Omit<SpendRecord, 'id'>[] } = await req.json();
    if (!records?.length) return NextResponse.json({ error: 'No records provided' }, { status: 400 });

    const boardId = await getSpendBoardIdOrThrow();
    const cm = await getSpendColumnMap(boardId);
    const created = await bulkCreateSpendRecords(records, boardId, cm);

    return NextResponse.json({ success: true, created });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
