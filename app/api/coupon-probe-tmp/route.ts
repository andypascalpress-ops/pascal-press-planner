import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// TEMPORARY read-only probe: aggregate counts only (no customer data). Removed once coupon sources are confirmed.
export async function GET() {
  const out: Record<string, unknown> = {};
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  const since = Math.floor(Date.now() / 1000) - 60 * 86400;
  const get = async (path: string) => {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  try {
    const cs = await get(`checkout/sessions?limit=100&created[gte]=${since}&expand[]=data.total_details.breakdown`);
    const sessions = cs.json?.data ?? [];
    out.checkoutSessions = {
      status: cs.status, n: sessions.length,
      withDiscount: sessions.filter((s: any) => (s.total_details?.amount_discount ?? 0) > 0).length,
      hasDiscountsBreakdown: sessions.filter((s: any) => (s.total_details?.breakdown?.discounts ?? []).length > 0).length,
      keys: sessions[0] ? Object.keys(sessions[0]).slice(0, 40) : [],
    };
    const pi = await get(`payment_intents?limit=100&created[gte]=${since}`);
    const pis = pi.json?.data ?? [];
    const metaKeys: Record<string, number> = {};
    for (const p of pis) for (const k of Object.keys(p.metadata ?? {})) metaKeys[k] = (metaKeys[k] ?? 0) + 1;
    out.paymentIntents = { status: pi.status, n: pis.length, metadataKeys: metaKeys };
    const ch = await get(`charges?limit=100&created[gte]=${since}`);
    const chs = ch.json?.data ?? [];
    const cMeta: Record<string, number> = {};
    for (const c of chs) for (const k of Object.keys(c.metadata ?? {})) cMeta[k] = (cMeta[k] ?? 0) + 1;
    out.charges = { status: ch.status, n: chs.length, metadataKeys: cMeta };
    const promo = await get('promotion_codes?limit=100');
    out.promotionCodes = { status: promo.status, n: (promo.json?.data ?? []).length, active: (promo.json?.data ?? []).filter((p: any) => p.active).length, timesRedeemedTotal: (promo.json?.data ?? []).reduce((a: number, p: any) => a + (p.times_redeemed ?? 0), 0) };
    const cp = await get('coupons?limit=100');
    out.coupons = { status: cp.status, n: (cp.json?.data ?? []).length, timesRedeemedTotal: (cp.json?.data ?? []).reduce((a: number, p: any) => a + (p.times_redeemed ?? 0), 0) };
  } catch (e) { out.error = String(e); }
  return NextResponse.json(out);
}
