/**
 * GET /api/create-pp-repermission-list
 *
 * ONE-SHOT route — creates the SNAPSHOT (static-at-creation) HubSpot list
 * the user asked for: "Pascal Press All Time Purchases no opt in or opt out".
 *
 * Filter: brand contains "Pascal Press" AND hs_marketable_status != true
 * AND hs_email_optout != true AND has a value in the Unific "Last Product
 * Bought" property (i.e. a real purchase on record) — matching the
 * 60,235-contact segment found during this session's investigation.
 *
 * SNAPSHOT means HubSpot computes membership once at creation time, then
 * freezes it — no auto-updates after, same as a static list, but without
 * needing to enumerate and batch-add 60K+ individual contact IDs by hand.
 *
 * This is a WRITE to the live HubSpot account. Run once, inspect the
 * response, then delete this route — it is not meant to be a reusable
 * dashboard endpoint.
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

const PRODUCT_PROPERTY = 'unific_last_product_bought_text'; // confirmed earlier this session

export async function GET() {
  if (!process.env.HUBSPOT_CRM_TOKEN && !process.env.HUBSPOT_API_KEY) {
    return NextResponse.json({ connected: false, error: 'No HubSpot token configured' }, { status: 500 });
  }

  const body = {
    name: 'Pascal Press All Time Purchases no opt in or opt out',
    objectTypeId: '0-1',
    processingType: 'SNAPSHOT',
    filterBranch: {
      filterBranchType: 'OR',
      filterBranchOperator: 'OR',
      filters: [],
      filterBranches: [
        {
          filterBranchType: 'AND',
          filterBranchOperator: 'AND',
          filterBranches: [],
          filters: [
            {
              filterType: 'PROPERTY',
              property: 'brand',
              operation: {
                operationType: 'ENUMERATION',
                operator: 'IS_EQUAL_TO',
                values: ['Pascal Press'],
                includeObjectsWithNoValueSet: false,
              },
            },
            {
              filterType: 'PROPERTY',
              property: 'hs_marketable_status',
              operation: {
                operationType: 'BOOL',
                operator: 'IS_NOT_EQUAL_TO',
                value: true,
                includeObjectsWithNoValueSet: true,
              },
            },
            {
              filterType: 'PROPERTY',
              property: 'hs_email_optout',
              operation: {
                operationType: 'BOOL',
                operator: 'IS_NOT_EQUAL_TO',
                value: true,
                includeObjectsWithNoValueSet: true,
              },
            },
            {
              filterType: 'PROPERTY',
              property: PRODUCT_PROPERTY,
              operation: {
                operationType: 'ALL_PROPERTY',
                operator: 'IS_KNOWN',
                includeObjectsWithNoValueSet: false,
              },
            },
          ],
        },
      ],
    },
  };

  const res = await fetch(`${HS_BASE}/crm/v3/lists`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }

  return NextResponse.json({
    requestSent: body,
    httpStatus: res.status,
    ok: res.ok,
    response: json,
  }, { status: res.ok ? 200 : 502 });
}
