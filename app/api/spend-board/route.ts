import { NextResponse } from 'next/server';
import { getSpendBoardId, createSpendBoard, addSpendColumnsToBoard, findSpendBoardsAnyState } from '@/lib/monday-spend';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const boardId = await getSpendBoardId();
    const anyState = boardId ? undefined : await findSpendBoardsAnyState().catch(e => String(e));
    return NextResponse.json({ exists: !!boardId, boardId, anyState }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const boardId = await createSpendBoard();
    await addSpendColumnsToBoard(boardId);
    return NextResponse.json({ success: true, boardId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
