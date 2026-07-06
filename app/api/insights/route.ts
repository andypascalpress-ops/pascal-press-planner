/**
 * POST /api/insights
 *
 * Accepts a `metrics` payload summarising the current marketing state,
 * calls Claude Haiku to generate 3-5 strategic insights, and returns them
 * as a structured JSON array. Used by the Action Centre tab.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'edge';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { metrics } = await req.json();

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `You are a senior marketing analyst for Pascal Press (Australian educational publisher — maths, English, science workbooks) and Excel Test Zone (their HSC exam prep brand).

Analyse these current marketing metrics and return 3–5 specific, actionable insights as a JSON array.

Metrics:
${JSON.stringify(metrics, null, 2)}

Return ONLY a valid JSON array (no markdown, no explanation) with this structure:
[{
  "id": "ai-unique-id",
  "severity": "critical|warning|opportunity|info",
  "category": "email|budget|campaign|revenue|band6|seasonal",
  "title": "Brief title (max 60 chars)",
  "body": "2–3 sentences: what the data shows, why it matters, concrete next step (include specific numbers from the metrics)",
  "metric": "Key metric display string",
  "chatPrompt": "Pre-filled question for the marketing AI assistant (specific, include numbers)"
}]

Focus on: cross-brand comparisons (PP vs ETZ), Australian school term seasonality (Term 3 starts now — NAPLAN, HSC prep, Back to School), Band 6 sales momentum, and concrete actions this week. Avoid generic advice.`,
      }],
    });

    const raw  = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]';
    const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const insights = JSON.parse(json);
    return NextResponse.json({ insights });

  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
