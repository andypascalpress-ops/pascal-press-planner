/**
 * GET /api/meta-campaign-performance?month=YYYY-MM
 *
 * Per Meta campaign for Pascal Press and Excel Test Zone: what it spent (Meta) and the sales Google Analytics credits to it
 * (paid Facebook / Instagram sessions). A Google Analytics campaign name is matched to a Meta campaign by its ID, its name, or
 * the utm_campaign tag its ads send. Tags that match no campaign are returned as `unmatched`, so no revenue is lost.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMetaCampaigns, fetchEtzMetaCampaigns, fetchMetaCampaignUtmTags, fetchMetaAdsets, fetchEtzMetaAdsets, type MetaAdset,
  META_PP_ACCOUNT_ID, META_ETZ_ACCOUNT_ID, META_ETZ_OWN_ACCOUNT_ID, type MetaCampaign,
} from '@/lib/meta-ads';
import { fetchFacebookCampaignRevenue } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const r2 = (n: number) => Math.round(n * 100) / 100;

function build(campaigns: MetaCampaign[], tags: Record<string, string[]>, adsets: MetaAdset[], ga: { campaign: string; sessions: number; orders: number; revenue: number }[]) {
  type Sub = { name: string; spend: number; revenue: number; orders: number; sessions: number };
  type Row = { id: string; name: string; spend: number; clicks: number; revenue: number; orders: number; sessions: number; tags: string[]; roas: number | null; adsets: Sub[] };
  const rows: Row[] = campaigns.map(c => ({ id: c.id, name: c.name, spend: r2(c.spend), clicks: c.clicks, revenue: 0, orders: 0, sessions: 0, tags: [], roas: null, adsets: [] }));
  // names a Google Analytics campaign could carry for each Meta campaign: its ID, its name, or the tags its ads use ({{campaign.id}} / {{campaign.name}} macros resolved)
  const keys = campaigns.map(c => {
    const set = new Set<string>([norm(c.id), norm(c.name)]);
    for (const t of tags[c.id] ?? []) {
      if (/\{\{\s*campaign\.id\s*\}\}/i.test(t)) set.add(norm(c.id));
      else if (/\{\{\s*campaign\.name\s*\}\}/i.test(t)) set.add(norm(c.name));
      else if (!t.includes('{{')) set.add(norm(t));
    }
    return set;
  });
  const unmatched: { tag: string; sessions: number; orders: number; revenue: number }[] = [];
  for (const g of ga) {
    const k = norm(g.campaign);
    const i = k ? keys.findIndex(set => set.has(k)) : -1;
    if (i >= 0) {
      rows[i]!.revenue = r2(rows[i]!.revenue + g.revenue); rows[i]!.orders += g.orders; rows[i]!.sessions += g.sessions;
      if (!rows[i]!.tags.includes(g.campaign)) rows[i]!.tags.push(g.campaign);
    } else if (k && adsets.some(a => norm(a.adsetName) === k)) {
      // the Google Analytics campaign name is an ad set name: add it to that ad set's campaign and keep the ad set as a sub-line
      const a = adsets.find(x => norm(x.adsetName) === k)!;
      const idx = rows.findIndex(r => r.id === a.campaignId);
      if (idx >= 0) {
        const row = rows[idx]!;
        row.revenue = r2(row.revenue + g.revenue); row.orders += g.orders; row.sessions += g.sessions;
        const same = adsets.filter(x => x.campaignId === a.campaignId && norm(x.adsetName) === k);
        row.adsets.push({ name: a.adsetName, spend: r2(same.reduce((t, x) => t + x.spend, 0)), revenue: g.revenue, orders: g.orders, sessions: g.sessions });
      } else unmatched.push({ tag: g.campaign || '(not set)', sessions: g.sessions, orders: g.orders, revenue: g.revenue });
    } else if (g.revenue > 0 || g.sessions >= 20) {
      unmatched.push({ tag: g.campaign || '(not set)', sessions: g.sessions, orders: g.orders, revenue: g.revenue });
    }
  }
  for (const r of rows) r.roas = r.spend > 0 && r.revenue > 0 ? Math.round((r.revenue / r.spend) * 10) / 10 : null;
  const shown = rows.filter(r => r.spend > 0 || r.revenue > 0).sort((a, b) => b.spend - a.spend);
  return {
    campaigns: shown,
    unmatched,
    totals: { spend: r2(rows.reduce((a, r) => a + r.spend, 0)), revenue: r2(ga.reduce((a, g) => a + g.revenue, 0)), orders: ga.reduce((a, g) => a + g.orders, 0) },
  };
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const now = new Date();
  const current = y === now.getFullYear() && m === now.getMonth() + 1;
  const start = `${month}-01`, end = `${month}-${String(current ? Math.min(lastDay, now.getDate()) : lastDay).padStart(2, '0')}`;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };
  const [ppCamps, etzCamps, ppTags, etzTagsOwn, etzTagsShared, ppAdsets, etzAdsets, ppGa, etzGa] = await Promise.all([
    safe(fetchMetaCampaigns(META_PP_ACCOUNT_ID, start, end, { excludes: 'ETZ' }), [] as MetaCampaign[]),
    safe(fetchEtzMetaCampaigns(start, end), [] as MetaCampaign[]),
    safe(fetchMetaCampaignUtmTags(META_PP_ACCOUNT_ID), {} as Record<string, string[]>),
    safe(fetchMetaCampaignUtmTags(META_ETZ_OWN_ACCOUNT_ID), {} as Record<string, string[]>),
    safe(fetchMetaCampaignUtmTags(META_ETZ_ACCOUNT_ID), {} as Record<string, string[]>),
    safe(fetchMetaAdsets(META_PP_ACCOUNT_ID, start, end, { excludes: 'ETZ' }), [] as MetaAdset[]),
    safe(fetchEtzMetaAdsets(start, end), [] as MetaAdset[]),
    fetchFacebookCampaignRevenue(start, end, 'pp'),
    fetchFacebookCampaignRevenue(start, end, 'etz'),
  ]);
  return NextResponse.json({
    month, range: { start, end },
    pp: build(ppCamps, ppTags, ppAdsets, ppGa),
    etz: build(etzCamps, { ...etzTagsShared, ...etzTagsOwn }, etzAdsets, etzGa),
  }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' } });
}
