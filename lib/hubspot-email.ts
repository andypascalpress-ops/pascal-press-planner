/**
 * HubSpot Marketing Email API client
 * Requires: HUBSPOT_API_KEY (Private App token, pat-...)
 * Scopes needed: marketing-emails (read)
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
  campaigns:   EmailCampaignStats[];
  connected:   boolean;
  totalSends:  number;
  totalOpens:  number;
  totalClicks: number;
  avgOpenRate: number;
  avgClickRate: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 1000) / 1000 : 0;
}

// ─── API calls ───────────────────────────────────────────────────────────────

interface HsEmailRow {
  id:         string;
  name?:      string;
  subject?:   string;
  fromName?:  string;
  publishDate?: string;
  sendOnPublish?: boolean;
  statistics?: {
    counters?: {
      sent?:          number;
      delivered?:     number;
      open?:          number;
      click?:         number;
      unsubscribed?:  number;
    };
  };
}

async function fetchEmailPage(after?: string): Promise<{ results: HsEmailRow[]; next?: string }> {
  const params = new URLSearchParams({
    limit: '50',
    properties: 'name,subject,fromName,publishDate,sendOnPublish,statistics',
  });
  if (after) params.set('after', after);

  const res = await fetch(`${HS_BASE}/marketing/v3/emails?${params}`, {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 300 }, // 5-min server-side cache
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot API error (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    results: data.results ?? [],
    next:    data.paging?.next?.after,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all sent marketing email campaigns, optionally filtered to a YYYY-MM month.
 */
export async function fetchEmailCampaigns(month?: string): Promise<EmailSummary> {
  if (!process.env.HUBSPOT_API_KEY) {
    return {
      campaigns: [], connected: false,
      totalSends: 0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }

  try {
    // Fetch all pages (usually 1–3 pages for most accounts)
    let after: string | undefined;
    const allRows: HsEmailRow[] = [];
    do {
      const page = await fetchEmailPage(after);
      allRows.push(...page.results);
      after = page.next;
    } while (after && allRows.length < 500);

    // Filter to requested month if provided
    const rows = month
      ? allRows.filter(r => {
          const d = r.publishDate;
          return d && d.startsWith(month);
        })
      : allRows;

    // Sort newest first
    rows.sort((a, b) => {
      const da = a.publishDate ?? '';
      const db = b.publishDate ?? '';
      return db.localeCompare(da);
    });

    const campaigns: EmailCampaignStats[] = rows.map(r => {
      const c      = r.statistics?.counters ?? {};
      const sends  = c.sent       ?? 0;
      const deliv  = c.delivered  ?? sends;
      const opens  = c.open       ?? 0;
      const clicks = c.click      ?? 0;
      const unsubs = c.unsubscribed ?? 0;

      return {
        id:           r.id,
        name:         r.name    ?? '(Untitled)',
        subject:      r.subject ?? '',
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
      totalSends,
      totalOpens,
      totalClicks,
      avgOpenRate:  safeDiv(totalOpens,  totalSends),
      avgClickRate: safeDiv(totalClicks, totalSends),
    };
  } catch (err) {
    console.error('[hubspot-email fetchEmailCampaigns]', err);
    return {
      campaigns: [], connected: false,
      totalSends: 0, totalOpens: 0, totalClicks: 0,
      avgOpenRate: 0, avgClickRate: 0,
    };
  }
}
