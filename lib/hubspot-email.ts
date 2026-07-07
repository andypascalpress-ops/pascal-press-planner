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
  id:               string;
  name:             string;
  subject:          string;
  fromName:         string;
  sentAt:           string | null;
  sends:            number;
  delivered:        number;
  opens:            number;
  clicks:           number;
  unsubscribes:     number;
  openRate:         number; // 0–1
  clickRate:        number; // 0–1
  clickToOpen:      number; // 0–1
  hsCampaignName:   string; // v1 campaign name — matches GA4 utm_campaign
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
  publishDate?:            string | number; // HubSpot may return ISO string OR Unix ms timestamp
  primaryEmailCampaignId?: string;
}

interface V1Counters {
  sent?:         number;
  delivered?:    number;
  open?:         number;
  click?:        number;
  unsubscribed?: number;
}

interface V1CampaignData {
  name?:     string;
  counters?: V1Counters;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a HubSpot publishDate (ISO string OR Unix ms timestamp as number/string)
 * to "YYYY-MM" in AEST (UTC+10). Returns '' if unparseable.
 */
function toAESTYearMonth(publishDate: string | number | undefined | null): string {
  if (publishDate == null) return '';
  let ts: number;
  if (typeof publishDate === 'number') {
    ts = publishDate;
  } else if (/^\d{10,}$/.test(publishDate)) {
    ts = parseInt(publishDate, 10);
  } else {
    ts = new Date(publishDate).getTime();
  }
  if (isNaN(ts)) return '';
  const d = new Date(ts + 10 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Convert a HubSpot publishDate to "YYYY-MM-DD" in AEST. Returns '' if unparseable. */
function toAESTDate(publishDate: string | number | undefined | null): string {
  if (publishDate == null) return '';
  let ts: number;
  if (typeof publishDate === 'number') {
    ts = publishDate;
  } else if (/^\d{10,}$/.test(publishDate)) {
    ts = parseInt(publishDate, 10);
  } else {
    ts = new Date(publishDate).getTime();
  }
  if (isNaN(ts)) return '';
  const d = new Date(ts + 10 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ─── API calls ───────────────────────────────────────────────────────────────

/** Fetch one page of PUBLISHED marketing emails. */
async function fetchEmailPage(
  after?: string,
): Promise<{ results: HsEmailRow[]; next?: string }> {
  const params = new URLSearchParams({
    limit:      '50',
    state:      'PUBLISHED',
    sort:       '-publishDate',
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
async function fetchCampaignStats(campaignId: string): Promise<V1CampaignData | null> {
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
    return {
      name:     data.name     as string | undefined,
      counters: data.counters as V1Counters | undefined,
    };
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
): Promise<Map<string, V1CampaignData>> {
  const map = new Map<string, V1CampaignData>();
  const BATCH = 10;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async r => ({
        id:   r.id,
        data: r.primaryEmailCampaignId
          ? await fetchCampaignStats(r.primaryEmailCampaignId)
          : null,
      })),
    );
    for (const { id, data } of results) {
      if (data) map.set(id, data);
    }
  }

  return map;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all sent marketing email campaigns, optionally filtered to a YYYY-MM month.
 * Statistics are fetched via the v1 email campaigns API (counters endpoint).
 */
export async function fetchEmailCampaigns(
  month?: string,
  options?: { dateRange?: { start: string; end: string } },
): Promise<EmailSummary> {
  if (!process.env.HUBSPOT_API_KEY) {
    return {
      campaigns:   [], connected: false, statsLoaded: false,
      totalSends:  0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }

  const dr = options?.dateRange;

  try {
    // Step 1: fetch PUBLISHED email list with early-exit when a filter is specified.
    // Emails are sorted newest-first (-publishDate).
    let after: string | undefined;
    const allRows: HsEmailRow[] = [];
    do {
      const page = await fetchEmailPage(after);
      const rows = page.results;
      if (dr) {
        // Date-range mode: include rows whose AEST date falls within [start, end]
        for (const r of rows) {
          const d = toAESTDate(r.publishDate);
          if (d >= dr.start && d <= dr.end) allRows.push(r);
        }
        // Early exit: stop once the last row in this page is older than our start
        const lastDate = toAESTDate(rows[rows.length - 1]?.publishDate);
        if (lastDate && lastDate < dr.start) break;
      } else if (month) {
        for (const r of rows) {
          if (toAESTYearMonth(r.publishDate) === month) allRows.push(r);
        }
        // Early exit: stop once we reach rows older than the target month
        const lastYM = toAESTYearMonth(rows[rows.length - 1]?.publishDate);
        if (lastYM && lastYM < month) break;
      } else {
        allRows.push(...rows);
      }
      after = page.next;
    } while (after && allRows.length < 2000);

    // Step 2: sort (all rows are already filtered to the target month above)
    const filtered = allRows;

    filtered.sort((a, b) =>
      (b.publishDate ?? '').localeCompare(a.publishDate ?? ''),
    );

    // Step 3: fetch stats — cap at 100 rows to stay within Edge Runtime timeout
    const forStats = filtered.slice(0, 100);
    const statsMap = await fetchStatsForRows(forStats);
    const statsLoaded = statsMap.size > 0;

    // Step 4: build campaign objects
    const campaigns: EmailCampaignStats[] = filtered.map(r => {
      const d      = statsMap.get(r.id) ?? {};
      const c      = d.counters ?? {};
      const sends  = c.sent        ?? 0;
      const deliv  = c.delivered   ?? sends;
      const opens  = c.open        ?? 0;
      const clicks = c.click       ?? 0;
      const unsubs = c.unsubscribed ?? 0;

      return {
        id:             r.id,
        name:           r.name     ?? '(Untitled)',
        subject:        r.subject  ?? '',
        fromName:       r.fromName ?? '',
        sentAt:         r.publishDate ?? null,
        sends,
        delivered:      deliv,
        opens,
        clicks,
        unsubscribes:   unsubs,
        openRate:       safeDiv(opens,  deliv),
        clickRate:      safeDiv(clicks, deliv),
        clickToOpen:    safeDiv(clicks, opens),
        hsCampaignName: d.name ?? '',
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
