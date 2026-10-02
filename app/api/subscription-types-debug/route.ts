/**
 * GET /api/subscription-types-debug
 *
 * TEMPORARY diagnostic (read-only) — checks whether this HubSpot account
 * has separate per-brand subscription types (the mechanism HubSpot uses to
 * track "opted out of Pascal Press emails but not Excel Test Zone emails",
 * as opposed to the single global hs_email_optout flag already used this
 * session). Also checks contact properties for any custom per-brand
 * opt-out fields, in case the brand split is tracked that way instead.
 *
 * Delete once this is answered.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HS_BASE = 'https://api.hubapi.com';
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_CRM_TOKEN ?? process.env.HUBSPOT_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  // 1. Subscription type definitions (communication preferences)
  const subsRes = await fetch(`${HS_BASE}/communication-preferences/v3/definitions`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  const subsStatus = subsRes.status;
  const subsJson = subsRes.ok ? await subsRes.json() : await subsRes.text();

  // 2. Contact properties whose label suggests a per-brand or general opt-out/unsubscribe signal
  const propsRes = await fetch(`${HS_BASE}/crm/v3/properties/contacts?limit=500`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  let matchingProps: Array<{ name: string; label: string; fieldType: string }> = [];
  if (propsRes.ok) {
    const { results } = await propsRes.json() as {
      results: Array<{ name: string; label: string; fieldType: string }>
    };
    matchingProps = results.filter(p =>
      /opt.?out|unsubscri|subscription/i.test(p.label) || /opt.?out|unsubscri|subscription/i.test(p.name)
    );
  }

  return NextResponse.json({
    connected: true,
    subscriptionDefinitions: { status: subsStatus, ok: subsRes.ok, body: subsJson },
    matchingContactProperties: matchingProps,
  });
}
