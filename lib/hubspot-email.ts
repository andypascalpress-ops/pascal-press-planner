/**
 * HubSpot Marketing Email API client
 * Requires: HUBSPOT_API_KEY (Private App token, pat-...)
 * Scopes needed: content, marketing-email (read)
 *
 * Statistics: fetched via GET /email/public/v1/campaigns/{primaryEmailCampaignId}
 * Confirmed working 2026-07: returns counters.sent/delivered/open/click/unsubscribed
 */

const HS_BASE = 'https://api.hubapi.com';

function getApiKey(): string {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) throw new Error('HUBSPOT_API_KEY env var is not set');
  return key;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailCampaignStats {
  id:           string;
  name:         string;
  subject:      string;
  fromName:     string;
  sentAt:       string | null;
  sends:        number;
  delivered:    number;
  opens:        number;
  clicks:       number;
  unsubscribes: number;
  openRate:     number; // 0–1
  clickRate:    number; // 0–1
  clickToOpen:  number; // 0–1
}

export interface EmailSummary {
  campaigns:    EmailCampaignStats[];
  connected:    boolean;
  totalSends:   number;
  totalOpens:   number;
  totalClicks:  number;
  avgOpenRate:  number;
  avgClickRate: number;
  statsLoaded:  boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 1000) / 1000 : 0;
}

// ─── API types ────────────────────────────────────────────────────────────────

interface HsEmailRow {
  id:                      string;
  name?:                   string;
  subject?:                string;
  fromName?:               string;
  publishDate?:            string;
  primaryEmailCampaignId?: string;
}

interface V1Counters {
  sent?:         number;
  delivered?:    number;
  open?:         number;
  click?:        number;
  unsubscribed?: number;
}

// ─── API calls ───────────────────────────────────────────────────────────────

/** Fetch one page of PUBLISHED marketing emails. */
async function fetchEmailPage(
  after?: string,
): Promise<{ results: HsEmailRow[]; next?: string }> {
  const params = new URLSearchParams({
    limit:      '50',
    state:      'PUBLISHED',
    properties: 'name,subject,fromName,publishDate,primaryEmailCampaignId',
  });
  if (after) params.set('after', after);

  const res = await fetch(`${HS_BASE}/marketing/v3/emails?${params}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    next: { revalidate: 300 },
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
 * Fetch v1 campaign statistics for a single email.
 * Uses GET /email/public/v1/campaigns/{primaryEmailCampaignId}
 * Returns counters or null on failure.
 */
async function fetchCampaignStats(campaignId: string): Promise<V1Counters | null> {
  try {
    const res = await fetch(
      `${HS_BASE}/email/public/v1/campaigns/${campaignId}`,
      {
        headers: { Authorization: `Bearer ${getApiKey()}` },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.counters as V1Counters) ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch-fetch stats for a set of email rows, 10 at a time in parallel.
 * Returns a Map keyed by v3 email ID.
 */
async function fetchStatsForRows(
  rows: HsEmailRow[],
): Promise<Map<string, V1Counters>> {
  const map = new Map<string, V1Counters>();
  const BATCH = 10;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async r => ({
        id:       r.id,
        counters: r.primaryEmailCampaignId
          ? await fetchCampaignStats(r.primaryEmailCampaignId)
          : null,
      })),
    );
    for (const { id, counters } of results) {
      if (counters) map.set(id, counters);
    }
  }

  return map;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all sent marketing email campaigns, optionally filtered to a YYYY-MM month.
 * Statistics are fetched via the v1 email campaigns API (counters endpoint).
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
    // Step 1: fetch PUBLISHED email list (fast, cached)
    let after: string | undefined;
    const allRows: HsEmailRow[] = [];
    do {
      const page = await fetchEmailPage(after);
      allRows.push(...page.results);
      after = page.next;
    } while (after && allRows.length < 500);

    // Step 2: filter + sort
    const filtered = month
      ? allRows.filter(r => r.publishDate?.startsWith(month))
      : allRows;

    filtered.sort((a, b) =>
      (b.publishDate ?? '').localeCompare(a.publishDate ?? ''),
    );

    // Step 3: fetch stats — cap at 100 rows to stay within Edge Runtime timeout
    const forStats = filtered.slice(0, 100);
    const statsMap = await fetchStatsForRows(forStats);
    const statsLoaded = statsMap.size > 0;

    // Step 4: build campaign objects
    const campaigns: EmailCampaignStats[] = filtered.map(r => {
      const c      = statsMap.get(r.id) ?? {};
      const sends  = c.sent        ?? 0;
      const deliv  = c.delivered   ?? sends;
      const opens  = c.open        ?? 0;
      const clicks = c.click       ?? 0;
      const unsubs = c.unsubscribed ?? 0;

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
    console.error('[hubspot-email]', err);
    return {
      campaigns:   [], connected: false, statsLoaded: false,
      totalSends:  0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }
}
