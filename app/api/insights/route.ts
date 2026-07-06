/**
 * POST /api/insights  — Edge runtime + streaming
 *
 * Streams the Claude response as plain text so Vercel never times out.
 * The client reads the full text, then parses the JSON array.
 *
 * Edge runtime + streaming bypasses Vercel's 10 s function limit on Hobby.
 */
import { NextRequest } from 'next/server';

export const runtime = 'edge';

function fmt(n: number | undefined): string {
  if (n == null) return '?';
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function buildPrompt(metrics: any): string {
  const campaigns  = metrics?.campaigns  ?? {};
  const emailData  = metrics?.email      ?? {};
  const band6      = metrics?.band6      ?? {};
  const spend      = metrics?.spend      ?? {};
  const bc         = metrics?.bc         ?? {};

  const ppCampaigns  = (campaigns?.pp?.campaigns  ?? []).slice(0, 6);
  const ppAdGroups   = (campaigns?.pp?.adGroups   ?? []).slice(0, 6);
  const etzCampaigns = (campaigns?.etz?.campaigns ?? []).slice(0, 6);
  const etzAdGroups  = (campaigns?.etz?.adGroups  ?? []).slice(0, 6);
  const emails       = (emailData?.campaigns ?? emailData?.emails ?? []).slice(0, 8);
  const topProducts  = (bc?.topProducts ?? []).slice(0, 8);
  const abandoned    = bc?.abandonedCarts ?? { count: 0, value: 0 };

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  const cLine = (c: any, brand: string) =>
    `• [${brand}] ${c.name}: spend ${fmt(c.cost)}, conv ${c.conversions ?? 0}, ROAS ${c.roas ?? 0}, CTR ${((c.ctr ?? 0) * 100).toFixed(1)}%`;

  const gLine = (g: any, brand: string) =>
    `• [${brand}] "${g.campaign}" / "${g.adGroup}": spend ${fmt(g.cost)}, conv ${g.conversions ?? 0}, CTR ${((g.ctr ?? 0) * 100).toFixed(1)}%`;

  const eLine = (e: any) => {
    const name  = e.name ?? e.subject ?? e.id ?? 'Unknown';
    const open  = typeof e.openRate  === 'number' ? e.openRate.toFixed(1)  : (e.open_rate  ?? '?');
    const click = typeof e.clickRate === 'number' ? e.clickRate.toFixed(1) : (e.click_rate ?? '?');
    return `• "${name}": open ${open}%, click ${click}%, ${e.sends ?? e.recipients ?? '?'} sent`;
  };

  const ppLines  = ppCampaigns.length  ? ppCampaigns.map((c: any)  => cLine(c, 'PP')).join('\n')  : '  (no PP data)';
  const etzLines = etzCampaigns.length ? etzCampaigns.map((c: any) => cLine(c, 'ETZ')).join('\n') : '  (no ETZ data)';
  const agLines  = [...ppAdGroups.map((g: any) => gLine(g, 'PP')), ...etzAdGroups.map((g: any) => gLine(g, 'ETZ'))].join('\n') || '  (no ad group data)';
  const emLines  = emails.length ? emails.map(eLine).join('\n') : '  (no email data)';
  const prLines  = topProducts.length ? topProducts.map((p: any) => `• ${p.name}: ${p.quantity ?? 0} units, ${fmt(p.revenue)}`).join('\n') : '  (no product data)';

  const spendSummary = JSON.stringify(spend?.summary ?? spend ?? {});
  const band6Summary = JSON.stringify(band6?.summary ?? band6 ?? {});

  return `You are a digital marketing strategist for Pascal Press (K–12 workbooks) and Excel Test Zone (HSC/NAPLAN prep) — Australian educational publisher.

Today: ${today}. It's Term 3 — peak for NAPLAN prep, HSC, Back to School.

Analyse this data. Return 5–7 actionable insights as JSON. Reference EXACT campaign names, ad group names, email subjects, product names from the data. Include specific numbers (dollars, %, counts). Be direct — generic advice is useless.

GOOGLE ADS — Campaigns:
${ppLines}
${etzLines}

GOOGLE ADS — Ad Groups:
${agLines}

EMAIL (HubSpot):
${emLines}

BIGCOMMERCE — Top Products This Month:
${prLines}

ABANDONED CARTS (last 30 days): ${abandoned.count} carts, ${fmt(abandoned.value)}

BUDGET PACING: ${spendSummary}
BAND 6: ${band6Summary}

Return ONLY a valid JSON array — no markdown, no preamble:
[{
  "id": "kebab-unique-id",
  "severity": "critical|warning|opportunity|info",
  "category": "google-ads|email|bigcommerce|band6|seasonal|budget",
  "title": "Title with exact campaign/product/email name (max 70 chars)",
  "body": "2–3 sentences. Cite specific numbers. WHY it matters in Term 3. ONE concrete action this week.",
  "metric": "e.g. 'ROAS 0.0 · $840 spent' or 'Open 9.4% · 2,100 sent'",
  "chatPrompt": "Pre-filled AI question with exact name + numbers",
  "action": "Short imperative (max 30 chars)"
}]

Priority: zero-conversion spend → abandoned cart value → low email open/click → Term 3 gaps → product wins.`;
}

export async function POST(req: NextRequest) {
  let prompt = '';

  try {
    const { metrics } = await req.json();
    prompt = buildPrompt(metrics);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Bad request: ${String(e)}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Call Anthropic with streaming — keeps the Edge connection alive
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      stream:     true,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: `Anthropic ${anthropicRes.status}: ${errText.slice(0, 200)}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pipe Anthropic SSE → plain text stream (extract text_delta payloads)
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer   = lines.pop() ?? '';          // keep incomplete last line
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            ctrl.enqueue(encoder.encode(evt.delta.text));
          }
        } catch { /* malformed chunk — skip */ }
      }
    },
    flush(ctrl) {
      // Handle any remaining buffered line
      if (sseBuffer.startsWith('data: ')) {
        const payload = sseBuffer.slice(6).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              ctrl.enqueue(encoder.encode(evt.delta.text));
            }
          } catch { /* ignore */ }
        }
      }
    },
  });

  return new Response(
    anthropicRes.body.pipeThrough(transform),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
