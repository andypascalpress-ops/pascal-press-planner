import { NextResponse } from 'next/server';
import { createBoard, addColumnsToBoard, getBoardId } from '@/lib/monday';

export async function POST() {
  try {
    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json(
        { error: 'MONDAY_API_TOKEN environment variable is not set.' },
        { status: 500 }
      );
    }

    const { boardId } = await createBoard();
    await addColumnsToBoard(boardId);

    return NextResponse.json({
      success: true,
      boardId,
      message: `Board "${boardId}" is ready. Add MONDAY_BOARD_ID=${boardId} to your Vercel environment variables for best performance (optional — the app discovers it automatically otherwise).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (!process.env.MONDAY_API_TOKEN) {
      return NextResponse.json(
        { error: 'MONDAY_API_TOKEN environment variable is not set.' },
        { status: 500 }
      );
    }
    const boardId = await getBoardId();
    return NextResponse.json({ boardId, status: 'Board found and ready.' });
  } catch {
    return NextResponse.json(
      { error: 'Board not found. POST to this endpoint to create it.' },
      { status: 404 }
    );
  }
}
