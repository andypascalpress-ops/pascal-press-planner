/**
 * GET /api/hsc-deals-debug
 * Checks recent HSC pipeline deals for closedate population.
 * Temporary diagnostic — remove after fixing.
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
    return NextResponse.json({ error: 'No HubSpot token' }, { status: 500 });
  }

  // 1. Find all pipelines and locate the HSC one
  const pipelinesRes = await fetch(`${HS_BASE}/crm/v3/pipelines/deals`, {
    headers: hsHeaders(), cache: 'no-store',
  });
  const pipelinesData = await pipelinesRes.json();
  const pipelines = (pipelinesData.results ?? []) as { id: string; label: string; stages: { id: string; label: string }[] }[];

  const hscPipeline = pipelines.find(p =>
    p.label.toLowerCase().includes('hsc') ||
    p.label.toLowerCase().includes('copilot') ||
    p.label.toLowerCase().includes('ehc')
  );

  if (!hscPipeline) {
    return NextResponse.json({
      error: 'No HSC pipeline found',
      allPipelines: pipelines.map(p => ({ id: p.id, label: p.label })),
    });
  }

  // 2. Fetch the 20 most recent deals in that pipeline
  const searchRes = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hsHeaders(),
    cache: 'no-store',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: hscPipeline.id }] }],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 20,
      properties: ['dealname', 'amount', 'dealstage', 'createdate', 'closedate', 'hs_is_closed_won'],
    }),
  });
  const searchData = await searchRes.json();

  const deals = (searchData.results ?? []).map((d: {
    id: string;
    properties: Record<string, string | null>;
  }) => ({
    id: d.id,
    name:          d.properties.dealname,
    amount:        d.properties.amount,
    stage:         d.properties.dealstage,
    createdate:    d.properties.createdate,
    closedate:     d.properties.closedate,   // null = never set
    isClosedWon:   d.properties.hs_is_closed_won,
  }));

  const hasCloseDates = deals.filter((d: { closedate: string | null }) => d.closedate).length;

  return NextResponse.json({
    pipeline: { id: hscPipeline.id, label: hscPipeline.label },
    stages: hscPipeline.stages.map(s => ({ id: s.id, label: s.label })),
    recentDeals: deals,
    summary: {
      total: deals.length,
      withCloseDate: hasCloseDates,
      withoutCloseDate: deals.length - hasCloseDates,
      diagnosis: hasCloseDates === 0
        ? 'NO deals have a closedate set — the HubSpot report filter on closedate returns nothing'
        : hasCloseDates < deals.length
          ? 'Some deals missing closedate — partial data in report'
          : 'All deals have closedate set — check if deals are in Closed Won stage',
    },
  });
}
