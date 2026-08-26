/**
 * GET /api/pp-coupons?range=today|7d|30d|all
 *
 * Returns Pascal Press BigCommerce coupon usage statistics —
 * top codes by number of uses, with discount type, savings impact,
 * GA4 revenue attribution, and status.
 *
 * BigCommerce coupons API:
 *   GET /v2/coupons?limit=250&page=N
 *   NOTE: BC's coupon endpoint only exposes all-time `num_uses` — there is no
 *   date filter on the coupon list API. The `numUses` field is always all-time.
 *
 * GA4 revenue: orderCoupon dimension → purchaseRevenue + transactions
 *   Date-filtered according to the `range` query param.
 *
 * Env: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN
 *      + standard GA4 env vars (GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON or OAuth)
 *
 * "totalSavings" (BC-computed) is only available for flat-rate discount types;
 * "gaRevenue" (GA4) is the actual order revenue on sessions that used the coupon.
 */
import { NextResponse } from 'next/server';
import { NextRequest }  from 'next/server';
import { fetchCouponRevenue } from '@/lib/google-analytics';

// Must be dynamic so query params are respected
export const dynamic = 'force-dynamic';

/** Map `range` param → GA4 startDate / endDate strings */
function rangeToDates(range: string): { startDate: string; endDate: string } {
  switch (range) {
    case 'today': return { startDate: 'today',      endDate: 'today'      };
    case '7d':    return { startDate: '7daysAgo',   endDate: 'today'      };
    case '30d':   return { startDate: '30daysAgo',  endDate: 'today'      };
    default:      return { startDate: '2020-01-01', endDate: 'today'      }; // all-time
  }
}

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

function bcHeaders() {
  return {
    'X-Auth-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };
}

// ─── BigCommerce coupon shape ─────────────────────────────────────────────────

interface BCCoupon {
  id:                   number;
  name:                 string;
  code:                 string;
  type:                 string; // see DISCOUNT_TYPE_LABELS below
  amount:               string; // discount value (dollars or %)
  min_purchase:         string; // minimum order total
  enabled:              boolean;
  expiration:           string; // ISO date string or ''
  num_uses:             number;
  max_uses:             number; // 0 = unlimited
  max_uses_per_customer: number;
}

// ─── Public response types ────────────────────────────────────────────────────

export interface CouponRow {
  code:              string;
  name:              string;
  type:              string;
  discountFormatted: string;         // human-readable discount (e.g. "$10 off order")
  numUses:           number;
  totalSavings:      number | null;  // BC flat-rate: uses × amount; null for % / per-item
  gaRevenue:         number | null;  // GA4 purchaseRevenue for orders with this coupon; null if GA4 not connected
  gaTransactions:    number | null;  // GA4 transaction count
  enabled:           boolean;
  expired:           boolean;
  maxUses:           number;         // 0 = unlimited
  minPurchase:       number;
}

export interface PPCouponsResponse {
  connected:            boolean;
  coupons:              CouponRow[];
  totalUses:            number;
  totalComputedSavings: number;       // sum of flat-rate savings (BC) — always all-time
  totalGaRevenue:       number;       // sum of GA4 revenue for the selected date range
  totalGaTransactions:  number;       // sum of GA4 transactions for the selected date range
  hasPercentageCoupons: boolean;      // true → some BC savings figures are unknown
  gaConnected:          boolean;      // whether GA4 revenue data is available
  range:                string;       // the range param that was used
  error?:               string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  per_total_discount:  'Flat $ off order',
  per_item_discount:   '$ off each item',
  percentage_discount: '% off',
  shipping_discount:   '$ off shipping',
  free_shipping:       'Free shipping',
  promotions:          'Promotion',
};

function formatDiscount(type: string, amount: string): string {
  const n = parseFloat(amount);
  switch (type) {
    case 'per_total_discount':  return `$${n.toFixed(2)} off order`;
    case 'per_item_discount':   return `$${n.toFixed(2)} off each item`;
    case 'percentage_discount': return `${n}% off`;
    case 'shipping_discount':   return `$${n.toFixed(2)} off shipping`;
    case 'free_shipping':       return 'Free shipping';
    default:                    return amount ? `$${n.toFixed(2)}` : type;
  }
}

/** Returns total savings for flat-rate coupon types; null for types that need order data. */
function computeSavings(type: string, amount: string, numUses: number): number | null {
  if (type === 'per_total_discount' || type === 'shipping_discount') {
    return parseFloat(amount) * numUses;
  }
  // percentage_discount and per_item_discount need order totals/quantities
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? 'all';
  const { startDate, endDate } = rangeToDates(range);
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({
      connected:            false,
      coupons:              [],
      totalUses:            0,
      totalComputedSavings: 0,
      totalGaRevenue:       0,
      totalGaTransactions:  0,
      hasPercentageCoupons: false,
      gaConnected:          false,
      range,
      error: 'BIGCOMMERCE_STORE_HASH / BIGCOMMERCE_ACCESS_TOKEN not configured',
    } satisfies PPCouponsResponse);
  }

  try {
    // ── Fetch BC coupons + GA4 coupon revenue in parallel ──────────────────
    const [bcResult, gaResult] = await Promise.all([
      // BigCommerce: paginate all coupons
      (async () => {
        const allCoupons: BCCoupon[] = [];
        let page = 1;
        while (true) {
          const url = `${BC_BASE}/coupons?limit=250&page=${page}`;
          const res = await fetch(url, { headers: bcHeaders(), cache: 'no-store' });
          if (res.status === 204) break;
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`BigCommerce GET /coupons → ${res.status}: ${body.slice(0, 200)}`);
          }
          const batch = await res.json() as BCCoupon[];
          if (!Array.isArray(batch) || batch.length === 0) break;
          allCoupons.push(...batch);
          if (batch.length < 250) break;
          page++;
        }
        return allCoupons;
      })(),

      // GA4: revenue by orderCoupon dimension, date-filtered by range param
      fetchCouponRevenue(startDate, endDate),
    ]);

    // Build a lookup map: UPPERCASE coupon code → GA4 row
    const gaMap = new Map(gaResult.rows.map(r => [r.couponCode.toUpperCase(), r]));

    const now = new Date();

    const coupons: CouponRow[] = bcResult
      .filter(c => c.num_uses > 0)
      .sort((a, b) => b.num_uses - a.num_uses)
      .slice(0, 25)
      .map(c => {
        const code = c.code.toUpperCase();
        const ga   = gaMap.get(code) ?? null;
        return {
          code,
          name:              c.name,
          type:              DISCOUNT_TYPE_LABELS[c.type] ?? c.type,
          discountFormatted: formatDiscount(c.type, c.amount),
          numUses:           c.num_uses,
          totalSavings:      computeSavings(c.type, c.amount, c.num_uses),
          gaRevenue:         gaResult.connected ? (ga?.revenue ?? 0) : null,
          gaTransactions:    gaResult.connected ? (ga?.transactions ?? 0) : null,
          enabled:           c.enabled,
          expired:           c.expiration ? new Date(c.expiration) < now : false,
          maxUses:           c.max_uses,
          minPurchase:       parseFloat(c.min_purchase || '0'),
        };
      });

    const totalUses            = coupons.reduce((s, c) => s + c.numUses, 0);
    const totalComputedSavings = coupons.reduce((s, c) => s + (c.totalSavings ?? 0), 0);
    const totalGaRevenue       = coupons.reduce((s, c) => s + (c.gaRevenue ?? 0), 0);
    const totalGaTransactions  = coupons.reduce((s, c) => s + (c.gaTransactions ?? 0), 0);
    const hasPercentageCoupons = coupons.some(c => c.totalSavings === null);

    console.log(
      `[pp-coupons] range=${range}, ${bcResult.length} total BC, ${coupons.length} used, ` +
      `${totalUses} uses (all-time BC), GA4 revenue $${totalGaRevenue.toFixed(2)}, ` +
      `GA4 txns ${totalGaTransactions} (connected=${gaResult.connected})`,
    );

    return NextResponse.json({
      connected: true,
      coupons,
      totalUses,
      totalComputedSavings,
      totalGaRevenue:       Math.round(totalGaRevenue * 100) / 100,
      totalGaTransactions,
      hasPercentageCoupons,
      gaConnected: gaResult.connected,
      range,
    } satisfies PPCouponsResponse);

  } catch (e) {
    console.error('[pp-coupons]', e);
    return NextResponse.json({
      connected:            false,
      coupons:              [],
      totalUses:            0,
      totalComputedSavings: 0,
      totalGaRevenue:       0,
      totalGaTransactions:  0,
      hasPercentageCoupons: false,
      gaConnected:          false,
      range,
      error: e instanceof Error ? e.message : 'Unknown error',
    } satisfies PPCouponsResponse);
  }
}
