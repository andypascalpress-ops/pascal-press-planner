import { SpendRecord, SpendColumnMap } from './types';
import { SPEND_BOARD_NAME, SPEND_COLUMNS_TO_CREATE } from './constants';

const MONDAY_API_URL = 'https://api.monday.com/v2';

let cachedBoardId: string | null = null;
let cachedColumnMap: SpendColumnMap | null = null;

async function mondayRequest(query: string, variables?: Record<string, unknown>) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error('MONDAY_API_TOKEN is not set');
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export async function getSpendBoardId(): Promise<string | null> {
  if (process.env.MONDAY_SPEND_BOARD_ID) return process.env.MONDAY_SPEND_BOARD_ID;
  if (cachedBoardId) return cachedBoardId;
  const data = await mondayRequest(`query { boards(limit: 100) { id name } }`);
  const board = data.boards.find((b: { id: string; name: string }) => b.name === SPEND_BOARD_NAME);
  if (!board) return null;
  cachedBoardId = board.id;
  return board.id;
}

export async function getSpendBoardIdOrThrow(): Promise<string> {
  const id = await getSpendBoardId();
  if (!id) throw new Error(`Board "${SPEND_BOARD_NAME}" not found. Run POST /api/spend-board first.`);
  return id;
}

export async function getSpendColumnMap(boardId: string): Promise<SpendColumnMap> {
  if (cachedColumnMap) return cachedColumnMap;
  const data = await mondayRequest(`
    query($boardId:[ID!]) { boards(ids:$boardId) { columns { id title } } }
  `, { boardId: [boardId] });
  const cols: { id: string; title: string }[] = data.boards[0].columns;
  const find = (title: string) => {
    const col = cols.find(c => c.title === title);
    if (!col) throw new Error(`Column "${title}" not found. Re-run POST /api/spend-board.`);
    return col.id;
  };
  const map: SpendColumnMap = {
    brand:               find('Brand'),
    channel:             find('Channel'),
    month:               find('Month'),
    fy:                  find('FY'),
    budget:              find('Budget'),
    actualSpend:         find('Actual Spend'),
    attributedRevenue:   find('Attributed Revenue'),
    indirectRevenue:     find('Indirect Revenue'),
    notes:               find('Notes'),
  };
  cachedColumnMap = map;
  return map;
}

function parseNum(text: string | null | undefined): number {
  if (!text) return 0;
  const n = parseFloat(text.replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function colVal(cols: { id: string; text: string }[], id: string): string {
  return cols.find(c => c.id === id)?.text ?? '';
}

function itemToRecord(
  item: { id: string; name: string; column_values: { id: string; text: string }[] },
  cm: SpendColumnMap
): SpendRecord {
  const cv = item.column_values;
  return {
    id:                 item.id,
    brand:              colVal(cv, cm.brand),
    channel:            colVal(cv, cm.channel),
    month:              colVal(cv, cm.month),
    fy:                 colVal(cv, cm.fy),
    budget:             parseNum(colVal(cv, cm.budget)),
    actualSpend:        parseNum(colVal(cv, cm.actualSpend)),
    attributedRevenue:  parseNum(colVal(cv, cm.attributedRevenue)),
    indirectRevenue:    parseNum(colVal(cv, cm.indirectRevenue)),
    notes:              colVal(cv, cm.notes),
  };
}

function buildColValues(
  r: Partial<Omit<SpendRecord, 'id'>>,
  cm: SpendColumnMap
): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (r.brand              !== undefined) cols[cm.brand]              = r.brand;
  if (r.channel            !== undefined) cols[cm.channel]            = r.channel;
  if (r.month              !== undefined) cols[cm.month]              = r.month;
  if (r.fy                 !== undefined) cols[cm.fy]                 = r.fy;
  if (r.budget             !== undefined) cols[cm.budget]             = String(r.budget);
  if (r.actualSpend        !== undefined) cols[cm.actualSpend]        = String(r.actualSpend);
  if (r.attributedRevenue  !== undefined) cols[cm.attributedRevenue]  = String(r.attributedRevenue);
  if (r.indirectRevenue    !== undefined) cols[cm.indirectRevenue]    = String(r.indirectRevenue);
  if (r.notes              !== undefined) cols[cm.notes]              = { text: r.notes };
  return cols;
}

function recordName(r: Partial<Omit<SpendRecord, 'id'>>): string {
  return [r.brand, r.channel, r.month, r.fy].filter(Boolean).join(' · ');
}

export async function getSpendRecords(): Promise<SpendRecord[]> {
  const boardId = await getSpendBoardIdOrThrow();
  const cm = await getSpendColumnMap(boardId);
  let records: SpendRecord[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor
      ? `query($boardId:[ID!],$cursor:String!){boards(ids:$boardId){items_page(limit:200,cursor:$cursor){cursor items{id name column_values{id text}}}}}`
      : `query($boardId:[ID!]){boards(ids:$boardId){items_page(limit:200){cursor items{id name column_values{id text}}}}}`;
    const variables = cursor ? { boardId: [boardId], cursor } : { boardId: [boardId] };
    const data = await mondayRequest(query, variables);
    const page = data.boards[0].items_page;
    records = records.concat(
      page.items.map((item: { id: string; name: string; column_values: { id: string; text: string }[] }) =>
        itemToRecord(item, cm)
      )
    );
    cursor = page.cursor ?? null;
  } while (cursor);
  return records;
}

export async function createSpendRecord(record: Omit<SpendRecord, 'id'>): Promise<SpendRecord> {
  const boardId = await getSpendBoardIdOrThrow();
  const cm = await getSpendColumnMap(boardId);
  const colValues = buildColValues(record, cm);
  const data = await mondayRequest(`
    mutation($boardId:ID!,$name:String!,$cols:JSON!) {
      create_item(board_id:$boardId,item_name:$name,column_values:$cols) {
        id name column_values { id text }
      }
    }
  `, { boardId, name: recordName(record), cols: JSON.stringify(colValues) });
  return itemToRecord(data.create_item, cm);
}

export async function updateSpendRecord(id: string, record: Partial<SpendRecord>): Promise<SpendRecord> {
  const boardId = await getSpendBoardIdOrThrow();
  const cm = await getSpendColumnMap(boardId);
  const { id: _id, ...rest } = record as SpendRecord;
  const colValues = buildColValues(rest, cm);
  const data = await mondayRequest(`
    mutation($boardId:ID!,$itemId:ID!,$cols:JSON!) {
      change_multiple_column_values(board_id:$boardId,item_id:$itemId,column_values:$cols) {
        id name column_values { id text }
      }
    }
  `, { boardId, itemId: id, cols: JSON.stringify(colValues) });
  return itemToRecord(data.change_multiple_column_values, cm);
}

export async function deleteSpendRecord(id: string): Promise<void> {
  await mondayRequest(`
    mutation($itemId:ID!) { delete_item(item_id:$itemId) { id } }
  `, { itemId: id });
}

export async function createSpendBoard(): Promise<string> {
  const data = await mondayRequest(`query { boards(limit:100) { id name } }`);
  const existing = data.boards.find((b: { id: string; name: string }) => b.name === SPEND_BOARD_NAME);
  if (existing) return existing.id;
  const created = await mondayRequest(`
    mutation($name:String!) { create_board(board_name:$name,board_kind:public) { id } }
  `, { name: SPEND_BOARD_NAME });
  cachedBoardId = created.create_board.id;
  return created.create_board.id;
}

export async function addSpendColumnsToBoard(boardId: string): Promise<void> {
  const data = await mondayRequest(`
    query($boardId:[ID!]) { boards(ids:$boardId) { columns { title } } }
  `, { boardId: [boardId] });
  const existingTitles: string[] = data.boards[0].columns.map((c: { title: string }) => c.title);
  for (const col of SPEND_COLUMNS_TO_CREATE) {
    if (existingTitles.includes(col.title)) continue;
    await mondayRequest(`
      mutation($boardId:ID!,$title:String!,$type:ColumnType!) {
        create_column(board_id:$boardId,title:$title,column_type:$type) { id }
      }
    `, { boardId, title: col.title, type: col.type });
  }
  cachedColumnMap = null;
}

export async function bulkCreateSpendRecords(
  records: Omit<SpendRecord, 'id'>[],
  boardId: string,
  cm: SpendColumnMap
): Promise<number> {
  let created = 0;
  for (const r of records) {
    const colValues = buildColValues(r, cm);
    await mondayRequest(`
      mutation($boardId:ID!,$name:String!,$cols:JSON!) {
        create_item(board_id:$boardId,item_name:$name,column_values:$cols) { id }
      }
    `, { boardId, name: recordName(r), cols: JSON.stringify(colValues) });
    created++;
  }
  return created;
}
