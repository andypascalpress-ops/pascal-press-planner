/**
 * BigCommerce REST API client for revenue & customer analytics.
 * Requires env vars: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN
 */

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE    = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const BC_BASE_V3 = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;

function bcHeaders() {
  return {
    'X-Auth-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export interface RevenueData {
  totalRevenue: number;
  totalOrders: number;
  newCustomers: number;
  returningCustomers: number;
  source: 'bigcommerce' | 'stripe' | 'placeholder';
  connected: boolean;
}

function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(year, mon - 1, 1);
  const end   = new Date(year, mon, 0);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

async function fetchAllPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), limit: '250' });
    const res = await fetch(`${BC_BASE}${path}?${qs}`, { headers: bcHeaders() });
    if (res.status === 204 || res.status === 404) break;
    if (!res.ok) throw new Error(`BigCommerce ${path} -> ${res.status}`);
    const data: T[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 250) break;
    page++;
  }
  return results;
}

interface BCOrder {
  id: number;
  total_inc_tax: string;
  customer_id: number;
  date_created: string;
  status: string;
}

interface BCCustomer {
  id: number;
  date_created: string;
}

export async function fetchPPRevenue(month: string): Promise<RevenueData> {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'bigcommerce', connected: false };
  }

  try {
    const { start, end } = monthRange(month);

    // Use AEST (UTC+10) so the date range matches the BigCommerce dashboard,
    // which shows orders in Australian Eastern Standard Time.
    const orders = await fetchAllPages<BCOrder>('/orders', {
      min_date_created: `${start}T00:00:00+10:00`,
      max_date_created: `${end}T23:59:59+10:00`,
    });

    const excludedStatuses = new Set(['Cancelled', 'Refunded', 'Incomplete']);
    const validOrders = orders.filter(o => !excludedStatuses.has(o.status));

    const totalRevenue = validOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);
    const totalOrders  = validOrders.length;

    const customerIds = [...new Set(validOrders.map(o => o.customer_id).filter(id => id > 0))];
    let newCustomers = validOrders.filter(o => o.customer_id === 0).length;
    let returningCustomers = 0;

    if (customerIds.length > 0) {
      const customerChunks: BCCustomer[] = [];
      for (let i = 0; i < customerIds.length; i += 50) {
        const chunk = customerIds.slice(i, i + 50);
        // v3 API supports id:in filter; response is { data: [...], meta: {...} }
        const res = await fetch(
          `${BC_BASE_V3}/customers?id:in=${chunk.join(',')}&limit=250`,
          { headers: bcHeaders() }
        );
        if (res.ok) {
          const json = await res.json();
          const data: BCCustomer[] = Array.isArray(json) ? json : (json.data ?? []);
          customerChunks.push(...data);
        }
      }
      for (const c of customerChunks) {
        const regDate = c.date_created?.split('T')[0] ?? '';
        if (regDate >= start && regDate <= end) {
          newCustomers++;
        } else {
          returningCustomers++;
        }
      }
    }

    return { totalRevenue, totalOrders, newCustomers, returningCustomers, source: 'bigcommerce', connected: true };
  } catch {
    return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'bigcommerce', connected: false };
  }
}

export function placeholderETZRevenue(): RevenueData {
  return { totalRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
}
