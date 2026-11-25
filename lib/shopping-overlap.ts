/**
 * Google Shopping overlap between Pascal Press and Excel Study Guides.
 *
 * Both stores advertise Excel titles on Google Shopping from separate Google Ads accounts. When both advertise the
 * same book, the two accounts bid in the same auctions and push each other's click prices up. This module reads
 * product-level Shopping spend from both accounts and pairs products by title (the item ids differ: BigCommerce
 * SKUs on one side, Shopify ids on the other).
 *
 * It also flags products Pascal Press advertises in more than one of its own Shopping campaigns.
 */
import { buildConfig, runGaqlQuery } from '@/lib/google-ads';

export interface ProductSpend {
  itemId: string;
  title: string;
  campaigns: string[];
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  convValue: number;
}

export interface OverlapPair {
  pp: ProductSpend;
  esg: ProductSpend;
  match: 'exact' | 'close';
}

export interface ShoppingOverlap {
  period: { start: string; end: string };
  pp: { totalCost: number; products: number; error: string | null };
  esg: { totalCost: number; products: number; error: string | null };
  pairs: OverlapPair[];
  overlapCost: { pp: number; esg: number };
  /** Pascal Press products running in two or more of its own Shopping campaigns. */
  ppInternal: { title: string; campaigns: { name: string; cost: number }[]; cost: number }[];
  ppInternalCost: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'with', 'by', 'excel', 'edition', 'ed', 'new', 'book', 'books']);
function tokens(title: string): string[] {
  return title.toLowerCase().replace(/&/g, ' and ').replace(/\*/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t && !STOP.has(t));
}
const key = (title: string) => tokens(title).join(' ');
function similarity(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}
/** Year levels and pack words must agree, or "Year 5" would pair with "Year 6". */
function compatible(a: string[], b: string[]): boolean {
  const nums = (t: string[]) => t.filter(x => /^\d+$/.test(x)).sort().join(',');
  const pack = (t: string[]) => t.includes('pack');
  return nums(a) === nums(b) && pack(a) === pack(b);
}

async function productSpend(brand: 'pp' | 'esg', start: string, end: string): Promise<{ rows: Map<string, ProductSpend>; byCampaign: Map<string, Map<string, number>> }> {
  const cfg = buildConfig(brand);
  const raw = await runGaqlQuery(cfg, `
    SELECT segments.product_item_id, segments.product_title, campaign.name,
           metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value
    FROM shopping_performance_view
    WHERE segments.date BETWEEN '${start}' AND '${end}' AND metrics.impressions > 0`);
  const rows = new Map<string, ProductSpend>();
  const byCampaign = new Map<string, Map<string, number>>();
  for (const r of raw) {
    const itemId = String(r.segments?.productItemId ?? '').toLowerCase();
    const title = String(r.segments?.productTitle ?? '').trim() || itemId;
    const campaign = String(r.campaign?.name ?? '');
    const cost = Number(r.metrics?.costMicros ?? 0) / 1e6;
    const p = rows.get(itemId) ?? { itemId, title, campaigns: [], cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };
    p.cost += cost;
    p.clicks += Number(r.metrics?.clicks ?? 0);
    p.impressions += Number(r.metrics?.impressions ?? 0);
    p.conversions += Number(r.metrics?.conversions ?? 0);
    p.convValue += Number(r.metrics?.conversionsValue ?? 0);
    if (campaign && !p.campaigns.includes(campaign)) p.campaigns.push(campaign);
    rows.set(itemId, p);
    const cm = byCampaign.get(itemId) ?? new Map<string, number>();
    cm.set(campaign, (cm.get(campaign) ?? 0) + cost);
    byCampaign.set(itemId, cm);
  }
  for (const p of rows.values()) { p.cost = r2(p.cost); p.convValue = r2(p.convValue); p.conversions = Math.round(p.conversions * 10) / 10; }
  return { rows, byCampaign };
}

export async function fetchShoppingOverlap(start: string, end: string): Promise<ShoppingOverlap> {
  const [ppRes, esgRes] = await Promise.allSettled([productSpend('pp', start, end), productSpend('esg', start, end)]);
  const err = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 240) : null);
  const pp = ppRes.status === 'fulfilled' ? ppRes.value : { rows: new Map<string, ProductSpend>(), byCampaign: new Map<string, Map<string, number>>() };
  const esg = esgRes.status === 'fulfilled' ? esgRes.value : { rows: new Map<string, ProductSpend>(), byCampaign: new Map<string, Map<string, number>>() };

  // pair each ESG product with its closest Pascal Press product (one-to-one, best matches first)
  const ppList = [...pp.rows.values()].map(p => ({ p, t: tokens(p.title), k: key(p.title) }));
  const candidates: { pp: ProductSpend; esg: ProductSpend; score: number; match: 'exact' | 'close' }[] = [];
  for (const e of esg.rows.values()) {
    const et = tokens(e.title), ek = key(e.title);
    for (const x of ppList) {
      if (x.k === ek && ek) { candidates.push({ pp: x.p, esg: e, score: 2, match: 'exact' }); continue; }
      if (!compatible(x.t, et)) continue;
      const s = similarity(x.t, et);
      if (s >= 0.75) candidates.push({ pp: x.p, esg: e, score: s, match: 'close' });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedPp = new Set<string>(), usedEsg = new Set<string>();
  const pairs: OverlapPair[] = [];
  for (const c of candidates) {
    if (usedPp.has(c.pp.itemId) || usedEsg.has(c.esg.itemId)) continue;
    usedPp.add(c.pp.itemId); usedEsg.add(c.esg.itemId);
    pairs.push({ pp: c.pp, esg: c.esg, match: c.match });
  }
  pairs.sort((a, b) => (b.pp.cost + b.esg.cost) - (a.pp.cost + a.esg.cost));

  const ppInternal = [...pp.byCampaign.entries()]
    .filter(([, m]) => [...m.values()].filter(v => v > 0).length >= 2)
    .map(([id, m]) => ({ title: pp.rows.get(id)?.title ?? id, campaigns: [...m.entries()].filter(([, v]) => v > 0).map(([name, cost]) => ({ name, cost: r2(cost) })).sort((a, b) => b.cost - a.cost), cost: r2([...m.values()].reduce((s, v) => s + v, 0)) }))
    .sort((a, b) => b.cost - a.cost);

  const sum = (m: Map<string, ProductSpend>) => r2([...m.values()].reduce((s, p) => s + p.cost, 0));
  return {
    period: { start, end },
    pp: { totalCost: sum(pp.rows), products: pp.rows.size, error: err(ppRes) },
    esg: { totalCost: sum(esg.rows), products: esg.rows.size, error: err(esgRes) },
    pairs,
    overlapCost: { pp: r2(pairs.reduce((s, x) => s + x.pp.cost, 0)), esg: r2(pairs.reduce((s, x) => s + x.esg.cost, 0)) },
    ppInternal: ppInternal.slice(0, 40),
    ppInternalCost: r2(ppInternal.reduce((s, x) => s + x.cost, 0)),
  };
}
