import { NextRequest, NextResponse } from 'next/server';
import { getSpendRecords, createSpendRecord } from '@/lib/monday-spend';

export async function GET() {
  try {
    const records = await getSpendRecords();
    return NextResponse.json(records);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const record = await createSpendRecord(body);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
