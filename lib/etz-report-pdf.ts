/**
 * Executive summary PDF (A4) for Excel Test Zone: sales, free trials, products and where sales come from.
 * Pure rendering: EtzReportData in, PDF bytes out. Reuses the drawing helpers from lib/exec-report-pdf.ts so
 * both emailed reports look like one family (standard Helvetica only, runs anywhere on Vercel).
 *
 * Emailed at about 9:30am: complete days only, month to date through yesterday against the same days last month.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { EtzReportData } from '@/lib/etz-report-data';
import {
  Canvas, header, footer, tile, callout, barList, keyValueRows, dailyChartBlock,
  INK, MUTED, NAVY, BLUE, TINT, GOOD, BAD, M, CW, NUM, money, pctChange, signed,
} from '@/lib/exec-report-pdf';

const gap = 10, tw = (CW - 2 * gap) / 3, th = 62;

function vsLastMonth(cur: number, prior: number, fmt: (n: number) => string): { text: string; color: string } {
  const p = pctChange(cur, prior);
  if (p === null) return { text: 'no figure for last month', color: MUTED };
  return { text: `${signed(p)} vs ${fmt(prior)} last month`, color: p >= 0 ? GOOD : BAD };
}

function pageOne(pdf: PDFDocument, reg: any, bold: any, d: EtzReportData, total: number) {
  const page = pdf.addPage([595.28, 841.89]);
  const c = new Canvas(page, reg, bold);
  header(c, 'EXECUTIVE SUMMARY  |  EXCEL TEST ZONE', 'Sales and free trials', d, BLUE, 'same days last month');

  const yLabel = d.yesterdayLabel.replace(/ \d{4}$/, '');
  const revChange = pctChange(d.revenue.cur, d.revenue.prior);
  const t = d.target;
  const pctTarget = t.monthlyTarget > 0 ? (d.revenue.cur / t.monthlyTarget) * 100 : 0;
  const bullets = [
    `• Yesterday (${yLabel}): ${money(d.yesterday.revenue)} from ${NUM.format(d.yesterday.orders)} orders.`,
    `• Month to date: ${money(d.revenue.cur)} from ${NUM.format(d.orders.cur)} orders${revChange === null ? '' : `, ${signed(revChange)} on the same days last month`}.` +
      (t.monthlyTarget > 0 ? ` At the current daily pace the month ends near ${money(t.projected)} against a ${money(t.monthlyTarget)} target.` : ''),
    `• Free trials: ${NUM.format(d.trials.cur)} started this month` +
      (d.trialToPaid.measured > 0 ? `, and ${NUM.format(d.trialToPaid.converted)} of them (${d.trialToPaid.pct ?? 0}%) have already paid.` : '.') +
      (d.trials.schoolImports > 0 ? ` ${NUM.format(d.trials.schoolImports)} of the trials are bulk school sign-ups.` : ''),
  ];
  if (d.spend && d.spend.total > 0) {
    bullets.push(`• Marketing: ${money(d.spend.total)} spent on ads this month, which is ${'$' + (d.revenue.cur / d.spend.total).toFixed(2)} of revenue for every $1 of ad spend.`);
  }
  let top = callout(c, 84, 'At a glance', bullets, TINT, undefined, BLUE, INK, 8.6) + 10;

  const rev = vsLastMonth(d.revenue.cur, d.revenue.prior, money);
  const ord = vsLastMonth(d.orders.cur, d.orders.prior, v => NUM.format(v));
  const trl = vsLastMonth(d.trials.cur, d.trials.prior, v => NUM.format(v));
  tile(c, M, top, tw, th, `Yesterday, ${yLabel}`, money(d.yesterday.revenue), `${NUM.format(d.yesterday.orders)} orders | 7-day avg ${money(d.yesterday.avg7)} a day`, MUTED, TINT);
  tile(c, M + tw + gap, top, tw, th, 'Revenue, month to date', money(d.revenue.cur), rev.text, rev.color, TINT);
  tile(c, M + 2 * (tw + gap), top, tw, th, 'Month-end outlook', money(t.projected),
    t.monthlyTarget > 0 ? `target ${money(t.monthlyTarget)} | ${Math.round(pctTarget)}% reached so far` : 'straight-line projection', MUTED, TINT);
  top += th + gap;
  tile(c, M, top, tw, th, 'Paid orders, month to date', NUM.format(d.orders.cur), `${ord.text.replace(' last month', '')} | avg order ${money(d.aov.cur)}`, ord.color, TINT);
  tile(c, M + tw + gap, top, tw, th, 'Free trials started', NUM.format(d.trials.cur), trl.text, trl.color, TINT);
  tile(c, M + 2 * (tw + gap), top, tw, th, 'Free trial to paid', d.trialToPaid.pct === null ? 'n/a' : `${d.trialToPaid.pct}%`,
    d.trialToPaid.measured > 0 ? `${NUM.format(d.trialToPaid.converted)} of ${NUM.format(d.trialToPaid.measured)} trials have paid` : 'no trials yet', MUTED, TINT);
  top += th + 22;

  dailyChartBlock(c, d.daily, d.trend, BLUE, top, 340);
  footer(c, 1, total, 'Sources: Stripe, HubSpot');
}

function table(c: Canvas, top: number, cols: { label: string; x: number; align?: 'left' | 'right' }[], rows: string[][]) {
  cols.forEach(col => c.text(col.label.toUpperCase(), col.x, top, 6.8, MUTED, { bold: true, align: col.align }));
  c.line(M, top + 12, M + CW, top + 12, '#B8C4CF', 0.6);
  rows.forEach((r, i) => {
    const ty = top + 19 + i * 20;
    r.forEach((cell, k) => c.text(cell, cols[k]!.x, ty, 8.6, k === 0 ? INK : NAVY, { bold: k > 0, align: cols[k]!.align }));
    c.line(M, ty + 14, M + CW, ty + 14, '#EEF2F6', 0.5);
  });
  return top + 19 + rows.length * 20;
}

function pageTwo(pdf: PDFDocument, reg: any, bold: any, d: EtzReportData, total: number) {
  const page = pdf.addPage([595.28, 841.89]);
  const c = new Canvas(page, reg, bold);
  header(c, 'EXECUTIVE SUMMARY  |  EXCEL TEST ZONE', 'Products and marketing', d, BLUE, 'same days last month');

  // top products
  c.text('Best-selling products this month, by revenue', M, 86, 11, NAVY, { bold: true });
  let y = 106;
  if (d.products && d.products.length > 0) {
    const rows = d.products.map(p => ({ label: p.name.replace(/\*/g, ''), count: p.revenue }));
    barList(c, rows, M, y, CW, BLUE, 17, 300, money);
    y += rows.length * 17 + 14;
  } else {
    c.text('Product sales could not be read today.', M, y, 8.5, MUTED);
    y += 30;
  }

  // channels
  c.text('Where visits and sales come from, month to date', M, y, 11, NAVY, { bold: true });
  y += 22;
  if (d.channels) {
    const colsX = { v: M + 300, o: M + 370, r: M + 450, s: M + CW };
    y = table(c, y, [
      { label: 'Channel', x: M },
      { label: 'Visits', x: colsX.v, align: 'right' },
      { label: 'Orders', x: colsX.o, align: 'right' },
      { label: 'Revenue', x: colsX.r, align: 'right' },
      { label: 'Ad spend', x: colsX.s, align: 'right' },
    ], d.channels.map(ch => [ch.channel, NUM.format(ch.sessions), NUM.format(ch.orders), money(ch.revenue), ch.spend === null ? '-' : money(ch.spend)]));
  } else {
    c.text('Channel data could not be read today.', M, y, 8.5, MUTED);
    y += 20;
  }
  y += 22;

  // website and marketing
  const colW = (CW - 24) / 2;
  c.text('Website, this month vs last month', M, y, 10, NAVY, { bold: true });
  c.text('Marketing, month to date', M + colW + 24, y, 10, NAVY, { bold: true });
  if (d.engagement) {
    const e = d.engagement;
    const mins = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
    keyValueRows(c, M, y + 22, colW, [
      ['Website visits', NUM.format(e.cur.sessions), `${NUM.format(e.prior.sessions)} same days last month`],
      ['Bounce rate', `${e.cur.bounceRate.toFixed(0)}%`, `${e.prior.bounceRate.toFixed(0)}% last month (lower is better)`],
      ['Average time on the website', mins(e.cur.avgSessionSeconds), `${mins(e.prior.avgSessionSeconds)} last month`],
    ]);
  } else {
    c.text('Website figures could not be read today.', M, y + 22, 8.5, MUTED);
  }
  if (d.spend) {
    const s = d.spend;
    keyValueRows(c, M + colW + 24, y + 22, colW, [
      ['Google Ads spend', s.googleOk ? money(s.google) : 'not available'],
      ['Meta Ads spend', s.metaOk ? money(s.meta) : 'not available'],
      ['Revenue per $1 of ad spend', s.total > 0 ? `$${(d.revenue.cur / s.total).toFixed(2)}` : 'n/a', 'All ETZ revenue divided by all ad spend'],
    ]);
  } else {
    c.text('Ad spend could not be read today.', M + colW + 24, y + 22, 8.5, MUTED);
  }
  y += 22 + 3 * 26 + 18;

  callout(c, Math.min(y, 640), 'How to read these numbers', [
    'Yesterday is the full previous day (Sydney time). Month to date runs from the 1st through the end of yesterday and is compared with the same days last month. Revenue and orders are from Stripe.',
    `New free trials counts every trial started this month, including those that have since paid.${d.trials.schoolImports > 0 ? ` ${NUM.format(d.trials.schoolImports)} of the ${NUM.format(d.trials.cur)} are bulk school sign-ups.` : ''} Free trial to paid is the share of those trials that have paid so far; recent trials may still be in progress. Free trial figures come from HubSpot.`,
    'Visits, bounce rate and sales by channel come from Google Analytics for the production website and app only, so channel revenue can differ a little from Stripe revenue.',
  ], '#F6F8FA', undefined, NAVY, INK, 7.8);

  footer(c, 2, total, 'Sources: Stripe, HubSpot, Google Analytics, Google Ads, Meta Ads');
}

export async function renderEtzReport(d: EtzReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Excel Test Zone executive summary ${d.periodLabel}`);
  pdf.setAuthor('Pascal Press marketing');
  pdf.setSubject('Excel Test Zone executive summary');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pageOne(pdf, reg, bold, d, 2);
  pageTwo(pdf, reg, bold, d, 2);
  return pdf.save();
}
