/**
 * Executive summary PDF (A4): Excel HSC Copilot sales and subscriptions. Pure rendering: ExecReportData in,
 * PDF bytes out. Uses only pdf-lib and the standard Helvetica fonts, so it runs anywhere (Vercel serverless
 * included) with no files or browsers. An Excel Test Zone page is rendered only when `etz` data is supplied.
 *
 * The report is emailed at about 9:30am and covers complete days only: a "yesterday" figure, and month to date
 * through the end of yesterday compared with the same dates last year.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, RGB } from 'pdf-lib';

interface OrdersAndRevenue { orders: number; revenue: number }
type Mix = { new: OrdersAndRevenue; recurring: OrdersAndRevenue; annual: OrdersAndRevenue; other: OrdersAndRevenue };
interface DailyPoint { date: string; revenue: number; ma7: number | null; partial: boolean }
interface Trend { last30Avg: number; prior30Avg: number; last30Change: number | null }

export interface ExecReportData {
  preparedLabel: string;      // e.g. "12 Oct 2026, 9:30 am (Sydney time)"
  yesterdayLabel: string;     // e.g. "Sunday 11 Oct 2026"
  periodLabel: string;        // month to date through yesterday, e.g. "1-11 Oct 2026"
  comparisonLabel: string;    // same dates last year, e.g. "1-11 Oct 2025"
  ehc: {
    yesterday: { revenue: number; orders: number; new: number; recurring: number; annual: number; avg7: number };
    revenue: { cur: number; prior: number };
    orders: { cur: number; prior: number };
    mix: Mix;
    mixPrior: Mix;
    target: { monthlyTarget: number; monthPctElapsed: number; projected: number; daysElapsed: number; daysInMonth: number };
    subscriptions: { paying: number; monthly: number; yearly: number; mrr: number; pendingCancel: number; started: number; cancelled: number };
    marketing: { adSpend: number | null; failedPayments: number };
    daily: DailyPoint[];
    trend: Trend;
    weeklyOrders: { week: string; new: number; recurring: number; annual: number; other: number }[];
    deals: { total: number; freeTrial: number; newPaid: number; newZero: number; subjects: { subject: string; count: number }[]; lastFreeTrialDate: string | null };
  };
  etz?: {
    yesterday: { revenue: number; orders: number; avg7: number };
    revenue: { cur: number; prior: number };
    orders: { cur: number; prior: number };
    aov: { cur: number; prior: number };
    trials: { cur: number; prior: number; schoolImports: number };
    trialToPaid: { cur: number; prior: number };
    target: { monthlyTarget: number; monthPctElapsed: number };
    daily: DailyPoint[];
    trend: Trend;
  };
}

// ETZ brand (exceltestzone.com.au) and the EHC emerald used on the dashboard.
const INK = '#142C3D', MUTED = '#5D7080', HAIR = '#DCE6F0', WHITE = '#FFFFFF';
const NAVY = '#0B2A4A', BLUE = '#1B72BD', TINT = '#EBF4FF';
const EHC = '#047857', EHC_TINT = '#ECFDF5';
const C_NEW = '#047857', C_RECUR = '#2563EB', C_ANNUAL = '#D97706', C_OTHER = '#7C3AED';
const GOOD = '#2F7D32', BAD = '#B4500B', WARN_BG = '#FFF7E6', WARN_LINE = '#F3D49B', WARN_TEXT = '#7A4A06';

const W = 595.28, H = 841.89, M = 40;
const CW = W - 2 * M;

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const NUM = new Intl.NumberFormat('en-AU');
const money = (n: number) => `$${NUM.format(Math.round(n))}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m! - 1]}`; };
const pctChange = (cur: number, prior: number) => (prior > 0 ? ((cur - prior) / prior) * 100 : null);
const signed = (n: number | null, digits = 0) => (n === null ? 'n/a' : `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(digits)}%`);

// Keep text inside what the standard fonts can encode.
const ALLOWED = new Set(['–', '—', '‘', '’', '“', '”', '•', '…']);
const safe = (s: string) => Array.from(s).map(ch => (ch.charCodeAt(0) <= 255 || ALLOWED.has(ch) ? ch : '?')).join('');

class Canvas {
  constructor(public page: PDFPage, public reg: PDFFont, public bold: PDFFont) {}

  y(top: number) { return H - top; }

  text(s: string, x: number, top: number, size: number, color = INK, o: { bold?: boolean; align?: 'left' | 'right' | 'center'; maxW?: number } = {}) {
    let str = safe(s);
    const font = o.bold ? this.bold : this.reg;
    if (o.maxW) while (str.length > 1 && font.widthOfTextAtSize(str, size) > o.maxW) str = str.slice(0, -2) + '…';
    const w = font.widthOfTextAtSize(str, size);
    const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.page.drawText(str, { x: px, y: this.y(top) - size * 0.78, size, font, color: hex(color) });
  }

  spaced(s: string, x: number, top: number, size: number, color: string, spacing: number) {
    let cx = x;
    for (const ch of safe(s)) {
      this.page.drawText(ch, { x: cx, y: this.y(top) - size * 0.78, size, font: this.bold, color: hex(color) });
      cx += this.bold.widthOfTextAtSize(ch, size) + spacing;
    }
  }

  wrap(s: string, size: number, maxW: number, bold = false): string[] {
    const font = bold ? this.bold : this.reg;
    const lines: string[] = [];
    let line = '';
    for (const word of safe(s).split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t; else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  paragraph(s: string, x: number, top: number, size: number, maxW: number, color = INK, lead = 1.35, bold = false) {
    const lines = this.wrap(s, size, maxW, bold);
    lines.forEach((l, i) => this.text(l, x, top + i * size * lead, size, color, { bold }));
    return lines.length * size * lead;
  }

  rect(x: number, top: number, w: number, h: number, fill: string, opacity = 1) {
    this.page.drawRectangle({ x, y: this.y(top) - h, width: w, height: h, color: hex(fill), opacity });
  }

  rrect(x: number, top: number, w: number, h: number, r: number, fill: string, line?: string) {
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    this.page.drawSvgPath(path, { x, y: this.y(top), color: hex(fill), borderColor: line ? hex(line) : undefined, borderWidth: line ? 0.6 : 0 });
  }

  line(x1: number, t1: number, x2: number, t2: number, color: string, width = 0.6) {
    this.page.drawLine({ start: { x: x1, y: this.y(t1) }, end: { x: x2, y: this.y(t2) }, thickness: width, color: hex(color) });
  }
}

function header(c: Canvas, kicker: string, title: string, d: ExecReportData, accent: string) {
  c.spaced(kicker, M, 36, 8, accent, 1.6);
  c.text(title, M, 52, 22, NAVY, { bold: true });
  c.text(`Month to date: ${d.periodLabel}`, W - M, 38, 10, INK, { bold: true, align: 'right' });
  c.text(`vs ${d.comparisonLabel} (same period last year)`, W - M, 52, 8.5, MUTED, { align: 'right' });
  c.text(`Prepared ${d.preparedLabel.replace(' (Sydney time)', '')}`, W - M, 64, 8, MUTED, { align: 'right' });
}

function footer(c: Canvas, n: number, total: number, sources: string) {
  c.line(M, H - 44, W - M, H - 44, HAIR);
  c.text(`Pascal Press and Blake Education  |  Internal  |  ${sources}`, M, H - 36, 7.5, MUTED);
  c.text(`Page ${n} of ${total}`, W - M, H - 36, 7.5, MUTED, { align: 'right' });
}

function tile(c: Canvas, x: number, top: number, w: number, h: number, label: string, value: string, sub: string, subColor: string, fill: string) {
  c.rrect(x, top, w, h, 7, fill);
  c.spaced(label.toUpperCase(), x + 12, top + 11, 6.8, MUTED, 0.9);
  c.text(value, x + 12, top + 24, 22, NAVY, { bold: true });
  c.text(sub, x + 12, top + h - 15, 7.6, subColor, { maxW: w - 24 });
}

function vsLastYear(cur: number, prior: number, fmt: (n: number) => string): { text: string; color: string } {
  const p = pctChange(cur, prior);
  if (p === null) return { text: 'no comparison last year', color: MUTED };
  return { text: `${signed(p)} vs ${fmt(prior)} last year`, color: p >= 0 ? GOOD : BAD };
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v / 4)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (4 * m * pow >= v) return 4 * m * pow;
  return v;
}

function axisMoney(v: number) { return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(v)}`; }

function gridAndAxis(c: Canvas, x: number, top: number, w: number, h: number, max: number, fmt: (v: number) => string) {
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const ty = top + h - (v / max) * h;
    c.line(x, ty, x + w, ty, i === 0 ? '#B8C4CF' : '#EEF2F6', 0.5);
    c.text(fmt(v), x - 5, ty - 3.5, 7, MUTED, { align: 'right' });
  }
}

function dailyRevenueChart(c: Canvas, daily: DailyPoint[], color: string, x: number, top: number, w: number, h: number) {
  const n = daily.length;
  const max = niceMax(Math.max(1, ...daily.map(p => p.revenue)));
  gridAndAxis(c, x, top, w, h, max, axisMoney);
  const step = w / n, bw = step * 0.66;
  daily.forEach((p, i) => {
    const bh = (p.revenue / max) * h;
    c.rect(x + i * step + (step - bw) / 2, top + h - bh, bw, bh, color, 0.3);
  });
  let prev: { x: number; y: number } | null = null;
  daily.forEach((p, i) => {
    if (p.ma7 === null) { prev = null; return; }
    const pt = { x: x + i * step + step / 2, y: top + h - (p.ma7 / max) * h };
    if (prev) c.line(prev.x, prev.y, pt.x, pt.y, color, 1.7);
    prev = pt;
  });
  daily.forEach((p, i) => {
    if ((n - 1 - i) % 14 === 0) c.text(shortDate(p.date), x + i * step + step / 2, top + h + 5, 7, MUTED, { align: 'center' });
  });
}

function dailyChartBlock(c: Canvas, daily: DailyPoint[], trend: Trend, color: string, top: number, chartH: number) {
  c.text('Daily revenue, last 90 days', M, top, 11, NAVY, { bold: true });
  const word = trend.last30Change === null ? '' : trend.last30Change >= 5 ? ', rising' : trend.last30Change <= -5 ? ', falling' : ', flat';
  c.text(`Last 30 days: ${money(trend.last30Avg)} a day vs ${money(trend.prior30Avg)} in the 30 before (${signed(trend.last30Change)})${word}`, M, top + 15, 8.5, MUTED);
  c.rect(W - M - 150, top + 3, 8, 8, color, 0.3); c.text('Daily revenue', W - M - 138, top + 3, 7.5, MUTED);
  c.line(W - M - 72, top + 7, W - M - 58, top + 7, color, 1.7); c.text('7-day average', W - M - 54, top + 3, 7.5, MUTED);
  dailyRevenueChart(c, daily, color, M + 30, top + 36, CW - 30, chartH);
  c.text('Complete days only: the chart ends yesterday.', M + 30, top + 36 + chartH + 18, 7, MUTED);
}

function weeklyOrdersChart(c: Canvas, weekly: ExecReportData['ehc']['weeklyOrders'], x: number, top: number, w: number, h: number) {
  const total = (wk: (typeof weekly)[number]) => wk.new + wk.recurring + wk.annual + wk.other;
  const max = niceMax(Math.max(1, ...weekly.map(total)));
  gridAndAxis(c, x, top, w, h, max, v => String(Math.round(v)));
  const n = weekly.length, step = w / n, bw = step * 0.62;
  weekly.forEach((wk, i) => {
    let base = top + h;
    const bx = x + i * step + (step - bw) / 2;
    for (const [val, col] of [[wk.new, C_NEW], [wk.recurring, C_RECUR], [wk.annual, C_ANNUAL], [wk.other, C_OTHER]] as [number, string][]) {
      const bh = (val / max) * h;
      if (bh > 0) { c.rect(bx, base - bh, bw, bh, col); c.page.drawRectangle({ x: bx, y: c.y(base - bh) - bh, width: bw, height: bh, borderColor: hex(WHITE), borderWidth: 0.6 }); }
      base -= bh;
    }
    c.text(String(total(wk)), bx + bw / 2, base - 10, 7, INK, { bold: true, align: 'center' });
    c.text(shortDate(wk.week), bx + bw / 2, top + h + 5, 6.5, MUTED, { align: 'center' });
  });
}

function barList(c: Canvas, rows: { label: string; count: number }[], x: number, top: number, w: number, color: string, rowH = 15) {
  const max = Math.max(1, ...rows.map(r => r.count));
  const labelW = 110, valW = 34, barX = x + labelW, barW = w - labelW - valW - 6;
  rows.forEach((r, i) => {
    const ty = top + i * rowH;
    c.text(r.label, x, ty, 8, INK, { maxW: labelW - 6 });
    c.rrect(barX, ty + 2, barW, 6, 3, '#EEF2F6');
    if (r.count > 0) c.rrect(barX, ty + 2, Math.max(barW * (r.count / max), 4), 6, 3, color);
    c.text(NUM.format(r.count), x + w, ty, 8, NAVY, { bold: true, align: 'right' });
  });
}

/** Rounded callout sized to its text. Returns the bottom edge. */
function callout(c: Canvas, top: number, title: string, paragraphs: string[], fill: string, line: string | undefined, titleColor: string, textColor: string, size = 8.3): number {
  const lead = 1.35, pad = 12, inner = CW - 28;
  const lines = paragraphs.map(p => c.wrap(p, size, inner));
  const textH = lines.reduce((a, l) => a + l.length * size * lead, 0) + (paragraphs.length - 1) * 4;
  const h = pad + 13 + textH + pad - 2;
  c.rrect(M, top, CW, h, 7, fill, line);
  c.text(title, M + 14, top + pad, 9, titleColor, { bold: true });
  let ty = top + pad + 17;
  lines.forEach(ls => { ls.forEach((l, i) => c.text(l, M + 14, ty + i * size * lead, size, textColor)); ty += ls.length * size * lead + 4; });
  return top + h;
}

function keyValueRows(c: Canvas, x: number, top: number, w: number, rows: [string, string, string?][]) {
  rows.forEach(([label, value, note], i) => {
    const ty = top + i * 26;
    c.text(label, x, ty, 8.5, INK);
    c.text(value, x + w, ty, 9.5, NAVY, { bold: true, align: 'right' });
    if (note) c.text(note, x, ty + 11, 7, MUTED, { maxW: w });
    c.line(x, ty + 22, x + w, ty + 22, '#EEF2F6', 0.5);
  });
}

function ehcPageOne(pdf: PDFDocument, reg: PDFFont, bold: PDFFont, d: ExecReportData, total: number, n: number) {
  const page = pdf.addPage([W, H]);
  const c = new Canvas(page, reg, bold);
  const e = d.ehc;
  header(c, 'EXECUTIVE SUMMARY  |  EXCEL HSC COPILOT', 'Sales and subscriptions', d, EHC);

  const yLabel = d.yesterdayLabel.replace(/ \d{4}$/, '');
  const revChange = pctChange(e.revenue.cur, e.revenue.prior);
  const net = e.subscriptions.started - e.subscriptions.cancelled;
  const t = e.target;

  // at a glance
  const bullets = [
    `• Yesterday (${yLabel}): ${money(e.yesterday.revenue)} from ${e.yesterday.orders} orders (${e.yesterday.new} new, ${e.yesterday.recurring} renewals, ${e.yesterday.annual} annual).`,
    `• Month to date: ${money(e.revenue.cur)} from ${NUM.format(e.orders.cur)} orders${revChange === null ? '' : `, ${signed(revChange)} on the same period last year`}.` +
      (t.monthlyTarget > 0 ? ` At the current daily pace the month ends near ${money(t.projected)} against a ${money(t.monthlyTarget)} target.` : ''),
    `• Subscribers: ${NUM.format(e.subscriptions.paying)} paying subscriptions worth about ${money(e.subscriptions.mrr)} a month. ${e.subscriptions.started} started and ${e.subscriptions.cancelled} were cancelled this month (net ${net >= 0 ? '+' : ''}${net}); ${e.subscriptions.pendingCancel} more are set to end at their next renewal.`,
    `• Payments: ${NUM.format(e.marketing.failedPayments)} payment attempts failed this month; Stripe retries these automatically.`,
  ];
  let top = callout(c, 84, 'At a glance', bullets, EHC_TINT, undefined, EHC, INK, 8.6) + 10;

  // tiles
  const gap = 10, tw = (CW - 2 * gap) / 3, th = 62;
  const rev = vsLastYear(e.revenue.cur, e.revenue.prior, money);
  tile(c, M, top, tw, th, `Yesterday, ${yLabel}`, money(e.yesterday.revenue), `${NUM.format(e.yesterday.orders)} orders | 7-day avg ${money(e.yesterday.avg7)} a day`, MUTED, EHC_TINT);
  tile(c, M + tw + gap, top, tw, th, 'Revenue, month to date', money(e.revenue.cur), rev.text, rev.color, EHC_TINT);
  const pctTarget = t.monthlyTarget > 0 ? (e.revenue.cur / t.monthlyTarget) * 100 : 0;
  tile(c, M + 2 * (tw + gap), top, tw, th, 'Month-end outlook', money(t.projected),
    t.monthlyTarget > 0 ? `target ${money(t.monthlyTarget)} | ${Math.round(pctTarget)}% reached, ${Math.round(t.monthPctElapsed)}% of month gone` : 'straight-line projection', MUTED, EHC_TINT);
  top += th + gap;
  tile(c, M, top, tw, th, 'Paying subscriptions', NUM.format(e.subscriptions.paying), `${NUM.format(e.subscriptions.monthly)} monthly | ${NUM.format(e.subscriptions.yearly)} annual`, MUTED, EHC_TINT);
  tile(c, M + tw + gap, top, tw, th, 'Recurring revenue a month', money(e.subscriptions.mrr), 'at list price, annual plans divided by 12', MUTED, EHC_TINT);
  tile(c, M + 2 * (tw + gap), top, tw, th, 'Net new subscriptions', `${net >= 0 ? '+' : ''}${net}`,
    `${e.subscriptions.started} started, ${e.subscriptions.cancelled} cancelled this month`, net >= 0 ? GOOD : BAD, EHC_TINT);
  top += th + 22;

  dailyChartBlock(c, e.daily, e.trend, EHC, top, 255);
  footer(c, n, total, 'Sources: Stripe, HubSpot');
}

function ehcPageTwo(pdf: PDFDocument, reg: PDFFont, bold: PDFFont, d: ExecReportData, total: number, n: number) {
  const page = pdf.addPage([W, H]);
  const c = new Canvas(page, reg, bold);
  const e = d.ehc;
  header(c, 'EXECUTIVE SUMMARY  |  EXCEL HSC COPILOT', 'Orders, marketing and deals', d, EHC);

  // order mix
  const gap = 10, tw = (CW - 2 * gap) / 3, th = 62, top1 = 86;
  const mixTile = (x: number, label: string, k: 'new' | 'recurring' | 'annual') => {
    const cur = e.mix[k], pr = e.mixPrior[k];
    tile(c, x, top1, tw, th, label, NUM.format(cur.orders), `${money(cur.revenue)} | ${NUM.format(pr.orders)} last year`, MUTED, EHC_TINT);
  };
  mixTile(M, 'New orders (new subscribers)', 'new');
  mixTile(M + tw + gap, 'Recurring orders (renewals)', 'recurring');
  mixTile(M + 2 * (tw + gap), 'Annual plan orders', 'annual');

  // weekly orders
  const chTop = 166;
  c.text('Orders per week, by type', M, chTop, 11, NAVY, { bold: true });
  c.text('Complete weeks (Monday to Sunday), last 12 weeks. The number above each bar is the week\'s total.', M, chTop + 15, 8.5, MUTED);
  const hasOther = e.weeklyOrders.some(w => w.other > 0);
  const items: [string, string][] = [['New', C_NEW], ['Renewals', C_RECUR], ['Annual', C_ANNUAL]];
  if (hasOther) items.push(['Other', C_OTHER]);
  let lx = W - M - items.length * 62;
  for (const [label, col] of items) { c.rect(lx, chTop + 3, 8, 8, col); c.text(label, lx + 12, chTop + 3, 7.5, MUTED); lx += 62; }
  weeklyOrdersChart(c, e.weeklyOrders, M + 26, chTop + 40, CW - 26, 135);

  // two columns: subjects (this month) and marketing
  const colTop = 372, colW = (CW - 24) / 2;
  c.text('New paid sign-ups this month, by subject', M, colTop, 10, NAVY, { bold: true });
  const subj = e.deals.subjects.slice(0, 8).map(s => ({ label: s.subject, count: s.count }));
  if (subj.length > 0) barList(c, subj, M, colTop + 20, colW, EHC);
  else c.text('No paid sign-ups recorded in HubSpot yet this month.', M, colTop + 20, 8.5, MUTED);
  c.text('From HubSpot deals created this month. A plan covering several subjects counts once per subject.', M, colTop + 20 + 8 * 15 + 3, 6.8, MUTED, { maxW: colW });

  const mx = M + colW + 24;
  c.text('Marketing and payments, month to date', mx, colTop, 10, NAVY, { bold: true });
  const spend = e.marketing.adSpend;
  const newOrders = e.mix.new.orders;
  keyValueRows(c, mx, colTop + 22, colW, [
    ['Google Ads spend', spend === null ? 'not available' : money(spend), spend === null ? 'Could not be read today' : undefined],
    ['Revenue per $1 of ad spend', spend && spend > 0 ? `$${(e.revenue.cur / spend).toFixed(2)}` : 'n/a', 'All EHC revenue divided by Google Ads spend'],
    ['Ad spend per new subscriber', spend && newOrders > 0 ? money(spend / newOrders) : 'n/a', 'Spend divided by new orders'],
    ['Failed payment attempts', NUM.format(e.marketing.failedPayments), 'Stripe retries these automatically'],
  ]);

  // deals and notes
  const dl = e.deals;
  let top = 566;
  const dealParas = [
    `HubSpot created ${NUM.format(dl.total)} deals this month: ${NUM.format(dl.newPaid)} paid, ${NUM.format(dl.newZero)} at $0 and ${NUM.format(dl.freeTrial)} Free Trial. Deals are records for new sign-ups, so renewals never appear as deals and the count is not meant to match Stripe orders.`,
  ];
  if (dl.lastFreeTrialDate) {
    dealParas.push(`The most recent Free Trial deal was created on ${shortDate(dl.lastFreeTrialDate)}. Since then free sign-ups appear to be recorded as $0 New Deals, so reports filtered on trial stages or the Free Trial type show no data. The cause is still to be confirmed with the EHC system owner.`);
  }
  top = callout(c, top, 'Deals in HubSpot this month', dealParas, WARN_BG, WARN_LINE, WARN_TEXT, WARN_TEXT, 8) + 8;
  callout(c, top, 'How to read these numbers', [
    'Yesterday is the full previous day (Sydney time). Month to date runs from the 1st through the end of yesterday and is compared with the same dates last year. Revenue is net of refunds.',
    'Orders are Stripe payments: new (the first payment of a new subscription), renewals, and annual plans. A returning subscriber who starts a fresh subscription counts as new.',
    'Paying subscriptions are active Stripe subscriptions priced above $0. Net new is subscriptions started minus cancelled this month. The month-end outlook is a straight-line projection, not a forecast, and ignores seasonality.',
  ], '#F6F8FA', undefined, NAVY, INK, 7.8);

  footer(c, n, total, 'Sources: Stripe, HubSpot, Google Ads');
}

function etzPage(pdf: PDFDocument, reg: PDFFont, bold: PDFFont, d: ExecReportData, total: number, n: number) {
  const e = d.etz!;
  const page = pdf.addPage([W, H]);
  const c = new Canvas(page, reg, bold);
  header(c, 'EXECUTIVE SUMMARY  |  EXCEL TEST ZONE', 'Free trials and orders', d, BLUE);

  const gap = 10, tw = (CW - 2 * gap) / 3, th = 66, top1 = 86, top2 = top1 + th + gap;
  const rev = vsLastYear(e.revenue.cur, e.revenue.prior, money);
  const ord = vsLastYear(e.orders.cur, e.orders.prior, v => NUM.format(v));
  const trl = vsLastYear(e.trials.cur, e.trials.prior, v => NUM.format(v));
  const ttpDiff = e.trialToPaid.cur - e.trialToPaid.prior;
  const yLabel = d.yesterdayLabel.replace(/ \d{4}$/, '');
  tile(c, M, top1, tw, th, `Yesterday, ${yLabel}`, money(e.yesterday.revenue), `${NUM.format(e.yesterday.orders)} orders | 7-day avg ${money(e.yesterday.avg7)} a day`, MUTED, TINT);
  tile(c, M + tw + gap, top1, tw, th, 'Revenue, month to date', money(e.revenue.cur), rev.text, rev.color, TINT);
  tile(c, M + 2 * (tw + gap), top1, tw, th, 'Paid orders, month to date', NUM.format(e.orders.cur), `${ord.text.replace(' last year', '')} | AOV ${money(e.aov.cur)}`, ord.color, TINT);
  tile(c, M, top2, tw, th, 'New free trials, this month', NUM.format(e.trials.cur), trl.text, trl.color, TINT);
  tile(c, M + tw + gap, top2, tw, th, 'Free trial to paid', `${Math.round(e.trialToPaid.cur)}%`,
    e.trials.prior > 0 ? `${ttpDiff >= 0 ? '+' : '-'}${Math.abs(ttpDiff).toFixed(0)} pts vs ${Math.round(e.trialToPaid.prior)}% last year` : 'no comparison last year',
    e.trials.prior > 0 ? (ttpDiff >= 0 ? GOOD : BAD) : MUTED, TINT);
  const pctOfTarget = e.target.monthlyTarget > 0 ? (e.revenue.cur / e.target.monthlyTarget) * 100 : 0;
  tile(c, M + 2 * (tw + gap), top2, tw, th, 'Month revenue target', `${Math.round(pctOfTarget)}%`,
    `${money(e.revenue.cur)} of ${money(e.target.monthlyTarget)} (${Math.round(e.target.monthPctElapsed)}% of month gone)`, MUTED, TINT);

  dailyChartBlock(c, e.daily, e.trend, BLUE, 252, 270);
  callout(c, 650, 'How to read these numbers', [
    'Yesterday is the full previous day (Sydney time). Month to date runs from the 1st through the end of yesterday and is compared with the same dates last year.',
    `New free trials counts every trial started in the period, including those that have already paid. ${NUM.format(e.trials.schoolImports)} of this period's ${NUM.format(e.trials.cur)} are bulk school imports.`,
    'Free trial to paid is paid orders divided by trials started in the same period. It is a simple ratio, not a strict conversion rate.',
  ], '#F6F8FA', undefined, NAVY, INK);
  footer(c, n, total, 'Sources: Stripe, HubSpot');
}

export async function renderExecReport(d: ExecReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Executive summary ${d.periodLabel}`);
  pdf.setAuthor('Pascal Press marketing');
  pdf.setSubject('Excel HSC Copilot executive summary');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const total = d.etz ? 3 : 2;
  ehcPageOne(pdf, reg, bold, d, total, 1);
  ehcPageTwo(pdf, reg, bold, d, total, 2);
  if (d.etz) etzPage(pdf, reg, bold, d, total, 3);
  return pdf.save();
}
