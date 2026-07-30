import { NextResponse } from 'next/server';

export async function GET() {
  const storeHash   = process.env.BIGCOMMERCE_BLAKE_STORE_HASH   ?? '';
  const accessToken = process.env.BIGCOMMERCE_BLAKE_ACCESS_TOKEN ?? '';
  const base        = `https://api.bigcommerce.com/stores/${storeHash}/v2`;

  // Check product 959 (NAPLAN Year 5) downloads
  const res = await fetch(`${base}/products/959/downloads`, {
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
    cache: 'no-store',
  });

  return NextResponse.json({
    status:  res.status,
    ok:      res.ok,
    body:    res.ok ? await res.json() : await res.text(),
  });
}
