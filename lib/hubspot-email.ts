/**
 * HubSpot Marketing Email API client
 * Requires: HUBSPOT_API_KEY (Private App token, pat-...)
 * Scopes needed: content, marketing-email (read)
 *
 * Docs: https://developers.hubspot.com/docs/api/marketing/marketing-emails
 */

const HS_BASE = 'https://api.hubapi.com';

function getApiKey(): string {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) throw new Error('HUBSPOT_API_KEY env var is not set');
  return key;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailCampaignStats {
  id:            string;
  name:          string;
  subject:       string;
  fromName:      string;
  sentAt:        string | null; // ISO date
  sends:         number;
  delivered:     number;
  opens:         number;
  clicks:        number;
  unsubscribes:  number;
  openRate:      number; // 0–1
  clickRate:     number; // 0–1
  clickToOpen:   number; // 0–1
}

export interface EmailSummary {
  campaigns:    EmailCampaignStats[];
  connected:    boolean;
  totalSends:   number;
  totalOpens:   number;
  totalClicks:  number;
  avgOpenRate:  number;
  avgClickRate: number;
  statsLoaded:  boolean; // false if statistics endpoint failed
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 1000) / 1000 : 0;
}

// Normalise counters from various possible HubSpot response shapes
function extractCounters(item: Record<string, unknown>) {
  // Try: item.statistics.counters, item.stats.counters, item.counters
  const stats  = (item.statistics ?? item.stats ?? {}) as Record<string, unknown>;
  const counters = (stats.counters ?? stats) as Record<string, unknown>;
  return {
    sent:          (counters.sent          as number) ?? 0,
    delivered:     (counters.delivered     as number) ?? 0,
    open:          (counters.open          as number) ?? 0,
    click:         (counters.click         as number) ?? 0,
    unsubscribed:  (counters.unsubscribed  as number) ?? 0,
  };
}

// ─── API calls ───────────────────────────────────────────────────────────────

interface HsEmailRow {
  id:             string;
  name?:          string;
  subject?:       string;
  fromName?:      string;
  publishDate?:   string;
  sendOnPublish?: boolean;
}

/** Fetch one page of email list (no statistics — keeps the call fast). */
async function fetchEmailPage(
  after?: string,
): Promise<{ results: HsEmailRow[]; next?: string }> {
  const params = new URLSearchParams({
    limit:      '50',
    properties: 'name,subject,fromName,publishDate,sendOnPublish',
  });
  if (after) params.set('after', after);

  const res = await fetch(`${HS_BASE}/marketing/v3/emails?${params}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    next: { revalidate: 300 }, // 5-min server-side cache
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot list error (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    results: data.results ?? [],
    next:    data.paging?.next?.after,
  };
}

/**
 * Fetch statistics for a batch of email IDs via the v3 statistics/query endpoint.
 * Returns a Map of { emailId → counters }.
 */
async function fetchStatsBatch(ids: string[]): Promise<Map<string, ReturnType<typeof extractCounters>>> {
  const map = new Map<string, ReturnType<typeof extractCounters>>();
  if (ids.length === 0) return map;

  try {
    const res = await fetch(`${HS_BASE}/marketing/v3/emails/statistics/query`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
      next: { revalidate: 300 },
    });

    if (!res.ok) return map; // silently return empty — list still renders without stats

    const data = await res.json();
    for (const item of (data.results ?? []) as Record<string, unknown>[]) {
      if (typeof item.id === 'string') {
        map.set(item.id, extractCounters(item));
      }
    }
  } catch {
    // Statistics unavailable — gracefully degrade to 0s
  }

  return map;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all sent marketing email campaigns, optionally filtered to a YYYY-MM month.
 */
export async function fetchEmailCampaigns(month?: string): Promise<EmailSummary> {
  if (!process.env.HUBSPOT_API_KEY) {
    return {
      campaigns:   [], connected: false, statsLoaded: false,
      totalSends:  0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }

  try {
    // ── Step 1: fetch email list (fast, cached) ──────────────────────────────
    let after: string | undefined;
    const allRows: HsEmailRow[] = [];
    do {
      const page = await fetchEmailPage(after);
      allRows.push(...page.results);
      after = page.next;
    } while (after && allRows.length < 500);

    // ── Step 2: fetch statistics batch (slower, also cached) ─────────────────
    const statsMap = await fetchStatsBatch(allRows.map(r => r.id));
    const statsLoaded = statsMap.size > 0;

    // ── Step 3: filter + sort + map ──────────────────────────────────────────
    const rows = month
      ? allRows.filter(r => r.publishDate?.startsWith(month))
      : allRows;

    rows.sort((a, b) =>
      (b.publishDate ?? '').localeCompare(a.publishDate ?? ''),
    );

    const campaigns: EmailCampaignStats[] = rows.map(r => {
      const c      = statsMap.get(r.id) ?? { sent: 0, delivered: 0, open: 0, click: 0, unsubscribed: 0 };
      const sends  = c.sent;
      const deliv  = c.delivered || sends;
      const opens  = c.open;
      const clicks = c.click;
      const unsubs = c.unsubscribed;

      return {
        id:           r.id,
        name:         r.name     ?? '(Untitled)',
        subject:      r.subject  ?? '',
        fromName:     r.fromName ?? '',
        sentAt:       r.publishDate ?? null,
        sends,
        delivered:    deliv,
        opens,
        clicks,
        unsubscribes: unsubs,
        openRate:     safeDiv(opens,  deliv),
        clickRate:    safeDiv(clicks, deliv),
        clickToOpen:  safeDiv(clicks, opens),
      };
    });

    const totalSends  = campaigns.reduce((s, c) => s + c.sends,  0);
    const totalOpens  = campaigns.reduce((s, c) => s + c.opens,  0);
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);

    return {
      campaigns,
      connected:    true,
      statsLoaded,
      totalSends,
      totalOpens,
      totalClicks,
      avgOpenRate:  safeDiv(totalOpens,  totalSends),
      avgClickRate: safeDiv(totalClicks, totalSends),
    };
  } catch (err) {
    console.error('[hubspot-email fetchEmailCampaigns]', err);
    return {
      campaigns:   [], connected: false, statsLoaded: false,
      totalSends:  0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }
}
