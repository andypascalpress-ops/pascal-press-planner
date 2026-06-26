import { NextResponse } from 'next/server';
import { getSpendBoardId, createSpendBoard, addSpendColumnsToBoard } from '@/lib/monday-spend';

export async function GET() {
  try {
    const boardId = await getSpendBoardId();
    return NextResponse.json({ exists: !!boardId, boardId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const { boardId } = await createSpendBoard();
    await addSpendColumnsToBoard(boardId);
    return NextResponse.json({ success: true, boardId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
