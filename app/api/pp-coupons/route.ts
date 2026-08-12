/**
 * GET /api/pp-coupons
 *
 * Returns Pascal Press BigCommerce coupon usage statistics —
 * top codes by number of uses, with discount type, savings impact,
 * and status.
 *
 * BigCommerce coupons API:
 *   GET /v2/coupons?limit=250&page=N
 *
 * Env: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN
 *
 * "Total savings" is computable for flat-rate (per_total_discount,
 * shipping_discount) coupons only — percentage and per-item discounts
 * depend on order values, which require separate order lookups.
 */
import { NextResponse } from 'next/server';

// Cache for 30 minutes — coupon usage doesn't change by the second
export const revalidate = 1800;

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
  discountFormatted: string;  // human-readable discount (e.g. "$10 off order")
  numUses:           number;
  totalSavings:      number | null;  // null when it can't be computed (% / per-item)
  enabled:           boolean;
  expired:           boolean;
  maxUses:           number;         // 0 = unlimited
  minPurchase:       number;
}

export interface PPCouponsResponse {
  connected:           boolean;
  coupons:             CouponRow[];
  totalUses:           number;
  totalComputedSavings: number;      // sum of flat-rate coupons only
  hasPercentageCoupons: boolean;     // true → some savings figures are unknown
  error?:              string;
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

export async function GET() {
  if (!STORE_HASH || !ACCESS_TOKEN) {
    return NextResponse.json({
      connected:            false,
      coupons:              [],
      totalUses:            0,
      totalComputedSavings: 0,
      hasPercentageCoupons: false,
      error: 'BIGCOMMERCE_STORE_HASH / BIGCOMMERCE_ACCESS_TOKEN not configured',
    } satisfies PPCouponsResponse);
  }

  try {
    // Paginate through all coupons (BigCommerce max 250 per page)
    const allCoupons: BCCoupon[] = [];
    let page = 1;

    while (true) {
      const url = `${BC_BASE}/coupons?limit=250&page=${page}`;
      const res = await fetch(url, { headers: bcHeaders(), cache: 'no-store' });

      if (res.status === 204) break;  // no content
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

    const now = new Date();

    const coupons: CouponRow[] = allCoupons
      .filter(c => c.num_uses > 0)           // only show coupons that have been used
      .sort((a, b) => b.num_uses - a.num_uses)
      .slice(0, 25)                           // top 25 by usage
      .map(c => ({
        code:              c.code.toUpperCase(),
        name:              c.name,
        type:              DISCOUNT_TYPE_LABELS[c.type] ?? c.type,
        discountFormatted: formatDiscount(c.type, c.amount),
        numUses:           c.num_uses,
        totalSavings:      computeSavings(c.type, c.amount, c.num_uses),
        enabled:           c.enabled,
        expired:           c.expiration ? new Date(c.expiration) < now : false,
        maxUses:           c.max_uses,
        minPurchase:       parseFloat(c.min_purchase || '0'),
      }));

    const totalUses            = coupons.reduce((s, c) => s + c.numUses, 0);
    const totalComputedSavings = coupons.reduce((s, c) => s + (c.totalSavings ?? 0), 0);
    const hasPercentageCoupons = coupons.some(c => c.totalSavings === null);

    console.log(`[pp-coupons] ${allCoupons.length} total, ${coupons.length} used, ${totalUses} uses`);

    return NextResponse.json({
      connected: true,
      coupons,
      totalUses,
      totalComputedSavings,
      hasPercentageCoupons,
    } satisfies PPCouponsResponse);

  } catch (e) {
    console.error('[pp-coupons]', e);
    return NextResponse.json({
      connected:            false,
      coupons:              [],
      totalUses:            0,
      totalComputedSavings: 0,
      hasPercentageCoupons: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    } satisfies PPCouponsResponse);
  }
}
