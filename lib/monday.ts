import { Campaign, ColumnMap } from './types';
import { BOARD_NAME, ETZ_BOARD_NAME, HSC_BOARD_NAME } from './constants';

const MONDAY_API_URL = 'https://api.monday.com/v2';

// ── Shared request ──

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

// ── PP board ──

let cachedBoardId:   string | null    = null;
let cachedColumnMap: ColumnMap | null = null;

export async function getBoardId(): Promise<string> {
  if (process.env.MONDAY_PP_BOARD_ID) return process.env.MONDAY_PP_BOARD_ID;
  if (process.env.MONDAY_BOARD_ID)    return process.env.MONDAY_BOARD_ID;
  if (cachedBoardId) return cachedBoardId;

  const data = await mondayRequest(`
    query {
      boards(limit: 100) { id name }
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
    promoCode:    findOptional('Promo Code'),
    startDate:    findOptional('Start Date'),
    endDate:      findOptional('End Date'),
    color:        findOptional('Color'),
    discount:     findOptional('Discount'),
    offerInfo:    findOptional('Offer Info'),
    type:         find('Type'),
    month:        find('Month'),
    dateRange:    find('Date Range'),
    revenue:      find('Revenue'),
    orders:       find('Orders'),
    unitsSold:    find('Units Sold'),
    fy:           find('FY'),
    brand:        find('Brand'),
    status:       find('Status'),
    notes:        find('Notes'),
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
    startDate:    colMap.startDate    ? colValue(cv, colMap.startDate)    : '',
    endDate:      colMap.endDate      ? colValue(cv, colMap.endDate)      : '',
    color:        colMap.color        ? colValue(cv, colMap.color)        : '',
    discount:     colMap.discount     ? colValue(cv, colMap.discount)     : '',
    offerInfo:    colMap.offerInfo    ? colValue(cv, colMap.offerInfo)    : '',
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

async function getPPCampaigns(): Promise<Campaign[]> {
  const boardId = await getBoardId();
  const colMap  = await getColumnMap(boardId);

  let items:  Campaign[]  = [];
  let cursor: string|null = null;

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

// ── ETZ board ──

interface ETZColumnMap {
  offer:    string | undefined;
  products: string | undefined;
  timeline: string | undefined;  // "Campaign Timeline" — JSON value: {from, to}
  notes:    string | undefined;
  budget:   string | undefined;
}

let cachedETZBoardId:   string | null       = null;
let cachedETZColumnMap: ETZColumnMap | null = null;

async function getETZBoardId(): Promise<string> {
  if (process.env.MONDAY_ETZ_BOARD_ID) return process.env.MONDAY_ETZ_BOARD_ID;
  if (cachedETZBoardId) return cachedETZBoardId;

  const data = await mondayRequest(`query { boards(limit: 100) { id name } }`);
  const board = data.boards.find((b: { id: string; name: string }) => b.name === ETZ_BOARD_NAME);
  if (!board) throw new Error(`ETZ board "${ETZ_BOARD_NAME}" not found.`);

  cachedETZBoardId = board.id;
  return board.id;
}

async function getETZColumnMap(boardId: string): Promise<ETZColumnMap> {
  if (cachedETZColumnMap) return cachedETZColumnMap;

  const data = await mondayRequest(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) { columns { id title } }
    }
  `, { boardId: [boardId] });

  const cols: { id: string; title: string }[] = data.boards[0].columns;
  const findOpt = (title: string) => cols.find(c => c.title === title)?.id;

  const map: ETZColumnMap = {
    offer:    findOpt('Offer'),
    products: findOpt('Products'),
    timeline: findOpt('Campaign Timeline'),
    notes:    findOpt('Notes'),
    budget:   findOpt('Budget'),
  };

  cachedETZColumnMap = map;
  return map;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function monthFromDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt.getTime()) ? '' : MONTH_NAMES[dt.getMonth()];
}

function fyFromDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return 'FY26';
  // Australian FY: July onwards belongs to the next calendar year's FY
  const fyYear = dt.getMonth() >= 6 ? dt.getFullYear() + 1 : dt.getFullYear();
  return `FY${String(fyYear).slice(-2)}`;
}

function extractDiscount(offer: string): string {
  const m = offer.match(/(\d+%|\$\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function toDisplayDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : iso;
}

function etzItemToCampaign(
  item: { id: string; name: string; column_values: { id: string; text: string; value: string }[] },
  colMap: ETZColumnMap
): Campaign {
  const cv  = item.column_values;
  const txt = (id: string | undefined) => id ? (cv.find(c => c.id === id)?.text  ?? '') : '';
  const val = (id: string | undefined) => id ? (cv.find(c => c.id === id)?.value ?? '') : '';

  let startDate = '';
  let endDate   = '';

  if (colMap.timeline) {
    const raw = val(colMap.timeline);
    if (raw) {
      try {
        const j = JSON.parse(raw) as { from?: string; to?: string };
        startDate = j.from ?? '';
        endDate   = j.to   ?? '';
      } catch { /* ignore */ }
    }
  }

  const offer    = txt(colMap.offer);
  const notes    = txt(colMap.notes);
  const products = txt(colMap.products);

  const month     = startDate ? monthFromDate(startDate) : '';
  const fy        = startDate ? fyFromDate(startDate)    : 'FY26';
  const discount  = extractDiscount(offer);
  const dateRange = startDate && endDate
    ? `${toDisplayDate(startDate)}-${toDisplayDate(endDate)}`
    : '';

  const notesText = [notes, products ? `Products: ${products}` : '']
    .filter(Boolean).join('\n');

  return {
    id:           item.id,
    name:         item.name,
    brand:        'Excel Test Zone',
    type:         'General Promotion',
    status:       'Planned',
    month,
    fy,
    startDate,
    endDate,
    dateRange,
    offerInfo:    offer,
    discount,
    notes:        notesText,
    campaignCode: '',
    promoCode:    '',
    color:        '',
    revenue:      0,
    orders:       0,
    unitsSold:    0,
  };
}

async function getETZCampaigns(): Promise<Campaign[]> {
  const boardId = await getETZBoardId();
  const colMap  = await getETZColumnMap(boardId);

  let items:  Campaign[]  = [];
  let cursor: string|null = null;

  do {
    const query = cursor
      ? `query($b:[ID!],$c:String!){boards(ids:$b){items_page(limit:200,cursor:$c){cursor items{id name column_values{id text value}}}}}`
      : `query($b:[ID!]){boards(ids:$b){items_page(limit:200){cursor items{id name column_values{id text value}}}}}`;

    const variables = cursor ? { b: [boardId], c: cursor } : { b: [boardId] };
    const data = await mondayRequest(query, variables);
    const page = data.boards[0].items_page;

    items = items.concat(
      page.items.map((item: { id: string; name: string; column_values: { id: string; text: string; value: string }[] }) =>
        etzItemToCampaign(item, colMap)
      )
    );
    cursor = page.cursor ?? null;
  } while (cursor);

  return items;
}

async function createETZCampaign(campaign: Omit<Campaign, 'id'>): Promise<Campaign> {
  const boardId = await getETZBoardId();
  const colMap  = await getETZColumnMap(boardId);

  const cols: Record<string, unknown> = {};
  if (colMap.offer    && campaign.offerInfo) cols[colMap.offer] = campaign.offerInfo;
  if (colMap.notes    && campaign.notes)     cols[colMap.notes] = { text: campaign.notes };
  if (colMap.timeline && campaign.startDate && campaign.endDate) {
    cols[colMap.timeline] = JSON.stringify({ from: campaign.startDate, to: campaign.endDate });
  }

  const data = await mondayRequest(`
    mutation($boardId: ID!, $name: String!, $cols: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cols) {
        id name column_values { id text value }
      }
    }
  `, { boardId, name: campaign.name, cols: JSON.stringify(cols) });

  return etzItemToCampaign(data.create_item, colMap);
}

async function updateETZCampaign(id: string, campaign: Partial<Campaign>): Promise<Campaign> {
  const boardId = await getETZBoardId();
  const colMap  = await getETZColumnMap(boardId);

  const cols: Record<string, unknown> = {};
  if (campaign.name     !== undefined) cols['name'] = campaign.name;
  if (colMap.offer    && campaign.offerInfo  !== undefined) cols[colMap.offer] = campaign.offerInfo;
  if (colMap.notes    && campaign.notes      !== undefined) cols[colMap.notes] = { text: campaign.notes };
  if (colMap.timeline && campaign.startDate  && campaign.endDate) {
    cols[colMap.timeline] = JSON.stringify({ from: campaign.startDate, to: campaign.endDate });
  }

  if (Object.keys(cols).length === 0) {
    const all = await getCampaigns();
    return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
  }

  const data = await mondayRequest(`
    mutation($boardId: ID!, $itemId: ID!, $cols: JSON!) {
      update: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) {
        id name column_values { id text value }
      }
    }
  `, { boardId, itemId: id, cols: JSON.stringify(cols) });

  const updated = data.update;
  if (updated?.column_values) return etzItemToCampaign(updated, colMap);

  const all = await getCampaigns();
  return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
}

// ── HSC board (same column structure as ETZ) ──

let cachedHSCBoardId:   string | null       = null;
let cachedHSCColumnMap: ETZColumnMap | null = null;

async function getHSCBoardId(): Promise<string> {
  if (process.env.MONDAY_HSC_BOARD_ID) return process.env.MONDAY_HSC_BOARD_ID;
  if (cachedHSCBoardId) return cachedHSCBoardId;

  const data = await mondayRequest(`query { boards(limit: 100) { id name } }`);
  const board = data.boards.find((b: { id: string; name: string }) => b.name === HSC_BOARD_NAME);
  if (!board) throw new Error(`HSC board "${HSC_BOARD_NAME}" not found.`);

  cachedHSCBoardId = board.id;
  return board.id;
}

async function getHSCColumnMap(boardId: string): Promise<ETZColumnMap> {
  if (cachedHSCColumnMap) return cachedHSCColumnMap;

  const data = await mondayRequest(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) { columns { id title } }
    }
  `, { boardId: [boardId] });

  const cols: { id: string; title: string }[] = data.boards[0].columns;
  const findOpt = (title: string) => cols.find(c => c.title === title)?.id;

  const map: ETZColumnMap = {
    offer:    findOpt('Offer'),
    products: findOpt('Products'),
    timeline: findOpt('Campaign Timeline'),
    notes:    findOpt('Notes'),
    budget:   findOpt('Budget'),
  };

  cachedHSCColumnMap = map;
  return map;
}

async function getHSCCampaigns(): Promise<Campaign[]> {
  const boardId = await getHSCBoardId();
  const colMap  = await getHSCColumnMap(boardId);

  let items:  Campaign[]  = [];
  let cursor: string|null = null;

  do {
    const query = cursor
      ? `query($b:[ID!],$c:String!){boards(ids:$b){items_page(limit:200,cursor:$c){cursor items{id name column_values{id text value}}}}}`
      : `query($b:[ID!]){boards(ids:$b){items_page(limit:200){cursor items{id name column_values{id text value}}}}}`;

    const variables = cursor ? { b: [boardId], c: cursor } : { b: [boardId] };
    const data = await mondayRequest(query, variables);
    const page = data.boards[0].items_page;

    items = items.concat(
      page.items.map((item: { id: string; name: string; column_values: { id: string; text: string; value: string }[] }) => {
        const c = etzItemToCampaign(item, colMap);
        return { ...c, brand: 'Excel HSC Copilot' };
      })
    );
    cursor = page.cursor ?? null;
  } while (cursor);

  return items;
}

async function createHSCCampaign(campaign: Omit<Campaign, 'id'>): Promise<Campaign> {
  const boardId = await getHSCBoardId();
  const colMap  = await getHSCColumnMap(boardId);

  const cols: Record<string, unknown> = {};
  if (colMap.offer    && campaign.offerInfo) cols[colMap.offer] = campaign.offerInfo;
  if (colMap.notes    && campaign.notes)     cols[colMap.notes] = { text: campaign.notes };
  if (colMap.timeline && campaign.startDate && campaign.endDate) {
    cols[colMap.timeline] = JSON.stringify({ from: campaign.startDate, to: campaign.endDate });
  }

  const data = await mondayRequest(`
    mutation($boardId: ID!, $name: String!, $cols: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cols) {
        id name column_values { id text value }
      }
    }
  `, { boardId, name: campaign.name, cols: JSON.stringify(cols) });

  const c = etzItemToCampaign(data.create_item, colMap);
  return { ...c, brand: 'Excel HSC Copilot' };
}

async function updateHSCCampaign(id: string, campaign: Partial<Campaign>): Promise<Campaign> {
  const boardId = await getHSCBoardId();
  const colMap  = await getHSCColumnMap(boardId);

  const cols: Record<string, unknown> = {};
  if (campaign.name     !== undefined) cols['name'] = campaign.name;
  if (colMap.offer    && campaign.offerInfo !== undefined) cols[colMap.offer] = campaign.offerInfo;
  if (colMap.notes    && campaign.notes     !== undefined) cols[colMap.notes] = { text: campaign.notes };
  if (colMap.timeline && campaign.startDate && campaign.endDate) {
    cols[colMap.timeline] = JSON.stringify({ from: campaign.startDate, to: campaign.endDate });
  }

  if (Object.keys(cols).length === 0) {
    const all = await getCampaigns();
    return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
  }

  const data = await mondayRequest(`
    mutation($boardId: ID!, $itemId: ID!, $cols: JSON!) {
      update: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) {
        id name column_values { id text value }
      }
    }
  `, { boardId, itemId: id, cols: JSON.stringify(cols) });

  const updated = data.update;
  if (updated?.column_values) {
    const c = etzItemToCampaign(updated, colMap);
    return { ...c, brand: 'Excel HSC Copilot' };
  }

  const all = await getCampaigns();
  return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
}

// ── Public API ──

export async function getCampaigns(): Promise<Campaign[]> {
  const [pp, etz, hsc] = await Promise.all([
    getPPCampaigns(),
    getETZCampaigns().catch(() => [] as Campaign[]),
    getHSCCampaigns().catch(() => [] as Campaign[]),
  ]);
  return [...pp, ...etz, ...hsc];
}

export async function createCampaign(campaign: Omit<Campaign, 'id'>): Promise<Campaign> {
  if (campaign.brand === 'Excel Test Zone')    return createETZCampaign(campaign);
  if (campaign.brand === 'Excel HSC Copilot') return createHSCCampaign(campaign);

  const boardId = await getBoardId();
  const colMap  = await getColumnMap(boardId);
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
  if (campaign.brand === 'Excel Test Zone')    return updateETZCampaign(id, campaign);
  if (campaign.brand === 'Excel HSC Copilot') return updateHSCCampaign(id, campaign);

  const boardId = await getBoardId();
  const colMap  = await getColumnMap(boardId);

  const { id: _id, ...rest } = campaign as Campaign;
  const colValues = buildColumnValues(rest as Omit<Campaign, 'id'>, colMap);

  if (campaign.name !== undefined) {
    colValues['name'] = campaign.name;
  }

  if (Object.keys(colValues).length === 0) {
    const campaigns = await getCampaigns();
    return campaigns.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
  }

  const data = await mondayRequest(`
    mutation($boardId: ID!, $itemId: ID!, $cols: JSON!) {
      update: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) {
        id name column_values { id text }
      }
    }
  `, { boardId, itemId: id, cols: JSON.stringify(colValues) });

  const updated = data.update;
  if (updated && updated.column_values) return itemToCampaign(updated, colMap);

  const all = await getCampaigns();
  return all.find(c => c.id === id) ?? { id, ...campaign } as Campaign;
}

export async function deleteCampaign(id: string, brand?: string): Promise<void> {
  // Resolve board to ensure credentials are valid and board is accessible,
  // then delete by item ID (Monday.com item IDs are globally unique).
  await (brand === 'Excel Test Zone' ? getETZBoardId() : brand === 'Excel HSC Copilot' ? getHSCBoardId() : getBoardId());

  await mondayRequest(`
    mutation($itemId: ID!) {
      delete_item(item_id: $itemId) { id }
    }
  `, { itemId: id });
}

export async function createBoard(): Promise<{ boardId: string }> {
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
  if (campaign.startDate    !== undefined && colMap.startDate)    cols[colMap.startDate]    = campaign.startDate;
  if (campaign.endDate      !== undefined && colMap.endDate)      cols[colMap.endDate]      = campaign.endDate;
  if (campaign.color        !== undefined && colMap.color)        cols[colMap.color]        = campaign.color;
  if (campaign.discount     !== undefined && colMap.discount)     cols[colMap.discount]     = campaign.discount;
  if (campaign.offerInfo    !== undefined && colMap.offerInfo)    cols[colMap.offerInfo]    = { text: campaign.offerInfo };
  if (campaign.type      !== undefined) cols[colMap.type]      = campaign.type;
  if (campaign.month     !== undefined) cols[colMap.month]     = campaign.month;
  if (campaign.dateRange !== undefined) cols[colMap.dateRange] = campaign.dateRange;
  if (campaign.fy        !== undefined) cols[colMap.fy]        = campaign.fy;
  if (campaign.brand     !== undefined) cols[colMap.brand]     = campaign.brand;
  if (campaign.status    !== undefined) cols[colMap.status]    = campaign.status;

  if (campaign.revenue   !== undefined) cols[colMap.revenue]   = String(campaign.revenue);
  if (campaign.orders    !== undefined) cols[colMap.orders]    = String(campaign.orders);
  if (campaign.unitsSold !== undefined) cols[colMap.unitsSold] = String(campaign.unitsSold);

  if (campaign.notes !== undefined) {
    cols[colMap.notes] = { text: campaign.notes };
  }

  return cols;
}
