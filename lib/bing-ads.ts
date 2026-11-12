/**
 * Microsoft Advertising (Bing Ads) Reporting API client
 *
 * Required env vars (same as the gads-mcp Python server):
 *   BING_ADS_CLIENT_ID         — Azure app client ID
 *   BING_ADS_CLIENT_SECRET     — Azure app client secret
 *   BING_ADS_REFRESH_TOKEN     — long-lived OAuth2 refresh token
 *   BING_ADS_DEVELOPER_TOKEN   — Microsoft Advertising developer token
 *   BING_ADS_ACCOUNT_ID        — Advertising account ID (not the merchant store ID)
 *   BING_ADS_CUSTOMER_ID       — Customer ID in Microsoft Advertising
 *
 * Uses the SOAP Reporting API v13:
 *   1. SubmitGenerateReport  → reportRequestId
 *   2. PollGenerateReport    → polls until Success, gets download URL
 *   3. Download ZIP → extract CSV → parse spend by month
 */

import { inflateRawSync } from 'zlib';

const REPORTING_ENDPOINT =
  'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';
const REPORTING_NS = 'https://bingads.microsoft.com/Reporting/v13';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const MONTH_NAMES: Record<string, string> = {
  '01': 'January',  '02': 'February', '03': 'March',
  '04': 'April',    '05': 'May',       '06': 'June',
  '07': 'July',     '08': 'August',    '09': 'September',
  '10': 'October',  '11': 'November',  '12': 'December',
};

// Module-level token cache (survives across requests on the same instance)
const _tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Trim whitespace and any quotes or line breaks that came in when the value was pasted. */
const cleanEnv = (v: string | undefined) => (v ?? '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[\r\n]/g, '');

async function getAccessToken(): Promise<string> {
  const clientId = cleanEnv(process.env.BING_ADS_CLIENT_ID);
  if (!clientId) throw new Error('BING_ADS_CLIENT_ID is not set');

  const cached = _tokenCache.get(clientId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const secret = cleanEnv(process.env.BING_ADS_CLIENT_SECRET);
  const refresh = cleanEnv(process.env.BING_ADS_REFRESH_TOKEN);
  // lengths only, never the values, so a wrong or cut-off paste can be spotted
  const shape = `client_id ${clientId.length} chars, secret ${secret ? secret.length + ' chars' : 'missing'}, refresh token ${refresh ? refresh.length + ' chars' : 'missing'}`;
  if (!refresh) throw new Error(`BING_ADS_REFRESH_TOKEN is not set (${shape})`);

  const attempt = async (withScope: boolean) => {
    const body = new URLSearchParams({ client_id: clientId, refresh_token: refresh, grant_type: 'refresh_token' });
    if (secret) body.set('client_secret', secret);                        // public client apps have no secret
    if (withScope) body.set('scope', 'https://ads.microsoft.com/msads.manage offline_access');
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' });
    return { res, data: await res.json() as Record<string, unknown> };
  };

  let { res, data } = await attempt(true);
  if (!data.access_token) ({ res, data } = await attempt(false));         // a different scope than the one the token was issued for can also be rejected
  if (!data.access_token) {
    const code = String(data.error ?? ''), desc = String(data.error_description ?? '').split(/[\r\n]/)[0]!.slice(0, 160);
    throw new Error(`Bing Ads OAuth failed (HTTP ${res.status}) ${code}: ${desc} [${shape}]`);
  }
  const ttl = ((data.expires_in as number ?? 3600) - 60) * 1000;
  _tokenCache.set(clientId, { token: data.access_token as string, expiresAt: Date.now() + ttl });
  return data.access_token as string;
}

function buildEnvelope(action: string, bodyContent: string, token: string): string {
  const accountId  = process.env.BING_ADS_ACCOUNT_ID!;
  const customerId = process.env.BING_ADS_CUSTOMER_ID!;
  const devToken   = process.env.BING_ADS_DEVELOPER_TOKEN!;
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <s:Header xmlns="${REPORTING_NS}">
    <Action mustUnderstand="1">${action}</Action>
    <AuthenticationToken>${token}</AuthenticationToken>
    <CustomerAccountId>${accountId}</CustomerAccountId>
    <CustomerId>${customerId}</CustomerId>
    <DeveloperToken>${devToken}</DeveloperToken>
  </s:Header>
  <s:Body>${bodyContent}</s:Body>
</s:Envelope>`;
}

async function soapCall(action: string, bodyContent: string, token: string): Promise<string> {
  const res = await fetch(REPORTING_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction:     `"${action}"`,   // Microsoft expects the plain operation name, not a full URL
    },
    body:  buildEnvelope(action, bodyContent, token),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok || text.includes('<s:Fault>')) {
    // pull out just the error codes and messages so the reason is readable
    const pick = (tag: string) => Array.from(text.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))).map(m => m[1]).filter(Boolean).slice(0, 3).join('; ');
    const detail = [pick('Code'), pick('ErrorCode'), pick('Message'), pick('Details')].filter(Boolean).join(' | ');
    throw new Error(`Bing Ads ${action} error (HTTP ${res.status}): ${detail || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return text;
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<`, 'i'));
  const raw = m?.[1]?.trim() ?? '';
  return raw
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractFirstFileFromZip(data: Buffer): string {
  // Check for ZIP local-file-header magic (PK\x03\x04)
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 0x03 || data[3] !== 0x04) {
    return data.toString('utf-8');
  }
  const compressionMethod = data.readUInt16LE(8);
  const compressedSize    = data.readUInt32LE(18);
  const fileNameLen       = data.readUInt16LE(26);
  const extraLen          = data.readUInt16LE(28);
  const dataOffset        = 30 + fileNameLen + extraLen;
  const compressed        = data.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) return compressed.toString('utf-8');  // Stored
  if (compressionMethod === 8) return inflateRawSync(compressed).toString('utf-8');  // DEFLATE
  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

function parseReportCsv(csv: string): { monthKey: string; spend: number }[] {
  // Strip UTF-8 BOM if present
  const content = csv.startsWith('﻿') ? csv.slice(1) : csv;
  const lines = content.split(/\r?\n/);

  // Find the header row — it contains 'TimePeriod'
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('timeperiod')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  // Parse headers (strip surrounding quotes)
  const parseCols = (line: string) =>
    line.split(',').map(c => c.replace(/^"|"$/g, '').trim());

  const headers = parseCols(lines[headerIdx]).map(h => h.toLowerCase().replace(/\s/g, ''));
  const tpIdx    = headers.findIndex(h => h === 'timeperiod' || h === 'gregoriandate');
  const spendIdx = headers.findIndex(h => h === 'spend');
  if (tpIdx === -1 || spendIdx === -1) return [];

  const results: { monthKey: string; spend: number }[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('©') || line.toLowerCase().startsWith('total') || line.startsWith('"©')) continue;
    const cols = parseCols(line);
    if (cols.length <= Math.max(tpIdx, spendIdx)) continue;

    // TimePeriod for Monthly aggregation: "YYYY-MM-DD" (start of month)
    const dateStr  = cols[tpIdx];
    const monthKey = dateStr.slice(5, 7); // '2026-11-01' → '11'
    if (!MONTH_NAMES[monthKey]) continue;

    const spend = parseFloat(cols[spendIdx].replace(/,/g, '')) || 0;
    results.push({ monthKey, spend });
  }
  return results;
}

export interface BingMonthlySpend {
  month:       string; // "January", "November", …
  actualSpend: number; // AUD, 2 dp
}

/**
 * Fetch monthly spend from the Microsoft Advertising Reporting API.
 *
 * @param startDate  'YYYY-MM-DD'
 * @param endDate    'YYYY-MM-DD'
 * @param campaignId Microsoft Ads campaign ID (defaults to PP Excel Shopping campaign)
 */
export async function fetchBingMonthlySpend(
  startDate:  string,
  endDate:    string,
  campaignId: string | null = '490633545',   // null = every campaign in the account
): Promise<BingMonthlySpend[]> {
  const accountId = process.env.BING_ADS_ACCOUNT_ID;
  if (!accountId) throw new Error('BING_ADS_ACCOUNT_ID is not set');

  const token = await getAccessToken();

  const [sy, sm, sd] = startDate.split('-');
  const [ey, em, ed] = endDate.split('-');

  const submitBody = `
    <SubmitGenerateReportRequest xmlns="${REPORTING_NS}">
      <ReportRequest i:type="CampaignPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <Format>Csv</Format>
        <Language>English</Language>
        <ReportName>BingMonthlySpend</ReportName>
        <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
        <Aggregation>Monthly</Aggregation>
        <Columns>
          <CampaignPerformanceReportColumn>TimePeriod</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>Spend</CampaignPerformanceReportColumn>
        </Columns>
        <Scope>
          <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
            <a:long>${accountId}</a:long>
          </AccountIds>
${campaignId ? `          <Campaigns>
            <CampaignReportScope>
              <AccountId>${accountId}</AccountId>
              <CampaignId>${campaignId}</CampaignId>
            </CampaignReportScope>
          </Campaigns>` : ''}
        </Scope>
        <Time>
          <CustomDateRangeStart>
            <Day>${parseInt(sd, 10)}</Day>
            <Month>${parseInt(sm, 10)}</Month>
            <Year>${sy}</Year>
          </CustomDateRangeStart>
          <CustomDateRangeEnd>
            <Day>${parseInt(ed, 10)}</Day>
            <Month>${parseInt(em, 10)}</Month>
            <Year>${ey}</Year>
          </CustomDateRangeEnd>
          <ReportTimeZone>AustraliaSydney</ReportTimeZone>
        </Time>
      </ReportRequest>
    </SubmitGenerateReportRequest>`;

  const submitXml      = await soapCall('SubmitGenerateReport', submitBody, token);
  const reportRequestId = extractTag(submitXml, 'ReportRequestId');
  if (!reportRequestId) {
    throw new Error(`No ReportRequestId in response: ${submitXml.slice(0, 400)}`);
  }

  // Poll until Success (up to ~35 seconds: 1 × 5s pre-wait + 6 × 5s = 35s)
  const pollBody = `
    <PollGenerateReportRequest xmlns="${REPORTING_NS}">
      <ReportRequestId>${reportRequestId}</ReportRequestId>
    </PollGenerateReportRequest>`;

  let downloadUrl = '';
  for (let attempt = 0; attempt < 7; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollXml = await soapCall('PollGenerateReport', pollBody, token);
    const status  = extractTag(pollXml, 'Status');
    if (status === 'Success') {
      downloadUrl = extractTag(pollXml, 'ReportDownloadUrl');
      break;
    }
    if (status === 'Error') throw new Error('Bing Ads report generation failed');
    // 'Pending' or 'Running' — keep polling
  }

  if (!downloadUrl) throw new Error('Bing Ads report timed out after 35s');

  const dlRes = await fetch(downloadUrl, { cache: 'no-store' });
  if (!dlRes.ok) throw new Error(`Report download failed (HTTP ${dlRes.status})`);
  const buffer = Buffer.from(await dlRes.arrayBuffer());
  const csv    = extractFirstFileFromZip(buffer);

  // Aggregate by month
  const byMonth: Record<string, number> = {};
  for (const { monthKey, spend } of parseReportCsv(csv)) {
    byMonth[monthKey] = (byMonth[monthKey] ?? 0) + spend;
  }

  return Object.entries(byMonth).map(([k, spend]) => ({
    month:       MONTH_NAMES[k],
    actualSpend: Math.round(spend * 100) / 100,
  }));
}


// Reports take 5-35 seconds to generate, so keep the total for a date range for 30 minutes (per server instance).
const _spendCache = new Map<string, { at: number; value: number }>();

/**
 * Total Microsoft Advertising spend for the whole account (every campaign) between two dates, in AUD.
 * Returns null when Bing is not configured; throws if the report fails.
 */
export async function fetchBingSpendTotal(startDate: string, endDate: string): Promise<number | null> {
  if (!process.env.BING_ADS_CLIENT_ID || !process.env.BING_ADS_ACCOUNT_ID) return null;
  const key = `${startDate}|${endDate}`;
  const hit = _spendCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.value;
  const rows = await fetchBingMonthlySpend(startDate, endDate, null);
  const value = Math.round(rows.reduce((a, r) => a + r.actualSpend, 0) * 100) / 100;
  _spendCache.set(key, { at: Date.now(), value });
  return value;
}
