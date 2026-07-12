/**
 * Debug endpoint to diagnose BigCommerce and Stripe revenue discrepancies.
 * Usage: GET /api/revenue-debug?month=2026-07
 *
 * Stripe section compares:
 *  - Australia/Sydney month bounds (matches dashboard after fix)
 *  - UTC month bounds (old Finance tab behaviour)
 *  - Fixed +10 / +11 offsets
 *  - Gross (amount) vs Net (amount − refunds)
 * For both ETZ (STRIPE_SECRET_KEY) and HSC (STRIPE_HSC_SECRET_KEY).
 */
import { NextRequest, NextResponse } from 'next/server';

const STORE_HASH    = process.env.BIGCOMMERCE_STORE_HASH    ?? '';
const ACCESS_TOKEN  = process.env.BIGCOMMERCE_ACCESS_TOKEN  ?? '';
const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY         ?? '';
const STRIPE_HSC    = process.env.STRIPE_HSC_SECRET_KEY     ?? '';
const BC_BASE       = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const STRIPE_BASE   = 'https://api.stripe.com/v1';
const ACCOUNT_TZ    = 'Australia/Sydney';

function bcHeaders()     { return { 'X-Auth-Token': ACCESS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' }; }
function stripeHeaders(key: string) { return { Authorization: `Bearer ${key}` }; }

function monthRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year!, mon!, 0).getDate();
  const start = `${year}-${String(mon).padStart(2,'0')}-01`;
  const end   = `${year}-${String(mon).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  return { start, end };
}

function zonedDateTimeToUnix(ymd: string, hms: string, timeZone = ACCOUNT_TZ): number {
  const [Y, M, D] = ymd.split('-').map(Number);
  const [h, m, s] = hms.split(':').map(Number);
  const desiredAsUtcMs = Date.UTC(Y!, M! - 1, D!, h!, m!, s!);
  let utcMs = desiredAsUtcMs;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcMs))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asLocalMs = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const diff = desiredAsUtcMs - asLocalMs;
    if (diff === 0) break;
    utcMs += diff;
  }
  return Math.floor(utcMs / 1000);
}

// ─── BigCommerce ──────────────────────────────────────────────────────────────

async function debugBC(month: string) {
  if (!STORE_HASH || !ACCESS_TOKEN) return { error: 'BigCommerce env vars not set' };

  const { start, end } = monthRange(month);
  const allOrders: any[] = [];

  for (const tz of ['+10:00', '+11:00', '+00:00']) {
    const orders: any[] = [];
    let page = 1;
    while (true) {
      const qs = new URLSearchParams({
        min_date_created: `${start}T00:00:00${tz}`,
        max_date_created: `${end}T23:59:59${tz}`,
        page: String(page),
        limit: '250',
      });
      const res = await fetch(`${BC_BASE}/orders?${qs}`, { headers: bcHeaders() });
      if (res.status === 204 || res.status === 404) break;
      if (!res.ok) { break; }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      orders.push(...data);
      if (data.length < 250) break;
      page++;
    }

    const byStatus: Record<string, { count: number; totalIncTax: number; totalExTax: number }> = {};
    for (const o of orders) {
      const s = o.status ?? 'Unknown';
      if (!byStatus[s]) byStatus[s] = { count: 0, totalIncTax: 0, totalExTax: 0 };
      byStatus[s].count++;
      byStatus[s].totalIncTax += parseFloat(o.total_inc_tax || '0');
      byStatus[s].totalExTax  += parseFloat(o.total_ex_tax  || '0');
    }

    const EXCLUDED = new Set(['Cancelled', 'Refunded', 'Incomplete']);
    const valid = orders.filter(o => !EXCLUDED.has(o.status));

    allOrders.push({
      timezone: tz,
      totalOrders: orders.length,
      validOrders: valid.length,
      revenue_incTax_valid: valid.reduce((s, o)  => s + parseFloat(o.total_inc_tax || '0'), 0).toFixed(2),
      revenue_exTax_valid:  valid.reduce((s, o)  => s + parseFloat(o.total_ex_tax  || '0'), 0).toFixed(2),
      byStatus,
    });
  }

  return allOrders;
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

async function sumCharges(secretKey: string, gte: number, lte: number) {
  let grossCents = 0;
  let netCents = 0;
  let refundedCents = 0;
  let totalOrders = 0;
  let fullyRefunded = 0;
  let partiallyRefunded = 0;
  const byCurrency: Record<string, { gross: number; net: number }> = {};
  let startingAfter: string | null = null;

  while (true) {
    const params = new URLSearchParams({
      'created[gte]': String(gte),
      'created[lte]': String(lte),
      limit: '100',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`${STRIPE_BASE}/charges?${params}`, { headers: stripeHeaders(secretKey) });
    if (!res.ok) {
      const err = await res.text();
      return { error: `Stripe ${res.status}: ${err.slice(0, 200)}` };
    }

    const data = await res.json();
    for (const charge of data.data) {
      if (!(charge.paid && charge.status === 'succeeded')) continue;
      const amount = charge.amount ?? 0;
      const refunded = charge.amount_refunded ?? 0;
      const net = amount - refunded;
      grossCents += amount;
      netCents += net;
      refundedCents += refunded;
      totalOrders++;
      if (refunded > 0 && net === 0) fullyRefunded++;
      else if (refunded > 0) partiallyRefunded++;
      const cur = charge.currency ?? 'unknown';
      if (!byCurrency[cur]) byCurrency[cur] = { gross: 0, net: 0 };
      byCurrency[cur].gross += amount;
      byCurrency[cur].net += net;
    }
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1].id;
  }

  return {
    totalOrders,
    grossAUD: (grossCents / 100).toFixed(2),
    netAUD: (netCents / 100).toFixed(2),
    refundedAUD: (refundedCents / 100).toFixed(2),
    fullyRefundedCharges: fullyRefunded,
    partiallyRefundedCharges: partiallyRefunded,
    byCurrency: Object.fromEntries(
      Object.entries(byCurrency).map(([k, v]) => [k, {
        gross: (v.gross / 100).toFixed(2),
        net: (v.net / 100).toFixed(2),
      }]),
    ),
  };
}

async function debugStripeAccount(label: string, secretKey: string, month: string) {
  if (!secretKey) return { account: label, error: `${label} secret key not set` };

  const { start, end } = monthRange(month);
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year!, mon!, 0).getDate();

  const windows = [
    {
      label: 'Australia/Sydney (dashboard target)',
      gte: zonedDateTimeToUnix(start, '00:00:00'),
      lte: zonedDateTimeToUnix(end, '23:59:59'),
    },
    {
      label: 'UTC calendar month (old Finance /api/revenue)',
      gte: Math.floor(Date.UTC(year!, mon! - 1, 1) / 1000),
      lte: Math.floor(Date.UTC(year!, mon!, 0, 23, 59, 59) / 1000),
    },
    {
      label: 'Fixed UTC+10',
      gte: Math.floor(new Date(`${start}T00:00:00+10:00`).getTime() / 1000),
      lte: Math.floor(new Date(`${end}T23:59:59+10:00`).getTime() / 1000),
    },
    {
      label: 'Fixed UTC+11',
      gte: Math.floor(new Date(`${start}T00:00:00+11:00`).getTime() / 1000),
      lte: Math.floor(new Date(`${end}T23:59:59+11:00`).getTime() / 1000),
    },
  ];

  // MTD through today Sydney
  const todaySydney = new Intl.DateTimeFormat('en-CA', {
    timeZone: ACCOUNT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const mtdEnd = todaySydney.startsWith(month) ? todaySydney : end;

  const results = [];
  for (const w of windows) {
    const sums = await sumCharges(secretKey, w.gte, w.lte);
    results.push({
      timezone: w.label,
      gteUnix: w.gte,
      lteUnix: w.lte,
      gteDate: new Date(w.gte * 1000).toISOString(),
      lteDate: new Date(w.lte * 1000).toISOString(),
      ...sums,
    });
  }

  // MTD Sydney window (matches Overview default)
  const mtdGte = zonedDateTimeToUnix(`${month}-01`, '00:00:00');
  const mtdLte = zonedDateTimeToUnix(mtdEnd, '23:59:59');
  const mtdSums = await sumCharges(secretKey, mtdGte, mtdLte);
  results.push({
    timezone: `Australia/Sydney MTD (${month}-01 → ${mtdEnd})`,
    gteUnix: mtdGte,
    lteUnix: mtdLte,
    gteDate: new Date(mtdGte * 1000).toISOString(),
    lteDate: new Date(mtdLte * 1000).toISOString(),
    ...mtdSums,
  });

  return {
    account: label,
    month,
    daysInMonth: lastDay,
    notes: [
      'Dashboard uses net = amount − amount_refunded on charges created in the window.',
      'Stripe Dashboard "Gross volume" ≈ grossAUD; net may still differ if Stripe reports refunds by refund date.',
      'Fees are never deducted here — compare to Gross/Net volume, not "net after fees".',
    ],
    windows: results,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month')
    ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: ACCOUNT_TZ, year: 'numeric', month: '2-digit',
    }).format(new Date()).slice(0, 7);

  const [bcData, etz, hsc] = await Promise.all([
    debugBC(month),
    debugStripeAccount('ETZ', STRIPE_KEY, month),
    debugStripeAccount('HSC', STRIPE_HSC, month),
  ]);

  return NextResponse.json({
    month,
    explanation: {
      overviewUses: 'dateRange with Australia/Sydney day bounds (MTD by default)',
      financeUses: 'full calendar month via monthUnixRange (now Australia/Sydney; was UTC)',
      commonStripeMismatch: [
        'Timezone: UTC vs Sydney shifts ~$50–$100 near month edges',
        'Gross vs net: Stripe Gross volume excludes refunds from the total differently',
        'Refund timing: amount_refunded reduces the original charge period, not the refund date',
        'Fees: Stripe "net" after fees is lower than charge net',
        'HSC was missing from /api/revenue (Finance tab) — only on Overview',
      ],
    },
    bigcommerce: bcData,
    stripe: { etz, hsc },
  }, { status: 200 });
}
