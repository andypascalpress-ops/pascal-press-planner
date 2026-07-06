import { Campaign, ColumnMap } from './types';
import { BOARD_NAME } from './constants';

const MONDAY_API_URL = 'https://api.monday.com/v2';

// Module-level cache (warm across requests in same serverless instance)
let cachedBoardId: string | null = null;
let cachedColumnMap: ColumnMap | null = null;

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

export async function getBoardId(): Promise<string> {
  if (process.env.MONDAY_BOARD_ID) return process.env.MONDAY_BOARD_ID;
  if (cachedBoardId) return cachedBoardId;

  const data = await mondayRequest(`
    query {
      boards(limit: 100) {
        id
        name
      }
    }
  `);

  const board = data.boards.find((b: { id: string; name: string }) => b.name === BOARD_NAME);
  if (!board) throw new Error(`Board "${BOARD_NAME}" not found. Run /api/setup-board first.`);

  cachedBoardId = board.id;
  return board.id;
}

export async function getColumnMap(boardId: string): Promise<ColumnMap> {
  if (cachedColumnMap) return cachedColumnMap;

  const data = await mondayRequest(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) {
        columns { id title type }
      }
    }
  `, { boardId: [boardId] });

  const cols: { id: string; title: string }[] = data.boards[0].columns;
  const find = (title: string) => {
    const col = cols.find(c => c.title === title);
    if (!col) throw new Error(`Column "${title}" not found on board. Re-run /api/setup-board.`);
    return col.id;
  };
  const findOptional = (title: string): string | undefined =>
    cols.find(c => c.title === title)?.id;

  const map: ColumnMap = {
    campaignCode: findOptional('Campaign Code'),
    promoCode: findOptional('Promo Code'),
    type:      find('Type'),
    month:     find('Month'),
    dateRange: find('Date Range'),
    revenue:   find('Revenue'),
    orders:    find('Orders'),
    unitsSold: find('Units Sold'),
    fy:        find('FY'),
    brand:     find('Brand'),
    status:    find('Status'),
    notes:     find('Notes'),
  };

  cachedColumnMap = map;
  return map;
}

function parseNumericText(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function colValue(cols: { id: string; text: string }[], id: string): string {
  return cols.find(c => c.id === id)?.text ?? '';
}

function itemToCampaign(item: {
  id: string;
  name: string;
  column_values: { id: string; text: string }[];
}, colMap: ColumnMap): Campaign {
  const cv = item.column_values;
  return {
    id:           item.id,
    name:         item.name,
    campaignCode: colMap.campaignCode ? colValue(cv, colMap.campaignCode) : '',
    promoCode:    colMap.promoCode    ? colValue(cv, colMap.promoCode)    : '',
    type:       colValue(cv, colMap.type),
    month:      colValue(cv, colMap.month),
    dateRange:  colValue(cv, colMap.dateRange),
    revenue:    parseNumericText(colValue(cv, colMap.revenue)),
    orders:     parseNumericText(colValue(cv, colMap.orders)),
    unitsSold:  parseNumericText(colValue(cv, colMap.unitsSold)),
    fy:         colValue(cv, colMap.fy),
    brand:      colValue(cv, colMap.brand),
    status:     (colValue(cv, colMap.status) || 'Planned') as 'Planned' | 'Complete',
    notes:      colValue(cv, colMap.notes),
  };
}

export async function getCampaigns(): Promise<Campaign[]> {
  const boardId = await getBoardId();
  const colMap = await getColumnMap(boardId);

  // Fetch all items with cursor-based pagination
  let items: Campaign[] = [];
  let cursor: string | null = null;

  do {
    const query = cursor
      ? `query($boardId:[ID!],$cursor:String!){boards(ids:$boardId){items_page(limit:200,cursor:$cursor){cursor items{id name column_values{id text}}}}}`
      : `query($boardId:[ID!]){boards(ids:$boardId){items_page(limit:200){cursor items{id name column_values{id text}}}}}`;

    const variables = cursor ? { boardId: [boardId], cursor } : { boardId: [boardId] };
    const data = await mondayRequest(query, variables);
    const page = data.boards[0].items_page;

    items = items.concat(page.items.map((item: { id: string; name: string; column_values: { id: string; text: string }[] }) =>
      itemToCampaign(item, colMap)
    ));
    cursor = page.cursor ?? null;
  } while (cursor);

  return items;
}

export async function createCampaign(campaign: Omit<Campaign, 'id'>): Promise<Campaign> {
  const boardId = await getBoardId();
  const colMap = await getColumnMap(boardId);

  const colValues = buildColumnValues(campaign, colMap);

  const data = await mondayRequest(`
    mutation($boardId: ID!, $name: String!, $cols: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cols) {
        id
        name
        column_values { id text }
      }
    }
  `, {
    boardId,
    name: campaign.name,
    cols: JSON.stringify(colValues),
  });

  return itemToCampaign(data.create_item, colMap);
}

export async function updateCampaign(id: string, campaign: Partial<Campaign>): Promise<Campaign> {
  const boardId = await getBoardId();
  const colMap = await getColumnMap(boardId);

  const mutations: string[] = [];
  const variables: Record<string, unknown> = { boardId, itemId: id };

  // Update item name if provided
  if (campaign.name !== undefined) {
    mutations.push(`
      rename: change_item_name(item_id: $itemId, board_id: $boardId, name: $name) { id }
    `);
    variables.name = campaign.name;
  }

  // Build column values for everything except name
  const { name: _n, id: _id, ...rest } = campaign as Campaign;
  const colValues = buildColumnValues(rest as Omit<Campaign, 'id'>, colMap);

  if (Object.keys(colValues).length > 0) {
    mutations.push(`
      update: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) {
        id name column_values { id text }
      }
    `);
    variables.cols = JSON.stringify(colValues);
  }

  if (mutations.length === 0) {
    // Nothing to update; fetch and return current
    const campaigns = await getCampaigns();
    return campaigns.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
  }

  const query = `mutation($boardId:ID!,$itemId:ID!${variables.name !== undefined ? ',$name:String!' : ''}${variables.cols !== undefined ? ',$cols:JSON!' : ''}){${mutations.join('\n')}}`;
  const data = await mondayRequest(query, variables);

  const updated = data.update ?? data.rename;
  if (updated && updated.column_values) return itemToCampaign(updated, colMap);

  // Fallback: refetch
  const all = await getCampaigns();
  return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  await mondayRequest(`
    mutation($itemId: ID!) {
      delete_item(item_id: $itemId) { id }
    }
  `, { itemId: id });
}

export async function createBoard(): Promise<{ boardId: string }> {
  // Check if board already exists
  const data = await mondayRequest(`query { boards(limit:100) { id name } }`);
  const existing = data.boards.find((b: { id: string; name: string }) => b.name === BOARD_NAME);
  if (existing) return { boardId: existing.id };

  const created = await mondayRequest(`
    mutation($name: String!) {
      create_board(board_name: $name, board_kind: public) { id }
    }
  `, { name: BOARD_NAME });

  return { boardId: created.create_board.id };
}

export async function addColumnsToBoard(boardId: string): Promise<void> {
  const { COLUMNS_TO_CREATE } = await import('./constants');

  // Get existing columns
  const data = await mondayRequest(`
    query($boardId:[ID!]) { boards(ids:$boardId) { columns { title } } }
  `, { boardId: [boardId] });
  const existingTitles: string[] = data.boards[0].columns.map((c: { title: string }) => c.title);

  for (const col of COLUMNS_TO_CREATE) {
    if (existingTitles.includes(col.title)) continue;
    await mondayRequest(`
      mutation($boardId: ID!, $title: String!, $type: ColumnType!) {
        create_column(board_id: $boardId, title: $title, column_type: $type) { id }
      }
    `, { boardId, title: col.title, type: col.type });
  }

  // Clear column cache after setup
  cachedColumnMap = null;
}

export async function bulkCreateCampaigns(
  campaigns: Omit<Campaign, 'id'>[],
  boardId: string,
  colMap: ColumnMap
): Promise<number> {
  let created = 0;
  for (const c of campaigns) {
    const colValues = buildColumnValues(c, colMap);
    await mondayRequest(`
      mutation($boardId:ID!,$name:String!,$cols:JSON!) {
        create_item(board_id:$boardId,item_name:$name,column_values:$cols) { id }
      }
    `, { boardId, name: c.name, cols: JSON.stringify(colValues) });
    created++;
  }
  return created;
}

function buildColumnValues(
  campaign: Partial<Omit<Campaign, 'id'>>,
  colMap: ColumnMap
): Record<string, unknown> {
  const cols: Record<string, unknown> = {};

  if (campaign.campaignCode !== undefined && colMap.campaignCode) cols[colMap.campaignCode] = campaign.campaignCode;
  if (campaign.promoCode    !== undefined && colMap.promoCode)    cols[colMap.promoCode]    = campaign.promoCode;
  if (campaign.type      !== undefined) cols[colMap.type]      = campaign.type;
  if (campaign.month     !== undefined) cols[colMap.month]     = campaign.month;
  if (campaign.dateRange !== undefined) cols[colMap.dateRange] = campaign.dateRange;
  if (campaign.fy        !== undefined) cols[colMap.fy]        = campaign.fy;
  if (campaign.brand     !== undefined) cols[colMap.brand]     = campaign.brand;
  if (campaign.status    !== undefined) cols[colMap.status]    = campaign.status;

  if (campaign.revenue  !== undefined) cols[colMap.revenue]  = String(campaign.revenue);
  if (campaign.orders   !== undefined) cols[colMap.orders]   = String(campaign.orders);
  if (campaign.unitsSold !== undefined) cols[colMap.unitsSold] = String(campaign.unitsSold);

  // long_text columns need JSON object format
  if (campaign.notes !== undefined) {
    cols[colMap.notes] = { text: campaign.notes };
  }

  return cols;
}
