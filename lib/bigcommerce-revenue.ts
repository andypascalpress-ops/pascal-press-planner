/**
 * BigCommerce REST API client for revenue & customer analytics.
 *
 * Stores:
 *  - Pascal Press: BIGCOMMERCE_STORE_HASH + BIGCOMMERCE_ACCESS_TOKEN
 *  - Blake Education: BIGCOMMERCE_BLAKE_STORE_HASH + BIGCOMMERCE_BLAKE_ACCESS_TOKEN
 *
 * New vs Returning logic:
 *  - Registered customers (customer_id > 0): deduped by id; "new" if account created this month.
 *  - Guest orders (customer_id === 0): deduped by billing email; all counted as "new"
 *    (no account history available for guests).
 */

const PP_STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const PP_ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BLAKE_STORE_HASH   = process.env.BIGCOMMERCE_BLAKE_STORE_HASH   ?? '';
const BLAKE_ACCESS_TOKEN = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';

function bcHeaders(token: string) {
  return {
    'X-Auth-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export interface RevenueData {
  totalRevenue: number;
  /** Revenue from orders where referral_source contains 'googleadservices' — Google Ads clicks */
  googlePaidRevenue: number;
  /** Revenue from orders where referral_source contains 'google' but NOT 'googleadservices' — organic search */
  googleOrganicRevenue: number;
  totalOrders: number;
  newCustomers: number;
  returningCustomers: number;
  source: 'bigcommerce' | 'stripe' | 'placeholder';
  connected: boolean;
}

function emptyRevenue(connected = false): RevenueData {
  return {
    totalRevenue: 0,
    googlePaidRevenue: 0,
    googleOrganicRevenue: 0,
    totalOrders: 0,
    newCustomers: 0,
    returningCustomers: 0,
    source: 'bigcommerce',
    connected,
  };
}

function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(year!, mon! - 1, 1);
  const end   = new Date(year!, mon!,     0);
  return {
    start: start.toISOString().split('T')[0]!,
    end:   end.toISOString().split('T')[0]!,
  };
}

/** Convert YYYY-MM-DD to RFC 2822 format with AEST offset — required by BigCommerce v2 API */
function toRFC2822(dateStr: string, endOfDay = false): string {
  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = MONTHS[mon! - 1]!;
  const time = endOfDay ? '23:59:59' : '00:00:00';
  return `${dow}, ${dd} ${mmm} ${year} ${time} +1000`;
}

/** Convert a Date to YYYY-MM-DD in Australia/Sydney */
function toSydneyDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Parse BC's RFC 2822 date_created field and return YYYY-MM-DD in Sydney */
function orderDateSydney(bcDateCreated: string): string {
  return toSydneyDateStr(new Date(bcDateCreated));
}

/** Last day of month as YYYY-MM-DD */
function lastDayOfMonth(yearMon: string): string {
  const [y, m] = yearMon.split('-').map(Number);
  return new Date(y!, m!, 0).toISOString().split('T')[0]!;
}

async function fetchAllPages<T>(
  storeHash: string,
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const base = `https://api.bigcommerce.com/stores/${storeHash}/v2`;
  const results: T[] = [];
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({ ...params, page: String(page), limit: '250' });
    const res = await fetch(`${base}${path}?${qs}`, {
      headers: bcHeaders(token),
      cache: 'no-store',
    });
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
  total_ex_tax: string;
  customer_id: number;
  date_created: string;
  status: string;
  referral_source: string;
  billing_address: {
    email: string;
  };
}

interface BCCustomer {
  id: number;
  date_created: string;
}

async function fetchBCRevenue(
  storeHash: string,
  token: string,
  month: string,
  dateRange?: { start: string; end: string },
): Promise<RevenueData> {
  if (!storeHash || !token) return emptyRevenue(false);

  try {
    const { start, end } = dateRange ?? monthRange(month);
    const v3Base = `https://api.bigcommerce.com/stores/${storeHash}/v3`;

    const startMonth = start.slice(0, 7);
    const endMonth   = end.slice(0, 7);
    let allOrders: BCOrder[] = [];
    let cur = startMonth;
    while (cur <= endMonth) {
      const mOrders = await fetchAllPages<BCOrder>(storeHash, token, '/orders', {
        min_date_created: toRFC2822(`${cur}-01`),
        max_date_created: toRFC2822(lastDayOfMonth(cur), true),
      });
      allOrders.push(...mOrders);
      const [y, m] = cur.split('-').map(Number);
      cur = m! === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`;
    }

    const orders = allOrders.filter(o => {
      const d = orderDateSydney(o.date_created);
      return d >= start && d <= end;
    });

    const excludedStatuses = new Set([
      'Cancelled', 'Refunded', 'Incomplete',
      'Awaiting Payment', 'Manual Verification Required',
    ]);
    const validOrders = orders.filter(o => !excludedStatuses.has(o.status));

    const totalRevenue = validOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);
    const totalOrders  = validOrders.length;

    const googlePaidOrders = validOrders.filter(o =>
      (o.referral_source ?? '').toLowerCase().includes('googleadservices')
    );
    const googlePaidRevenue = googlePaidOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);

    const googleOrganicOrders = validOrders.filter(o => {
      const ref = (o.referral_source ?? '').toLowerCase();
      return ref.includes('google') && !ref.includes('googleadservices');
    });
    const googleOrganicRevenue = googleOrganicOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);

    const guestEmails = new Set<string>();
    for (const o of validOrders) {
      if (o.customer_id === 0) {
        const email = (o.billing_address?.email ?? '').toLowerCase().trim();
        if (email) guestEmails.add(email);
      }
    }

    const registeredIds = [
      ...new Set(validOrders.filter(o => o.customer_id > 0).map(o => o.customer_id)),
    ];

    let newCustomers       = guestEmails.size;
    let returningCustomers = 0;

    if (registeredIds.length > 0) {
      const customers: BCCustomer[] = [];
      for (let i = 0; i < registeredIds.length; i += 50) {
        const chunk = registeredIds.slice(i, i + 50);
        const res   = await fetch(
          `${v3Base}/customers?id:in=${chunk.join(',')}&limit=250`,
          { headers: bcHeaders(token), cache: 'no-store' },
        );
        if (res.ok) {
          const json = await res.json();
          const data: BCCustomer[] = Array.isArray(json) ? json : (json.data ?? []);
          customers.push(...data);
        }
      }
      for (const c of customers) {
        const regDate = (c.date_created ?? '').split('T')[0] ?? '';
        if (regDate >= start && regDate <= end) {
          newCustomers++;
        } else {
          returningCustomers++;
        }
      }
    }

    return {
      totalRevenue, googlePaidRevenue, googleOrganicRevenue,
      totalOrders, newCustomers, returningCustomers,
      source: 'bigcommerce', connected: true,
    };
  } catch {
    return emptyRevenue(false);
  }
}

export async function fetchPPRevenue(
  month: string,
  dateRange?: { start: string; end: string },
): Promise<RevenueData> {
  return fetchBCRevenue(PP_STORE_HASH, PP_ACCESS_TOKEN, month, dateRange);
}

export async function fetchBlakeRevenue(
  month: string,
  dateRange?: { start: string; end: string },
): Promise<RevenueData> {
  return fetchBCRevenue(BLAKE_STORE_HASH, BLAKE_ACCESS_TOKEN, month, dateRange);
}

export function placeholderETZRevenue(): RevenueData {
  return {
    totalRevenue: 0,
    googlePaidRevenue: 0,
    googleOrganicRevenue: 0,
    totalOrders: 0,
    newCustomers: 0,
    returningCustomers: 0,
    source: 'stripe',
    connected: false,
  };
}
