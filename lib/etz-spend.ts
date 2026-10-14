import { fetchMonthlySpend, buildConfig } from '@/lib/google-ads';
import { fetchMetaSpend, META_ETZ_ACCOUNT_ID } from '@/lib/meta-ads';
import { ETZ_CHATGPT_SPEND } from '@/lib/constants';

const ETZ_START_MONTH = '2026-07';

/** Excel Test Zone ad spend (Google Ads + Meta Ads + ChatGPT) for a date range inside one month. */
export async function etzSpend(start: string, end: string) {
  const month = end.slice(0, 7);
  let google = 0;
  let meta = 0;
  let googleOk = true;
  let metaOk = true;
  try {
    const cfg = month >= ETZ_START_MONTH ? buildConfig('etz') : buildConfig('pp');
    const filter = month >= ETZ_START_MONTH ? undefined : { contains: 'ETZ' };
    google = (await fetchMonthlySpend(cfg, start, end, filter)).reduce((s, r) => s + r.actualSpend, 0);
  } catch { googleOk = false; }
  try {
    meta = await fetchMetaSpend(META_ETZ_ACCOUNT_ID, start, end, { contains: 'ETZ' });
  } catch { metaOk = false; }
  const chatgpt = ETZ_CHATGPT_SPEND[month] ?? 0;
  return { google, meta, chatgpt, total: google + meta + chatgpt, googleOk, metaOk };
}
