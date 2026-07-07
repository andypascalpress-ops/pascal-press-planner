/**
 * BigCommerce REST API client for revenue & customer analytics.
 * Requires env vars: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN
 *
 * New vs Returning logic:
 *  - Registered customers (customer_id > 0): deduped by id; "new" if account created this month.
 *  - Guest orders (customer_id === 0): deduped by billing email; all counted as "new"
 *    (no account history available for guests).
 */

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const BC_BASE_V3   = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;

function bcHeaders() {
  return {
    'X-Auth-Token': ACCESS_TOKEN,
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
  const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Parse as AEST (UTC+10) by treating the date as local midnight in UTC+10
  const [year, mon, day] = dateStr.split('-').map(Number);
  // Create date at AEST midnight: subtract 10h to get UTC equivalent
  const utcMs = Date.UTC(year!, mon! - 1, day!) - 10 * 60 * 60 * 1000;
  const d = new Date(utcMs);
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  const mmm = MONTHS[d.getUTCMonth()]!;
  const yyyy = d.getUTCFullYear();
  const time = endOfDay ? '23:59:59' : '00:00:00';
  return `${dow}, ${dd} ${mmm} ${yyyy} ${time} +1000`;
}

async function fetchAllPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({ ...params, page: String(page), limit: '250' });
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
  total_ex_tax: string;
  customer_id: number;
  date_created: string;
  status: string;
  /** HTTP referrer URL — e.g. 'https://www.googleadservices.com/...' for Google Ads clicks */
  referral_source: string;
  billing_address: {
    email: string;
  };
}

interface BCCustomer {
  id: number;
  date_created: string;
}

export async function fetchPPRevenue(
  month: string,
  dateRange?: { start: string; end: string },
): Promise<RevenueData> {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'bigcommerce', connected: false };
  }

  try {
    const { start, end } = dateRange ?? monthRange(month);

    // BigCommerce v2 requires RFC 2822 date format for date filters.
    const orders = await fetchAllPages<BCOrder>('/orders', {
      min_date_created: toRFC2822(start),
      max_date_created: toRFC2822(end, true),
    });

    // Exclude statuses that BC's revenue dashboard doesn't count.
    const excludedStatuses = new Set([
      'Cancelled', 'Refunded', 'Incomplete',
      'Awaiting Payment', 'Manual Verification Required',
    ]);
    const validOrders = orders.filter(o => !excludedStatuses.has(o.status));

    const totalRevenue = validOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);
    const totalOrders  = validOrders.length;

    // Google Ads (paid): referral_source contains 'googleadservices' — actual ad clicks
    const googlePaidOrders = validOrders.filter(o =>
      (o.referral_source ?? '').toLowerCase().includes('googleadservices')
    );
    const googlePaidRevenue = googlePaidOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);

    // Google Organic: referral_source contains 'google' but NOT 'googleadservices' — organic search
    const googleOrganicOrders = validOrders.filter(o => {
      const ref = (o.referral_source ?? '').toLowerCase();
      return ref.includes('google') && !ref.includes('googleadservices');
    });
    const googleOrganicRevenue = googleOrganicOrders.reduce((s, o) => s + parseFloat(o.total_inc_tax || '0'), 0);

    // ── Customer classification ───────────────────────────────────────────────
    // Guest orders (customer_id === 0): deduplicate by billing email.
    // All unique guest emails are counted as "new" — no account history available.
    const guestEmails = new Set<string>();
    for (const o of validOrders) {
      if (o.customer_id === 0) {
        const email = (o.billing_address?.email ?? '').toLowerCase().trim();
        if (email) guestEmails.add(email);
      }
    }

    // Registered customers: deduplicate by customer_id.
    const registeredIds = [
      ...new Set(validOrders.filter(o => o.customer_id > 0).map(o => o.customer_id)),
    ];

    let newCustomers       = guestEmails.size; // unique guest emails → all new
    let returningCustomers = 0;

    if (registeredIds.length > 0) {
      const customers: BCCustomer[] = [];
      for (let i = 0; i < registeredIds.length; i += 50) {
        const chunk = registeredIds.slice(i, i + 50);
        const res   = await fetch(
          `${BC_BASE_V3}/customers?id:in=${chunk.join(',')}&limit=250`,
          { headers: bcHeaders() },
        );
        if (res.ok) {
          const json = await res.json();
          const data: BCCustomer[] = Array.isArray(json) ? json : (json.data ?? []);
          customers.push(...data);
        }
      }
      for (const c of customers) {
        // "New" if the account was created within this calendar month.
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
    return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'bigcommerce', connected: false };
  }
}

export function placeholderETZRevenue(): RevenueData {
  return { totalRevenue: 0, googlePaidRevenue: 0, googleOrganicRevenue: 0, totalOrders: 0, newCustomers: 0, returningCustomers: 0, source: 'stripe', connected: false };
}
