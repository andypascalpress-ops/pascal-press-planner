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

  const names = ['hs_marketable_status', 'hs_email_optout'];
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const res = await fetch(`${HS_BASE}/crm/v3/properties/contacts/${name}`, {
      headers: hsHeaders(), cache: 'no-store',
    });
    const json = await res.json();
    out[name] = {
      fieldType: json.fieldType,
      type: json.type,
      options: json.options,
    };
  }

  return NextResponse.json({ connected: true, properties: out });
}
