import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STORE_HASH   = process.env.BIGCOMMERCE_STORE_HASH   ?? '';
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN ?? '';
const BC_BASE      = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

function toRFC2822(dateStr: string, endOfDay = false): string {
  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, mon, day] = dateStr.split('-').map(Number);
  const d   = new Date(Date.UTC(year!, mon! - 1, day!, 12, 0, 0));
  const dow = DAYS[d.getUTCDay()]!;
  const dd  = String(day!).padStart(2, '0');
  const mmm = MONTHS[mon! - 1]!;
  return `${dow}, ${dd} ${mmm} ${year} ${endOfDay ? '23:59:59' : '00:00:00'} +1000`;
}

function toAESTDateStr(d: Date): string {
  const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  return aest.toISOString().slice(0, 10);
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  const now      = new Date();
  const aestDate = toAESTDateStr(now);
  const utcDate  = toYMD(now);
  const todayDate = aestDate; // what the overview uses for "today"

  const minDate = toRFC2822(todayDate, false);
  const maxDate = toRFC2822(todayDate, true);

  const qs  = new URLSearchParams({
    min_date_created: minDate,
    max_date_created: maxDate,
    limit: '10',
  });
  const url = `${BC_BASE}/orders?${qs}`;

  const res = await fetch(url, {
    headers: { 'X-Auth-Token': ACCESS_TOKEN, Accept: 'application/json' },
  });
  const body = (res.ok && res.status !== 204) ? await res.json() : `(status ${res.status})`;

  return NextResponse.json({
    serverUtcNow:  now.toISOString(),
    aestDate,
    utcDate,
    minDateSent:   minDate,
    maxDateSent:   maxDate,
    encodedUrl:    url,
    bcStatus:      res.status,
    orderCount:    Array.isArray(body) ? body.length : 0,
    orderDates:    Array.isArray(body) ? body.map((o: {id: number; date_created: string; status: string}) => ({ id: o.id, date_created: o.date_created, status: o.status })) : body,
  });
}
