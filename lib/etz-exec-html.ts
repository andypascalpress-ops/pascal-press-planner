/**
 * Excel Test Zone executive summary as HTML (10 landscape A4 pages), laid out after the hand-made report.
 * Charts are inline SVG so the page prints the same in any browser. Text is written from the numbers each run.
 */
import type { EtzExecData } from '@/lib/etz-exec-data';

type D = EtzExecData;
type Win = D['mtd'];

// ---------------------------------------------------------------- formatting

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number | null | undefined) => n == null || !isFinite(n) ? '–' : `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-AU')}`;
const moneyK = (n: number | null | undefined, dp = 0) => n == null ? '–' : `${n < 0 ? '−' : ''}$${(Math.abs(n) / 1000).toFixed(dp)}k`;
const moneyK1 = (n: number | null | undefined) => moneyK(n, 1);
const int = (n: number | null | undefined) => n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('en-AU');
const pctOf = (x: number | null | undefined, dp = 0) => x == null || !isFinite(x) ? '–' : `${(x * 100).toFixed(dp)}%`;
const change = (cur: number, prev: number | null | undefined) => (prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev));
const signedPct = (x: number | null) => x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const signedMoney = (x: number) => `${x >= 0 ? '+' : '−'}${money(Math.abs(x))}`;
const signedInt = (x: number) => `${x >= 0 ? '+' : '−'}${int(Math.abs(x))}`;
const tone = (x: number | null) => (x == null ? '' : x >= 0 ? 'up' : 'down');
const chg = (cur: number, prev: number | null | undefined) => { const c = change(cur, prev); return `<span class="${tone(c)}">${signedPct(c)}</span>`; };
const dmy = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MON[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
const dm = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;
const monY = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const monName = (ym: string) => MON[Number(ym.slice(5, 7)) - 1]!;
const fullMonth = (ym: string) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(ym.slice(5, 7)) - 1]!;
const lyLabel = (ymd: string) => ymd.slice(0, 4);

const C = { blue: '#2f5fc4', blueLight: '#7fa0e0', grey: '#c3c9d4', greyDark: '#9aa3b2', orange: '#e8862e', purple: '#7b4fd0', purpleLight: '#c8b6ef', green: '#1a9e74', greenLight: '#9fdcc5', red: '#c2372f', pink: '#f1b0aa', teal: '#1a9e74', ink: '#1c2430', muted: '#5b6573', grid: '#e7eaf0', promo: '#fdf0dc', promoLine: '#f3c98b' };

// ---------------------------------------------------------------- chart helpers (SVG)

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

interface BarSeries { name: string; color: string; values: (number | null)[] }
function bars(o: {
  cats: string[]; sub?: string[]; subColor?: (i: number) => string; series: BarSeries[]; mode: 'stack' | 'group';
  w: number; h: number; fmt: (n: number) => string; labels?: 'top' | 'each' | 'none'; labelFmt?: (n: number) => string;
  bands?: { from: number; to: number; label?: string }[]; brackets?: { from: number; to: number; label: string }[];
  dashedLine?: { value: number; label?: string }; ticks?: number;
}): string {
  const padL = 46, padR = 8, padT = o.brackets?.length ? 26 : 14, padB = o.sub ? 30 : 18;
  const W = o.w, H = o.h, cw = W - padL - padR, ch = H - padT - padB, n = o.cats.length;
  const totals = o.cats.map((_, i) => o.mode === 'stack' ? o.series.reduce((s, se) => s + Math.max(0, se.values[i] ?? 0), 0) : Math.max(...o.series.map(se => se.values[i] ?? 0)));
  const max = niceMax(Math.max(...totals, o.dashedLine?.value ?? 0, 1e-9));
  const y = (v: number) => padT + ch - (v / max) * ch;
  const step = cw / n, bw = o.mode === 'stack' ? step * 0.62 : (step * 0.78) / o.series.length;
  const ticks = o.ticks ?? 4;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="chart">`;
  for (const b of o.bands ?? []) {
    const x0 = padL + b.from * step, x1 = padL + (b.to + 1) * step;
    s += `<rect x="${x0}" y="${padT}" width="${x1 - x0}" height="${ch}" fill="${C.promo}" stroke="${C.promoLine}" stroke-dasharray="3 2"/>`;
    if (b.label) s += `<text x="${x1 - 4}" y="${padT + 10}" text-anchor="end" class="bandlbl">${esc(b.label)}</text>`;
  }
  for (let t = 0; t <= ticks; t++) { const v = (max / ticks) * t; s += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${padL - 5}" y="${y(v) + 3}" text-anchor="end" class="ax">${esc(o.fmt(v))}</text>`; }
  for (const b of o.brackets ?? []) {
    const x0 = padL + b.from * step + 2, x1 = padL + (b.to + 1) * step - 2;
    s += `<path d="M${x0} ${padT - 6} V${padT - 10} H${x1} V${padT - 6}" fill="none" stroke="${C.ink}" stroke-width="0.8"/><text x="${x0}" y="${padT - 13}" class="brk">${esc(b.label)}</text>`;
  }
  o.cats.forEach((c, i) => {
    const cx = padL + i * step + step / 2;
    if (o.mode === 'stack') {
      let acc = 0;
      for (const se of o.series) { const v = Math.max(0, se.values[i] ?? 0); if (!v) continue; s += `<rect x="${cx - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${se.color}"/>`; acc += v; }
      if (o.labels !== 'none' && acc > 0) s += `<text x="${cx}" y="${y(acc) - 3}" text-anchor="middle" class="vl">${esc((o.labelFmt ?? o.fmt)(acc))}</text>`;
    } else {
      o.series.forEach((se, k) => {
        const v = se.values[i]; if (v == null) return;
        const x = cx - (bw * o.series.length) / 2 + k * bw;
        s += `<rect x="${x + 0.5}" y="${y(Math.max(0, v))}" width="${bw - 1}" height="${Math.max(0, y(0) - y(Math.max(0, v)))}" fill="${se.color}"/>`;
        if (o.labels !== 'none' && v > 0) s += `<text x="${x + bw / 2}" y="${y(v) - 3}" text-anchor="middle" class="vl sm">${esc((o.labelFmt ?? o.fmt)(v))}</text>`;
      });
    }
    s += `<text x="${cx}" y="${padT + ch + 11}" text-anchor="middle" class="ax">${esc(c)}</text>`;
    if (o.sub) s += `<text x="${cx}" y="${padT + ch + 21}" text-anchor="middle" class="ax" ${o.subColor ? `fill="${o.subColor(i)}"` : ''}>${esc(o.sub[i] ?? '')}</text>`;
  });
  if (o.dashedLine) { const yy = y(o.dashedLine.value); s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${C.red}" stroke-dasharray="4 3"/>${o.dashedLine.label ? `<text x="${W - padR}" y="${yy - 3}" text-anchor="end" class="ax" fill="${C.red}">${esc(o.dashedLine.label)}</text>` : ''}`; }
  return s + '</svg>';
}

interface LineSeries { name: string; color: string; values: (number | null)[]; dash?: boolean; width?: number; endLabel?: string; dots?: boolean }
function lines(o: {
  n: number; xLabels: { i: number; text: string }[]; series: LineSeries[]; w: number; h: number; fmt: (n: number) => string;
  vline?: { i: number; label?: string }; area?: { upper: (number | null)[]; lower: (number | null)[]; color: string; labels?: { i: number; text: string }[] };
  pointLabels?: { series: number; i: number; text: string }[]; note?: string; ticks?: number; yMin?: number;
}): string {
  const padL = 50, padR = 60, padT = 16, padB = 18, W = o.w, H = o.h, cw = W - padL - padR, ch = H - padT - padB;
  const all = o.series.flatMap(s => s.values.filter((v): v is number => v != null));
  const max = niceMax(Math.max(...all, 1e-9)), min = o.yMin ?? 0;
  const x = (i: number) => padL + (o.n <= 1 ? 0 : (i / (o.n - 1)) * cw);
  const y = (v: number) => padT + ch - ((v - min) / (max - min)) * ch;
  const ticks = o.ticks ?? 4;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="chart">`;
  for (let t = 0; t <= ticks; t++) { const v = min + ((max - min) / ticks) * t; s += `<line x1="${padL}" x2="${padL + cw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${padL - 5}" y="${y(v) + 3}" text-anchor="end" class="ax">${esc(o.fmt(v))}</text>`; }
  if (o.area) {
    const up = o.area.upper.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
    const lo = o.area.lower.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).reverse();
    s += `<polygon points="${[...up, ...lo].join(' ')}" fill="${o.area.color}" opacity="0.55"/>`;
    for (const l of o.area.labels ?? []) { const u = o.area.upper[l.i], d = o.area.lower[l.i]; if (u == null || d == null) continue; s += `<text x="${x(l.i)}" y="${y((u + d) / 2)}" text-anchor="middle" class="vl" fill="#137a5a">${esc(l.text)}</text>`; }
  }
  if (o.vline) s += `<line x1="${x(o.vline.i)}" x2="${x(o.vline.i)}" y1="${padT}" y2="${padT + ch}" stroke="${C.muted}" stroke-dasharray="3 3"/>${o.vline.label ? `<text x="${x(o.vline.i) + 3}" y="${padT + 8}" class="ax">${esc(o.vline.label)}</text>` : ''}`;
  for (const se of o.series) {
    let d = '', started = false;
    se.values.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; started = true; });
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width ?? 1.8}" ${se.dash ? 'stroke-dasharray="5 3"' : ''}/>`;
    if (se.dots) se.values.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i)}" cy="${y(v)}" r="2.4" fill="${se.color}"/>`; });
    const lastI = se.values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
    if (lastI != null && lastI >= 0 && se.endLabel) { const v = se.values[lastI]!; s += `<circle cx="${x(lastI)}" cy="${y(v)}" r="2.6" fill="${se.color}"/><text x="${x(lastI) + 5}" y="${y(v) + 3}" class="ax" fill="${se.color}">${esc(se.endLabel)}</text>`; }
  }
  for (const p of o.pointLabels ?? []) { const v = o.series[p.series]?.values[p.i]; if (v == null) continue; s += `<text x="${x(p.i)}" y="${y(v) - 6}" text-anchor="middle" class="vl sm">${esc(p.text)}</text>`; }
  for (const l of o.xLabels) s += `<text x="${x(l.i)}" y="${padT + ch + 12}" text-anchor="middle" class="ax">${esc(l.text)}</text>`;
  if (o.note) s += `<text x="${padL + 4}" y="${padT + 8}" class="note">${esc(o.note)}</text>`;
  return s + '</svg>';
}

const legend = (items: { color: string; text: string; dash?: boolean; box?: boolean }[]) =>
  `<div class="legend">${items.map(i => `<span><i style="background:${i.box ? 'transparent' : i.color};${i.box ? `border:1px dashed ${C.promoLine};background:${C.promo}` : ''}${i.dash ? `;background:repeating-linear-gradient(90deg,${i.color} 0 4px,transparent 4px 7px)` : ''}"></i>${esc(i.text)}</span>`).join('')}</div>`;

// ---------------------------------------------------------------- page frame

function header(d: D, subtitle: string) {
  return `<div class="hdr"><div><div class="title">EXECUTIVE SUMMARY <span class="bar">|</span> <span class="brand">EXCEL TEST ZONE</span></div><div class="subtitle">${esc(subtitle)}</div></div>
  <div class="meta">Data: ${dmy(d.dataStart)} – ${dmy(d.asOf)}<br>Month to date: ${Number(d.periods.mtd[0].slice(8))}–${dmy(d.periods.mtd[1])} vs ${Number(d.periods.mtdLy[0].slice(8))}–${dmy(d.periods.mtdLy[1])}<br>Prepared ${dmy(d.preparedOn)}</div></div>`;
}
const page = (d: D, n: number, subtitle: string, body: string) => `<section class="page">${header(d, subtitle)}<div class="body">${body}</div>
  <div class="foot"><span>Pascal Press and Blake Education &nbsp;|&nbsp; Internal &nbsp;|&nbsp; Source: ETZ transactions (UMS) and ad accounts, to ${dmy(d.asOf)}</span><span>Page ${n} of 10</span></div></section>`;
const tile = (label: string, value: string, sub: string, cls = '') => `<div class="tile ${cls}"><div class="tl">${esc(label)}</div><div class="tv">${value}</div><div class="ts">${sub}</div></div>`;
const callout = (title: string, text: string) => `<div class="callout"><b>${esc(title)}</b> ${text}</div>`;
const howto = (text: string) => `<div class="howto"><b>How to read this page.</b> ${text}</div>`;
function table(head: string[], rows: string[][], opts: { align?: ('l' | 'r')[]; boldLast?: boolean; cls?: string } = {}) {
  const al = (i: number) => (opts.align?.[i] ?? (i === 0 ? 'l' : 'r'));
  return `<table class="tbl ${opts.cls ?? ''}"><thead><tr>${head.map((h, i) => `<th class="${al(i)}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, k) => `<tr class="${opts.boldLast && k === rows.length - 1 ? 'tot' : ''}">${r.map((c, i) => `<td class="${al(i)}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- pages

function page1(d: D) {
  const m = d.mtd, l = d.mtdLy, cm = d.asOf.slice(0, 7), monthName = fullMonth(cm), mShort = monName(cm);
  const lyFull = d.lyFullMonth;
  const fy = d.fytd, fl = d.fytdLy;
  const onlineNeed = lyFull.online - m.online;
  const last7 = d.monthly.length ? null : null; void last7;
  const dayOfMonth = Number(d.asOf.slice(8, 10));
  const runRate = dayOfMonth ? m.online / dayOfMonth : 0;
  const daysToPass = runRate > 0 && onlineNeed > 0 ? Math.ceil(onlineNeed / runRate) : null;
  const glance = [
    `<b>${monthName} to date:</b> ${money(m.total)} (${money(m.online)} online, ${money(m.schools)} schools) from ${int(m.customers)} paying online customers${d.schoolCountsAvailable ? ` and ${int(m.payingSchools)} paying schools` : ''}, ${signedPct(change(m.total, l.total))} on ${money(l.total)} same period last year. Online is ${signedPct(change(m.online, l.online))}.`,
    `<b>Financial year to date (Jul–${mShort}):</b> ${money(fy.total)}, ${signedPct(change(fy.total, fl.total))} on ${money(fl.total)}. Schools ${money(fy.schools)} vs ${money(fl.schools)} (${signedPct(change(fy.schools, fl.schools))}); online ${money(fy.online)} vs ${money(fl.online)} (${signedPct(change(fy.online, fl.online))}).`,
    `<b>Trial customers:</b> ${int(m.trialCustomers)} in ${monthName} to date vs ${int(l.trialCustomers)} last year (${signedPct(change(m.trialCustomers, l.trialCustomers))}); ${int(fy.trialCustomers)} FYTD vs ${int(fl.trialCustomers)} (${signedPct(change(fy.trialCustomers, fl.trialCustomers))}).`,
    `<b>Conversion:</b> ${pctOf(d.allCohorts.rateToDate, 1)} of trial customers (${int(d.allCohorts.boughtToDate)} of ${int(d.allCohorts.trialCustomers)}) went on to buy a paid pack; ${pctOf(d.allCohorts.rate30, 1)} within 30 days.${d.timeToBuy ? ` Median time from trial to purchase is ${d.timeToBuy.medianDays} days.` : ''} ${pctOf(d.onlineBuyersTrialledFirst)} of online buyers trialled first.`,
    m.customers > lyFull.customers
      ? `<b>${monthName} has beaten last ${monthName} on customers:</b> ${int(m.customers)} paying online customers vs ${int(lyFull.customers)} for all of ${monName(cm)} ${Number(cm.slice(0, 4)) - 1}.${onlineNeed > 0 ? ` Online needs ${moneyK1(onlineNeed)} more to pass last ${monthName}'s ${moneyK1(lyFull.online)}${daysToPass ? `; at ~${moneyK1(runRate)} a day that lands around ${dm(addDaysLocal(d.asOf, daysToPass))}` : ''}.` : ` Online has already passed last ${monthName}'s ${moneyK1(lyFull.online)}.`}`
      : `<b>Against all of last ${monthName}:</b> ${int(m.customers)} of ${int(lyFull.customers)} paying online customers so far; online ${moneyK1(m.online)} of ${moneyK1(lyFull.online)}.`,
    d.promo.tyToDate && d.promo.lySameDates ? `<b>Promo ${Number(d.promo.thisYear.start.slice(8))}–${dm(d.promo.tyToDate.end)}:</b> ${int(d.promo.tyToDate.customers)} paying customers vs ${int(d.promo.lySameDates.customers)} same dates last year (${signedPct(change(d.promo.tyToDate.customers, d.promo.lySameDates.customers))}), ${moneyK1(d.promo.tyToDate.online)} vs ${moneyK1(d.promo.lySameDates.online)} online (${signedPct(change(d.promo.tyToDate.online, d.promo.lySameDates.online))}). Trials ${signedPct(change(d.promo.tyToDate.trialCustomers, d.promo.lySameDates.trialCustomers))} (${int(d.promo.tyToDate.trialCustomers)} vs ${int(d.promo.lySameDates.trialCustomers)}).` : '',
    `<b>Data note:</b> full history from ${dmy(d.dataStart)} loaded; report runs to ${dm(d.asOf)} (last complete day). ${(() => { const a = d.ads[d.ads.length - 1]; return a && a.total != null ? `${monthName} ad spend to date ${money(a.total)} (Google ${money(a.google)}, Meta ${money(a.meta)}).` : ''; })()}`,
  ].filter(Boolean);
  const t1 = [
    tile(`Revenue, ${mShort} to date`, money(m.total), `${chg(m.total, l.total)} vs ${money(l.total)} last year`),
    tile(`Online revenue, ${mShort}`, money(m.online), `${chg(m.online, l.online)} vs ${money(l.online)} last year`),
    tile(`School revenue, ${mShort}`, money(m.schools), `${money(l.schools)} last year | FYTD ${money(fy.schools)}`),
    tile(`Paying online customers, ${mShort}`, int(m.customers), `${chg(m.customers, l.customers)} vs ${int(l.customers)} last year${d.schoolCountsAvailable ? ` | + ${int(m.payingSchools)} paying schools` : ''}`),
    tile(`Trial customers, ${mShort}`, int(m.trialCustomers), `${chg(m.trialCustomers, l.trialCustomers)} vs ${int(l.trialCustomers)} last year`),
  ].join('');
  const netNow = d.base.months[d.base.months.length - 1];
  const netFy = d.base.months.reduce((s, x) => s + x.net, 0);
  const t2 = [
    tile(`Current trialists (as at ${dm(d.preparedOn)})`, int(d.current.trialists30), `started a trial in the last 30 days | ${int(d.current.notYetPaying)} not yet paying | ${int(d.current.trialists30Ly)} a year ago`, 'alt'),
    tile('Current paying customers', int(d.current.paying12), `${chg(d.current.paying12, d.current.payingPrev12)} vs ${int(d.current.payingPrev12)} customers in the previous 12 months`, 'alt'),
    tile('Currently subscribed schools', d.schoolCountsAvailable ? int(d.current.schools12) : 'n/a', d.schoolCountsAvailable ? `${int(d.current.payingSchools12)} paying + ${int(d.current.schools12 - d.current.payingSchools12)} on $0 allocations, last 12 months` : 'needs a school id in the UMS feed (requested)', 'alt'),
    tile(`Net online sign-ups, ${mShort}`, netNow ? `<span class="${tone(netNow.net)}">${signedInt(netNow.net)}</span>` : '–', netNow ? `${int(netNow.newCustomers)} new customers − ${int(netNow.lapsed)} lapsed | FYTD ${signedInt(netFy)} (see page 6)` : '', 'alt'),
  ].join('');
  const rows = d.monthly.map(x => [`${monY(x.month)}${x.partial ? ' *' : ''}`, money(x.online), money(x.schools), `<b>${money(x.total)}</b>`, money(x.aov), int(x.customers), d.schoolCountsAvailable ? int(x.payingSchools) : '–', int(x.trialCustomers)]);
  const tot = d.monthly.reduce((a, x) => ({ o: a.o + x.online, s: a.s + x.schools, ord: a.ord + x.orders }), { o: 0, s: 0, ord: 0 });
  rows.push(['Total shown', money(tot.o), money(tot.s), money(tot.o + tot.s), money(tot.ord ? tot.o / tot.ord : null), '–', '–', '–']);
  const chart = bars({ cats: d.monthly.map(x => monY(x.month)), series: [{ name: 'Online', color: C.blue, values: d.monthly.map(x => x.online) }, { name: 'Schools', color: C.orange, values: d.monthly.map(x => x.schools) }], mode: 'stack', w: 1040, h: 120, fmt: v => moneyK(v), labelFmt: v => moneyK(v) });
  return page(d, 1, 'Sales revenue, paid orders and channel split', `
    <div class="glance"><b class="gt">At a glance</b><ul>${glance.map(g => `<li>${g}</li>`).join('')}</ul></div>
    <div class="tiles t5">${t1}</div><div class="tiles t4">${t2}</div>
    <h3>Revenue by month, online vs schools</h3>${legend([{ color: C.blue, text: 'Online (Stripe)' }, { color: C.orange, text: 'Schools' }])}<span class="lnote">Label = total. Duplicated bundle rows excluded. * ${monY(cm)} is ${dm(d.periods.mtd[0])}–${dm(d.asOf)} only. Online AOV = online revenue ÷ online orders (one checkout, may hold several packs).</span>
    ${chart}
    ${table(['Month', 'Online', 'Schools', 'Total revenue', 'Online AOV', 'Paying online customers', 'Paying schools', 'Trial customers'], rows, { boldLast: true, cls: 'dense' })}`);
}
function addDaysLocal(ymd: string, n: number) { const t = new Date(`${ymd}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

function page2(d: D) {
  const cm = d.asOf.slice(0, 7), mShort = monName(cm), lyYear = String(Number(cm.slice(0, 4)) - 1);
  const m = d.mtd, l = d.mtdLy, lf = d.lyFullMonth, rest = d.lyRest;
  const ratio = (w: Win) => (w.trialCustomers ? w.customers / w.trialCustomers : null);
  const t = [
    tile(`Trial customers, 1–${Number(d.asOf.slice(8))} ${mShort}`, int(m.trialCustomers), `${chg(m.trialCustomers, l.trialCustomers)} vs ${int(l.trialCustomers)} same dates ${lyYear}`),
    tile(`Paying customers, 1–${Number(d.asOf.slice(8))} ${mShort}`, int(m.customers), `${chg(m.customers, l.customers)} vs ${int(l.customers)} same dates ${lyYear}`),
    tile(`Paying per trial customer, 1–${Number(d.asOf.slice(8))} ${mShort}`, ratio(m)?.toFixed(2) ?? '–', `${ratio(l)?.toFixed(2) ?? '–'} same dates ${lyYear} (ratio, not conversion)`),
    tile(`${fullMonth(cm)} ${lyYear}, full month`, `${int(lf.trialCustomers)} | ${int(lf.customers)}`, 'trial customers | paying customers'),
    tile(`Rest of ${mShort} ${lyYear} (${rest ? `${dm(rest.start)}–${dm(rest.end)}` : '–'})`, rest ? `${int(rest.trialCustomers)} | ${int(rest.customers)}` : '–', 'more trial | paying customers still to match'),
  ].join('');
  const days = d.daily;
  const wk = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const sub = days.map(x => wk[x.weekday]!);
  const subColor = (i: number) => (days[i]!.weekday === 0 || days[i]!.weekday === 6 ? C.orange : C.muted);
  const toIdx = (ymd: string) => Number(ymd.slice(8, 10)) - 1;
  const promoTy = d.promo.thisYear.start.slice(0, 7) === cm ? { from: toIdx(d.promo.thisYear.start), to: Math.min(toIdx(d.promo.thisYear.end), days.length - 1), label: d.promo.thisYear.label } : null;
  const promoLy = d.promo.lastYear.start.slice(5, 7) === cm.slice(5, 7) ? { from: toIdx(d.promo.lastYear.start), to: toIdx(d.promo.lastYear.end), label: `${d.promo.lastYear.label} →` } : null;
  const dayChart = (key: 'trials' | 'paying', tyColor: string, lyColor: string) => bars({
    cats: days.map(x => String(x.day)), sub, subColor, mode: 'group', w: 1040, h: 150, fmt: v => int(v), labelFmt: v => int(v),
    series: [{ name: 'TY', color: tyColor, values: days.map(x => x.ty?.[key] ?? null) }, { name: 'LY', color: lyColor, values: days.map(x => x.ly?.[key] ?? null) }],
    bands: promoTy ? [promoTy] : [], brackets: promoLy ? [promoLy] : [],
  });
  const cumN = Math.max(d.cumulativePaying.ty.length, d.cumulativePaying.ly.length);
  const lyTot = d.cumulativePaying.ly[d.cumulativePaying.ly.length - 1] ?? 0, tyTot = d.cumulativePaying.ty[d.cumulativePaying.ty.length - 1] ?? 0;
  const lySame = d.cumulativePaying.ly[d.cumulativePaying.ty.length - 1] ?? 0;
  const cum = lines({ n: cumN, xLabels: [0, 5, 10, 15, 20, 25].filter(i => i < cumN).map(i => ({ i, text: String(i + 1) })), w: 420, h: 150, fmt: v => int(v),
    series: [{ name: 'TY', color: C.blue, values: d.cumulativePaying.ty, width: 2.2, endLabel: `${int(tyTot)} vs ${int(lySame)} LY (${Math.round((tyTot / (lyTot || 1)) * 100)}% of LY mo)` }, { name: 'LY', color: C.grey, values: d.cumulativePaying.ly, endLabel: `${int(lyTot)} LY month` }] });
  const wrows = d.weekBuckets.map(b => {
    const lab = `${b.from}–${b.to} ${mShort}${b.partialTo ? ` (to ${b.partialTo})` : ''}`;
    const ly = b.ly, ty = b.ty;
    return [lab, int(ly?.trials), ty ? int(ty.trials) : '–', ty && ly ? chg(ty.trials, ly.trials) : '', int(ly?.paying), ty ? int(ty.paying) : '–', ty && ly ? chg(ty.paying, ly.paying) : ''];
  });
  wrows.push(['Month to date', int(l.trialCustomers), int(m.trialCustomers), chg(m.trialCustomers, l.trialCustomers), int(l.customers), int(m.customers), chg(m.customers, l.customers)]);
  wrows.push([`Full ${mShort} ${lyYear}`, int(lf.trialCustomers), '', '', int(lf.customers), '', '']);
  const since = d.promo.tyToDate ? null : null; void since;
  const what = `${m.customers >= l.customers ? `Paying customers are ahead of the same dates last year (${int(m.customers)} vs ${int(l.customers)}, ${signedPct(change(m.customers, l.customers))})` : `Paying customers are behind the same dates last year (${int(m.customers)} vs ${int(l.customers)}, ${signedPct(change(m.customers, l.customers))})`}${m.customers > lf.customers ? `, and already past all of last ${fullMonth(cm)} (${int(lf.customers)}), so the month is won on customers.` : `; the rest of last ${fullMonth(cm)} added ${rest ? int(rest.customers) : '–'} more.`} Trials are ${m.trialCustomers >= l.trialCustomers ? 'ahead' : 'behind'} for the month (${int(m.trialCustomers)} vs ${int(l.trialCustomers)}).${m.trialCustomers < l.trialCustomers ? ' A trial-focused offer is what would lift the top of the funnel.' : ''}`;
  return page(d, 2, `${fullMonth(cm)} ${cm.slice(0, 4)} day by day: trial customers and paying online customers vs last year`, `
    <div class="tiles t5">${t}</div>
    <h3>Trial customers per day</h3>${legend([{ color: C.purple, text: `Trial customers, ${mShort} ${cm.slice(0, 4)}` }, { color: C.purpleLight, text: `Trial customers, same date ${lyYear}` }, { color: C.promo, text: 'Promo window', box: true }])}<span class="lnote">${cm.slice(0, 4)} shown to ${dm(d.asOf)}; ${lyYear} shown for the whole month</span>
    ${dayChart('trials', C.purple, C.purpleLight)}
    <h3>Paying online customers per day</h3>${legend([{ color: C.blue, text: `Paying customers, ${mShort} ${cm.slice(0, 4)}` }, { color: C.grey, text: `Paying customers, same date ${lyYear}` }, { color: C.promo, text: 'Promo window', box: true }])}
    ${dayChart('paying', C.blue, C.grey)}
    <div class="grid3"><div><h3>Paying online customers, cumulative through ${fullMonth(cm)}</h3>${legend([{ color: C.blue, text: `${cm.slice(0, 4)} to ${dm(d.asOf)}` }, { color: C.grey, text: `${lyYear} full month` }])}${cum}</div>
    <div><h3>By week of the month (customers)</h3>${table(['Days', `Trial ${lyYear}`, `Trial ${cm.slice(0, 4)}`, '%', `Paying ${lyYear}`, `Paying ${cm.slice(0, 4)}`, '%'], wrows, { cls: 'dense' })}</div>
    ${callout('What this shows.', what)}</div>
    ${howto(`Every figure counts customers, not packs: trial customers = parent accounts starting a free trial; paying customers = parent accounts buying a paid online pack (Stripe above $0). A customer taking several packs counts once. Daily bars count each customer once per day, so days do not add to the month; the cumulative line, weekly table and tiles count each customer once in the period shown. School purchases are not included. Last year is matched by calendar date (1 ${mShort} vs 1 ${mShort}), so weekdays do not line up; weekend days are marked in orange on the axis. Complete days only.`)}`);
}

function page3(d: D) {
  const f = d.fytd, l = d.fytdLy, cmShort = monName(d.asOf.slice(0, 7));
  const t = [
    tile('Total revenue FYTD', money(f.total), `${chg(f.total, l.total)} vs ${money(l.total)}`),
    tile('Online revenue FYTD', money(f.online), `${chg(f.online, l.online)} vs ${money(l.online)}`),
    tile('School revenue FYTD', money(f.schools), `${chg(f.schools, l.schools)} vs ${money(l.schools)}`),
    tile('Trial customers FYTD', int(f.trialCustomers), `${chg(f.trialCustomers, l.trialCustomers)} vs ${int(l.trialCustomers)}`),
    tile('Paying customers FYTD', int(f.customers), `${chg(f.customers, l.customers)} vs ${int(l.customers)}`),
    tile('Schools FYTD', d.schoolCountsAvailable ? int(f.allSchools) : 'n/a', d.schoolCountsAvailable ? `${chg(f.allSchools, l.allSchools)} vs ${int(l.allSchools)} | paying ${int(f.payingSchools)} vs ${int(l.payingSchools)}` : 'needs a school id in the UMS feed'),
  ].join('');
  const row = (name: string, a: number, b: number, isMoney = true) => [name, isMoney ? money(a) : int(a), isMoney ? money(b) : int(b), `<span class="${tone(b - a)}">${isMoney ? signedMoney(b - a) : signedInt(b - a)}</span>`, chg(b, a)];
  const streams = [row('Online', l.online, f.online), row('Schools', l.schools, f.schools), row('Total revenue', l.total, f.total)];
  const linesT = (['Bundles', 'NAPLAN', 'Selective & Scholarship', 'Opportunity Class', 'Assessment / Skills Check'] as const).map(k => row(k, l.byLine[k], f.byLine[k]));
  const cust = [row('Trial customers', l.trialCustomers, f.trialCustomers, false), row('Trial customers who bought in the period', l.trialBought, f.trialBought, false), row('Paying online customers', l.customers, f.customers, false)];
  if (d.schoolCountsAvailable) cust.push(row('Schools, total (incl. $0 allocations)', l.allSchools, f.allSchools, false), row('Schools, paying', l.payingSchools, f.payingSchools, false));
  const fb = d.fyMonthlyBars, cats = fb.map(x => monName(x.month));
  const mini = (key: 'online' | 'schools' | 'trials' | 'paying', fmt: (n: number) => string) => bars({ cats, mode: 'group', w: 300, h: 185, fmt, labelFmt: fmt, series: [{ name: 'LY', color: C.grey, values: fb.map(x => x.ly[key]) }, { name: 'TY', color: C.blue, values: fb.map(x => x.ty[key]) }] });
  const lineDiffs = (['Bundles', 'NAPLAN', 'Selective & Scholarship', 'Opportunity Class', 'Assessment / Skills Check'] as const).map(k => `${k} ${signedPct(change(f.byLine[k], l.byLine[k]))}`).join(', ');
  const read = `Revenue is ${signedPct(change(f.total, l.total))} (${moneyK1(f.total)} vs ${moneyK1(l.total)}); schools ${moneyK1(f.schools)} vs ${moneyK1(l.schools)}, online ${moneyK1(f.online)} vs ${moneyK1(l.online)} (${signedPct(change(f.online, l.online))}). Paying online customers ${int(f.customers)} vs ${int(l.customers)} (${signedPct(change(f.customers, l.customers))}); trials ${int(f.trialCustomers)} vs ${int(l.trialCustomers)} (${signedPct(change(f.trialCustomers, l.trialCustomers))}). By product line: ${lineDiffs}.`;
  return page(d, 3, 'Financial year to date vs last year: revenue streams, trial customers, paying customers and schools', `
    <div class="tiles t6">${t}</div>
    <div class="grid2"><div>
      <h3>Revenue by stream</h3>${table(['', 'FYTD last year', 'FYTD this year', 'Change', '%'], streams, { boldLast: true })}
      <h3>Online revenue by product line</h3>${table(['', 'FYTD last year', 'FYTD this year', 'Change', '%'], linesT)}
      <h3>Customers${d.schoolCountsAvailable ? ' and schools' : ''}</h3>${table(['', 'FYTD last year', 'FYTD this year', 'Change', '%'], cust)}
    </div><div>
      ${legend([{ color: C.grey, text: 'Last year' }, { color: C.blue, text: 'This year' }])}<span class="lnote">${cmShort} = 1–${Number(d.asOf.slice(8))} ${cmShort} both years</span>
      <div class="grid2 tight"><div><h4>Online revenue</h4>${mini('online', v => moneyK1(v))}</div><div><h4>School revenue</h4>${mini('schools', v => moneyK1(v))}</div>
      <div><h4>Trial customers</h4>${mini('trials', v => int(v))}</div><div><h4>Paying online customers</h4>${mini('paying', v => int(v))}</div></div>
      ${callout('Read-out.', read)}
    </div></div>
    ${howto(`FYTD = 1 Jul to ${dm(d.asOf)}, both years (complete days). All counts are customers (parent accounts), not packs. Paying customers = parent accounts with a paid online purchase in the period. UMS manual entries (students added to an existing school licence) are left out. Online revenue excludes duplicated bundle rows and any order listed as refunded.`)}`);
}

function page4(d: D) {
  const a = d.r12, b = d.p12;
  const t = [
    tile('Total revenue, rolling 12M', money(a.total), `${chg(a.total, b.total)} vs ${money(b.total)}`),
    tile('Online revenue', money(a.online), `${chg(a.online, b.online)} vs ${money(b.online)}`),
    tile('School revenue', money(a.schools), `${chg(a.schools, b.schools)} vs ${money(b.schools)}`),
    tile('Paying online customers', int(a.customers), `${chg(a.customers, b.customers)} vs ${int(b.customers)}`),
    tile('Trial customers', int(a.trialCustomers), `${chg(a.trialCustomers, b.trialCustomers)} vs ${int(b.trialCustomers)}`),
    tile('Customers who bought again', pctOf(d.boughtAgain.rate), `${int(d.boughtAgain.count)} of ${int(d.boughtAgain.of)} previous-12m customers`),
  ].join('');
  const row = (name: string, x: number, y: number, isMoney = true) => [name, isMoney ? money(x) : int(x), isMoney ? money(y) : int(y), `<span class="${tone(y - x)}">${isMoney ? signedMoney(y - x) : signedInt(y - x)}</span>`, chg(y, x)];
  const rev = [row('Online', b.online, a.online), row('Schools', b.schools, a.schools), row('Total revenue', b.total, a.total),
    ...(['Bundles', 'NAPLAN', 'Selective & Scholarship', 'Opportunity Class', 'Assessment / Skills Check'] as const).map(k => row(`&nbsp;&nbsp;Online: ${k}`, b.byLine[k], a.byLine[k])),
    row('Online revenue per paying customer', b.customers ? b.online / b.customers : 0, a.customers ? a.online / a.customers : 0)];
  const cust = [row('Trial customers', b.trialCustomers, a.trialCustomers, false), row('Trial customers who bought in the period', b.trialBought, a.trialBought, false), row('Paying online customers', b.customers, a.customers, false), row('&nbsp;&nbsp;New (never paid before)', b.newCustomers, a.newCustomers, false), row('&nbsp;&nbsp;Returning', b.returning, a.returning, false)];
  const rm = d.r12Months, cats = rm.map(x => `${monName(x.month)}${x.partial ? '*' : ''}`);
  const tr = d.r12Trend;
  const trendX = tr.map((x, i) => ({ i, text: monY(x.month) })).filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  const read = `Revenue is ${signedPct(change(a.total, b.total))} (${moneyK(a.total)} vs ${moneyK(b.total)}). Online is ${signedPct(change(a.online, b.online))} (${moneyK(a.online)} vs ${moneyK(b.online)}) from ${int(a.customers)} paying customers vs ${int(b.customers)} (${signedPct(change(a.customers, b.customers))}); bundles took ${moneyK(a.byLine.Bundles)} vs ${moneyK(b.byLine.Bundles)}. Schools ${moneyK(a.schools)} vs ${moneyK(b.schools)}. New customers ${int(a.newCustomers)} vs ${int(b.newCustomers)} (${signedPct(change(a.newCustomers, b.newCustomers))}); ${pctOf(d.boughtAgain.rate)} of last year's customers bought again${d.boughtAgain.prevRate != null ? ` (${pctOf(d.boughtAgain.prevRate)} a year earlier)` : ''}.`;
  return page(d, 4, `Rolling 12 months (${dm(d.periods.r12[0])} ${d.periods.r12[0].slice(0, 4)} – ${dmy(d.periods.r12[1])}) vs previous 12 months (${dm(d.periods.p12[0])} ${d.periods.p12[0].slice(0, 4)} – ${dmy(d.periods.p12[1])})`, `
    <div class="tiles t6">${t}</div>
    <div class="grid2"><div>
      <h3>Revenue and channels</h3>${table(['', 'Previous 12 months', 'Rolling 12 months', 'Change', '%'], rev, { cls: 'dense' })}
      <h3>Customers</h3>${table(['', 'Previous 12 months', 'Rolling 12 months', 'Change', '%'], cust, { cls: 'dense' })}
      ${callout('Read-out.', read)}
    </div><div>
      <h3>Total revenue by month across each 12-month window</h3>${legend([{ color: C.grey, text: 'Previous 12 months' }, { color: C.blue, text: 'Rolling 12 months' }])}<span class="lnote">* part month</span>
      ${bars({ cats, mode: 'group', w: 520, h: 140, fmt: v => moneyK(v), labels: 'none', series: [{ name: 'P', color: C.grey, values: rm.map(x => x.ly.total) }, { name: 'R', color: C.blue, values: rm.map(x => x.ty.total) }] })}
      <h3>Paying online customers by month</h3>${legend([{ color: C.grey, text: 'Previous 12 months' }, { color: C.blue, text: 'Rolling 12 months' }])}
      ${bars({ cats, mode: 'group', w: 520, h: 130, fmt: v => int(v), labels: 'none', series: [{ name: 'P', color: C.grey, values: rm.map(x => x.ly.paying) }, { name: 'R', color: C.blue, values: rm.map(x => x.ty.paying) }] })}
    </div></div>
    <div class="grid2"><div><h3>Rolling 12-month revenue, at each month end</h3>${legend([{ color: C.blue, text: 'Online' }, { color: C.orange, text: 'Schools' }])}
      ${lines({ n: tr.length, xLabels: trendX, w: 520, h: 120, fmt: v => moneyK(v), series: [{ name: 'Online', color: C.blue, values: tr.map(x => x.online), endLabel: moneyK(tr[tr.length - 1]?.online) }, { name: 'Schools', color: C.orange, values: tr.map(x => x.schools), endLabel: moneyK(tr[tr.length - 1]?.schools) }] })}</div>
    <div><h3>Rolling 12-month customers, at each month end</h3>${legend([{ color: C.blue, text: 'Paying online customers' }, { color: C.purple, text: 'Trial customers (dashed)', dash: true }])}
      ${lines({ n: tr.length, xLabels: trendX, w: 520, h: 120, fmt: v => int(v), series: [{ name: 'Paying', color: C.blue, values: tr.map(x => x.paying), endLabel: int(tr[tr.length - 1]?.paying) }, { name: 'Trials', color: C.purple, dash: true, values: tr.map(x => x.trials), endLabel: int(tr[tr.length - 1]?.trials) }] })}</div></div>
    ${howto(`Rolling 12 months = the 365 days to ${dm(d.asOf)}; previous 12 months = the 365 days before that, so both windows cover the same calendar dates and seasons. Customers are counted once per window (parent account). New = first ever paid online purchase falls in the window; returning = bought before. Bought again = customers from the previous 12 months who made another paid purchase in the rolling 12 months. Trend lines show the 12-month total at each month end.`)}`);
}

function page5(d: D) {
  const co = d.cohorts, cats = co.map(x => monY(x.month));
  const tcPerMonth = d.monthly.map(x => x.trialCustomers);
  const conv30 = bars({ cats, mode: 'stack', w: 520, h: 140, fmt: v => pctOf(v), labelFmt: v => pctOf(v), series: [{ name: '30', color: C.green, values: co.map(x => x.rate30 ?? 0) }, { name: 'later', color: C.greenLight, values: co.map(x => (x.rateToDate ?? 0) - (x.rate30 ?? 0)) }] });
  const total = bars({ cats, mode: 'group', w: 520, h: 140, fmt: v => pctOf(v), labelFmt: v => pctOf(v), dashedLine: { value: d.allCohorts.rateToDate ?? 0 },
    series: [{ name: 'old', color: C.green, values: co.map(x => (x.ageDays >= 90 ? x.rateToDate : null)) }, { name: 'young', color: C.greenLight, values: co.map(x => (x.ageDays < 90 ? x.rateToDate : null)) }] });
  const rows = co.map(x => [monY(x.month), int(x.trialCustomers), int(x.bought30), pctOf(x.rate30, 1), int(x.boughtToDate), `<b>${pctOf(x.rateToDate, 1)}</b>`, int(x.newBuyers), pctOf(x.trialledPct)]);
  rows.push(['<b>All cohorts</b>', int(d.allCohorts.trialCustomers), int(d.allCohorts.bought30), pctOf(d.allCohorts.rate30, 1), int(d.allCohorts.boughtToDate), `<b>${pctOf(d.allCohorts.rateToDate, 1)}</b>`, int(d.allCohorts.newBuyers), pctOf(d.allCohorts.trialledPct)]);
  const packs = d.packConversion.map(p => [esc(p.pack), int(p.trialCustomers), int(p.boughtToDate), pctOf(p.rateToDate, 1)]);
  const tb = d.timeToBuy;
  const cur = co[co.length - 1];
  const best = co.filter(x => x.month >= d.periods.fy[0].slice(0, 7)).reduce((m, x) => ((x.rate30 ?? 0) > (m?.rate30 ?? -1) ? x : m), null as (typeof co)[number] | null);
  const stand = cur ? `The ${fullMonth(cur.month.slice(0, 7))} trial cohort has converted ${pctOf(cur.rateToDate)} in ${Number(d.asOf.slice(8))} days${best && best.month === cur.month ? ', the best this financial year' : ''}. ${cur.trialCustomers < (co[co.length - 13]?.trialCustomers ?? Infinity) ? 'Trial quality is fine; trial volume is the problem.' : ''}` : '';
  return page(d, 5, 'Trial customers, paying customers and trial-to-paid conversion', `
    <div class="grid2"><div>
      <h3>Trial customers per month</h3><span class="lnote">Unique customers (parent account) starting a trial in the month. A parent trialling two year levels counts once.</span>
      ${bars({ cats, mode: 'group', w: 520, h: 95, fmt: v => int(v), series: [{ name: 'T', color: C.purple, values: tcPerMonth }] })}
      <h3>Trial-to-paid conversion, by month of first trial</h3>${legend([{ color: C.green, text: 'Bought within 30 days' }, { color: C.greenLight, text: 'Bought later' }])}<span class="lnote">Label = total to date</span>
      ${conv30}
      ${callout('What stands out.', stand)}
      <h3>Total trial-to-paid conversion (bought at any time after trial), by month of first trial</h3>${legend([{ color: C.green, text: 'Trial month 90+ days ago' }, { color: C.greenLight, text: 'Under 90 days, still converting' }])}<span class="lnote">All trialers to date: ${pctOf(d.allCohorts.rateToDate, 1)}</span>
      ${total}
    </div><div>
      <h3>Paying customers per month</h3>${legend([{ color: C.blue, text: 'Online customers' }])}
      ${bars({ cats, mode: 'group', w: 520, h: 95, fmt: v => int(v), series: [{ name: 'P', color: C.blue, values: d.monthly.map(x => x.customers) }] })}
      <h3>Conversion detail</h3>${table(['Trial month', 'Trial customers', 'Bought ≤30d', 'Rate ≤30d', 'Bought to date', 'Rate to date', 'New online buyers', '% who trialled'], rows, { boldLast: true, cls: 'dense' })}
      <h3>Conversion by first trial pack (top 6, 300+ trial customers)</h3>${table(['First trial pack', 'Trial customers', 'Bought', 'Rate'], packs, { cls: 'dense' })}
      ${tb ? `<div class="ttb"><div><span class="big">${tb.medianDays} days</span><span>median</span></div><div><span class="big">${tb.meanDays} days</span><span>average</span></div><div class="ttbn">${int(tb.converters)} converters; the average is pulled up by families returning months later</div>
      <div class="ttbar">${[['Same day', tb.buckets.sameDay], ['1–7 days', tb.buckets.d1to7], ['8–30 days', tb.buckets.d8to30], ['31–90 days', tb.buckets.d31to90], ['90+ days', tb.buckets.d90plus]].map(([k, v], i) => `<span style="flex:${Number(v)};background:${['#1a9e74', '#3fb28d', '#74c8a9', '#a9dec9', '#d4efe4'][i]}">${k} ${pctOf(Number(v))}</span>`).join('')}</div></div>` : ''}
    </div></div>
    ${howto(`Online = Stripe purchases above $0. Customers = parent accounts, so a customer buying several packs counts once. UMS manual entries (${int(d.dataNotes.manualRows)} rows: students added to an existing school licence) are left out of every count. Conversion = a parent account that started a free trial and then made a paid online purchase (any pack) on or after its first trial; each counted once, in the month of its first trial. Recent cohorts are still converting, so compare them on the 30-day rate. <b>Data note:</b> some online bundle purchases appear twice in the transaction list (same parent, same minute, same bundle, full price on both rows: ${int(d.dataNotes.duplicateRows)} extra rows, ${money(d.dataNotes.duplicateValue)}; last seen ${d.dataNotes.duplicateLastSeen ? dmy(d.dataNotes.duplicateLastSeen) : '–'}). All figures exclude these rows.`)}`);
}

function page6(d: D) {
  const b = d.base, cm = d.asOf.slice(0, 7);
  const cur = b.months[b.months.length - 1];
  const netFy = b.months.reduce((s, x) => s + x.net, 0), newFy = b.months.reduce((s, x) => s + x.newCustomers, 0), lapFy = b.months.reduce((s, x) => s + x.lapsed, 0);
  const t = [
    tile(`Net online sign-ups, ${monName(cm)}`, cur ? `<span class="${tone(cur.net)}">${signedInt(cur.net)}</span>` : '–', cur ? `${int(cur.newCustomers)} new customers − ${int(cur.lapsed)} lapsed` : ''),
    tile('Net online sign-ups, FYTD', `<span class="${tone(netFy)}">${signedInt(netFy)}</span>`, `${int(newFy)} new − ${int(lapFy)} lapsed (${monY(b.months[0]?.month ?? cm)}–${monY(cm)})`),
    tile('Active paying customers', int(b.activeNow), `paid pack in the last 12 months, as at ${dm(d.preparedOn)}`),
    tile('Lapsing next 90 days', int(b.lapseNext90), `${int(b.lapseNext30)} in the next 30 days (customers)`),
    tile('Biggest 2-month lapse ahead', int(b.biggestPair.lapsing), `customers lapsing ${b.biggestPair.months.map(monY).join('–')}`),
  ].join('');
  // diverging chart
  const all = [...b.months.map(x => ({ m: x.month, pos: x.newCustomers, neg: x.lapsed, sched: x.month === cm ? b.lapseRestOfMonth : 0 })), ...b.scheduled.map(x => ({ m: x.month, pos: 0, neg: 0, sched: x.lapsing }))];
  const W = 1040, H = 255, padL = 46, padT = 14, padB = 18, cw = W - padL - 8, ch = H - padT - padB;
  const maxPos = niceMax(Math.max(...all.map(x => x.pos), 1)), maxNeg = niceMax(Math.max(...all.map(x => x.neg + x.sched), 1));
  const tickStep = niceMax(Math.max(maxPos, maxNeg) / 3); const topT = Math.ceil(Math.max(...all.map(x => x.pos), 1) / tickStep) * tickStep, botT = Math.ceil(Math.max(...all.map(x => x.neg + x.sched), 1) / tickStep) * tickStep;
  const tot = topT + botT, zero = padT + (topT / tot) * ch, sc = ch / tot, step = cw / all.length, bw = step * 0.62;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
  const tickVals: number[] = []; for (let v = topT; v >= -botT - 1e-9; v -= tickStep) tickVals.push(Math.round(v));
  for (const v of tickVals) svg += `<line x1="${padL}" x2="${W - 8}" y1="${zero - v * sc}" y2="${zero - v * sc}" stroke="${v === 0 ? C.greyDark : C.grid}"/><text x="${padL - 5}" y="${zero - v * sc + 3}" text-anchor="end" class="ax">${v < 0 ? '−' : ''}${int(Math.abs(v))}</text>`;
  all.forEach((x, i) => {
    const cx = padL + i * step + step / 2;
    if (x.pos) svg += `<rect x="${cx - bw / 2}" y="${zero - x.pos * sc}" width="${bw}" height="${x.pos * sc}" fill="${C.blue}"/><text x="${cx}" y="${zero - x.pos * sc - 3}" text-anchor="middle" class="vl">+${int(x.pos)}</text>`;
    if (x.neg) svg += `<rect x="${cx - bw / 2}" y="${zero}" width="${bw}" height="${x.neg * sc}" fill="${C.red}"/>`;
    if (x.sched) svg += `<rect x="${cx - bw / 2}" y="${zero + x.neg * sc}" width="${bw}" height="${x.sched * sc}" fill="${C.pink}"/>`;
    if (x.neg + x.sched) svg += `<text x="${cx}" y="${zero + (x.neg + x.sched) * sc + 9}" text-anchor="middle" class="vl">−${int(x.neg + x.sched)}</text>`;
    svg += `<text x="${cx}" y="${H - 4}" text-anchor="middle" class="ax">${monY(x.m)}</text>`;
  });
  svg += '</svg>';
  const rows = b.months.map(x => [monY(x.month), int(x.newCustomers), int(x.lapsed), `<span class="${tone(x.net)}">${signedInt(x.net)}</span>`, int(x.activeAtEnd)]);
  rows.push(['<b>FYTD</b>', int(newFy), int(lapFy), `<span class="${tone(netFy)}">${signedInt(netFy)}</span>`, int(b.activeNow)]);
  const sched = b.scheduled.slice(0, 8).map(x => [monY(x.month), int(x.lapsing), int(x.activeLeft)]);
  const next = b.scheduled[0];
  const means = `${cur ? `${fullMonth(cm)} so far: ${int(cur.newCustomers)} new customers against ${int(cur.lapsed)} lapsed (${signedInt(cur.net)}). ` : ''}FYTD net sign-ups are ${signedInt(netFy)}. Another ${int(b.lapseRestOfMonth)} lapse before the end of ${fullMonth(cm)}${next ? `, then ${int(next.lapsing)} in ${fullMonth(next.month)}` : ''} and ${int(b.biggestPair.lapsing)} in ${b.biggestPair.months.map(monY).join('–')}. Packs don't auto-renew, so customers about to lapse should get a renewal offer (ideally the next year level up).`;
  return page(d, 6, 'Online customer base: net sign-ups and lapsed customers', `
    <div class="tiles t5">${t}</div>
    <h3>New paying customers vs lapsed customers, by month</h3>${legend([{ color: C.blue, text: 'New paying customers' }, { color: C.red, text: 'Lapsed' }, { color: C.pink, text: 'Scheduled to lapse (12 months after last purchase)' }])}<span class="lnote">Future months show lapses already locked in; new sales and renewals are not forecast.</span>
    ${svg}
    <div class="grid2"><div><h3>Net sign-ups, this financial year</h3>${table(['Month', 'New customers', 'Lapsed', 'Net', 'Active at month end'], rows, { boldLast: true, cls: 'dense' })}${callout('What this means.', means)}</div>
    <div><h3>Scheduled lapses ahead</h3>${table(['Month', 'Customers lapsing', 'Active customers left if no new sales or renewals'], sched, { cls: 'dense' })}
    <p class="small">To hold the base flat, each month's new customers need to match its lapses. A customer lapses 12 months after their last paid purchase; buying again before then renews them. ${int(b.lapseRestOfMonth)} more customers lapse before the end of ${fullMonth(cm)}.</p></div></div>
    ${howto(`Counts are customers (parent accounts), not packs: a parent who buys two year levels counts once. A customer is active for 12 months after each paid online purchase; a purchase while still active extends it. New = became active in the month (first purchase, or returning after lapsing). Lapsed = 12 months passed since their last purchase. The data starts in ${monY(d.dataStart.slice(0, 7))}, so lapses are only complete from ${monY(b.months[0]?.month ?? cm)}.`)}`);
}

const o_h = (_k: string) => 205;
function curveChart(d: D, key: 'onlineCustomers' | 'online' | 'payingSchools' | 'schools' | 'trials', color: string, fmt: (n: number) => string, label: string) {
  const ty = d.fyCurves.ty, ly = d.fyCurves.ly, n = ly.length;
  const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const xl = ly.map((p, i) => (p.day.slice(8) === '15' ? { i, text: months[(Number(p.day.slice(5, 7)) + 5) % 12]! } : null)).filter(Boolean) as { i: number; text: string }[];
  const tyVals = ly.map((_, i) => (i < ty.length ? ty[i]![key] : null));
  const last = ty[ty.length - 1]?.[key] ?? 0, lySame = ly[ty.length - 1]?.[key] ?? 0, lyEnd = ly[n - 1]?.[key] ?? 0;
  return lines({ n, xLabels: xl, w: 520, h: o_h(key), fmt, vline: { i: ty.length - 1 }, note: `This FY to ${dm(d.asOf)}: ${fmt(last)} | LY same day: ${fmt(lySame)} ${signedPct(change(last, lySame))}`,
    series: [{ name: 'LY', color: C.grey, values: ly.map(p => p[key]), endLabel: `${fmt(lyEnd)} full LY` }, { name: label, color, values: tyVals, width: 2.4, endLabel: '' }] });
}

function page7(d: D) {
  const f = d.fytd, l = d.fytdLy, lf = d.lyFullFy;
  const what = `<b>Seasonality:</b> ETZ is highly seasonal, driven by NAPLAN testing in March, and peak buying is always Dec–Feb. Paying online customers are ${signedPct(change(f.customers, l.customers))} on last year (${int(f.customers)} vs ${int(l.customers)}). Online dollars are ${signedPct(change(f.online, l.online))} (${moneyK1(f.online)} vs ${moneyK1(l.online)}). Schools ${moneyK1(f.schools)} vs ${moneyK1(l.schools)}. Last year from ${dm(addDaysLocal(d.periods.fyLy[1], 1))} to the end of February brought ${int(lf.customers - l.customers)} more paying customers.`;
  return page(d, 7, 'Progressive (cumulative) paying customers and revenue by channel: this financial year vs last', `
    <div class="grid2"><div><h3>Online: cumulative paying customers</h3>${legend([{ color: C.blue, text: 'Online, this FY' }, { color: C.grey, text: 'Online, last FY (full year)' }])}${curveChart(d, 'onlineCustomers', C.blue, v => int(v), 'TY')}</div>
    <div><h3>Online: cumulative $ value</h3>${legend([{ color: C.blue, text: 'Online, this FY' }, { color: C.grey, text: 'Online, last FY (full year)' }])}${curveChart(d, 'online', C.blue, v => moneyK1(v), 'TY')}</div>
    ${d.schoolCountsAvailable ? `<div><h3>Schools: cumulative paying schools</h3>${legend([{ color: C.orange, text: 'Schools, this FY' }, { color: C.grey, text: 'Schools, last FY (full year)' }])}${curveChart(d, 'payingSchools', C.orange, v => int(v), 'TY')}</div>` : `<div><h3>Schools: cumulative paying schools</h3><p class="small">Not available yet: school orders in the UMS feed carry no school id or name. Requested from IT.</p></div>`}
    <div><h3>Schools: cumulative $ value</h3>${legend([{ color: C.orange, text: 'Schools, this FY' }, { color: C.grey, text: 'Schools, last FY (full year)' }])}${curveChart(d, 'schools', C.orange, v => moneyK1(v), 'TY')}</div></div>
    ${callout('What this shows.', what)}
    ${howto(`Each line adds up from 1 July. Customers = parent accounts (online), each counted once in the financial year on their first purchase; $0 rows, UMS manual entries, duplicated bundle rows and refunded orders excluded. The grey line runs the full last financial year to show the season still ahead; the dotted marker is ${dm(d.asOf)}, and 'LY same day' is last year at that date.`)}`);
}

function page8(d: D) {
  const pos = d.fyPositions;
  const trialRows = pos.map(p => [`${monName(p.month)}${p.partial ? ' *' : ''}`, int(p.ly.trials), int(p.ty.trials), chg(p.ty.trials, p.ly.trials)]);
  const lyEnd = d.lyFyCurve[d.lyFyCurve.length - 1];
  trialRows.push(['<b>Full last FY</b>', `<b>${int(lyEnd?.trials)}</b>`, '', '']);
  const big = pos.map(p => [`${monName(p.month)}${p.partial ? ' *' : ''}`, int(p.ly.onlineCustomers), int(p.ty.onlineCustomers), chg(p.ty.onlineCustomers, p.ly.onlineCustomers), money(p.ly.online), money(p.ty.online), chg(p.ty.online, p.ly.online),
    d.schoolCountsAvailable ? int(p.ly.payingSchools) : '–', d.schoolCountsAvailable ? int(p.ty.payingSchools) : '–', d.schoolCountsAvailable ? chg(p.ty.payingSchools, p.ly.payingSchools) : '', money(p.ly.schools), money(p.ty.schools), chg(p.ty.schools, p.ly.schools)]);
  big.push(['<b>Full last FY</b>', `<b>${int(lyEnd?.onlineCustomers)}</b>`, '', '', `<b>${money(lyEnd?.online)}</b>`, '', '', d.schoolCountsAvailable ? `<b>${int(lyEnd?.payingSchools)}</b>` : '–', '', '', `<b>${money(lyEnd?.schools)}</b>`, '', '']);
  const f = d.fytd, l = d.fytdLy, lf = d.lyFullFy;
  const what = `<b>Seasonality:</b> ETZ is highly seasonal, driven by NAPLAN testing in March, and peak buying is always Dec–Feb. Trial customers are ${signedPct(change(f.trialCustomers, l.trialCustomers))} on last year (${int(f.trialCustomers)} vs ${int(l.trialCustomers)}). Last year about ${int(Math.round((lf.trialCustomers - l.trialCustomers) / 100) * 100)} more trial customers came in between ${dm(addDaysLocal(d.periods.fyLy[1], 1))} and June, so trial volume in the Jan–Feb pre-test window matters more than anything else in the funnel.`;
  return page(d, 8, 'Progressive (cumulative) trial customers, and month-end positions by channel', `
    <div class="grid2"><div><h3>Trial customers, cumulative</h3>${legend([{ color: C.purple, text: 'Trial customers, this FY' }, { color: C.grey, text: 'Trial customers, last FY (full year)' }])}${curveChart(d, 'trials', C.purple, v => int(v), 'TY')}</div>
    <div><h3>Paying online customers, cumulative</h3>${legend([{ color: C.blue, text: 'Paying customers, this FY' }, { color: C.grey, text: 'Paying customers, last FY (full year)' }])}${curveChart(d, 'onlineCustomers', C.blue, v => int(v), 'TY')}</div>
    <div><h3>Trials, month-end position vs same point last year</h3>${table(['Cumulative to end of', 'Trial customers LY', 'Trial customers TY', '%'], trialRows, { cls: 'dense' })}</div>
    <div>${callout('What this shows.', what)}</div></div>
    <h3>Paying customers and revenue, month-end position FYTD vs same point last year</h3>
    ${table(['Cumulative to end of', 'Online customers LY', 'Online customers TY', '%', 'Online $ LY', 'Online $ TY', '%', 'Paying schools LY', 'Paying schools TY', '%', 'School $ LY', 'School $ TY', '%'], big, { cls: 'dense' })}
    ${howto(`Trial customers = parent account, counted once in the financial year on their first trial (a parent trialling two year levels counts once). All trials are online. Each line adds up from 1 July. $0 rows, UMS manual entries, duplicated bundle rows and refunded orders excluded. * = month to date.`)}`);
}

function page9(d: D) {
  const ads = d.ads.filter(a => a.total != null);
  const complete = ads.filter(a => !a.partial);
  const fyStart = d.periods.fy[0].slice(0, 7);
  const fyC = complete.filter(a => a.month >= fyStart);
  const peak = complete.filter(a => ['12', '01', '02'].includes(a.month.slice(5, 7)) && a.month >= `${Number(fyStart.slice(0, 4)) - 1}-12`);
  const sum = (xs: typeof ads, k: 'total' | 'google' | 'meta' | 'sales' | 'paying' | 'newBuyers') => xs.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const lastC = complete[complete.length - 1];
  const r = (xs: typeof ads) => ({ pct: sum(xs, 'sales') ? sum(xs, 'total') / sum(xs, 'sales') : null, per: sum(xs, 'total') ? sum(xs, 'sales') / sum(xs, 'total') : null, cpp: sum(xs, 'paying') ? sum(xs, 'total') / sum(xs, 'paying') : null, cpn: sum(xs, 'newBuyers') ? sum(xs, 'total') / sum(xs, 'newBuyers') : null });
  const F = r(fyC), P = r(peak), L = lastC ? r([lastC]) : null;
  const lm = lastC ? monName(lastC.month) : '';
  const t = [
    tile(`Ad spend FYTD (${fyC.length ? `${monName(fyC[0]!.month)}–${lm}` : '–'})`, money(sum(fyC, 'total')), `Google ${money(sum(fyC, 'google'))} | Meta ${money(sum(fyC, 'meta'))}`),
    tile(`Ad spend % of sales, ${lm}`, pctOf(L?.pct), `FYTD ${pctOf(F.pct)} | Dec–Feb peak ${pctOf(P.pct)}`),
    tile(`Sales per $1 of ads, ${lm}`, L?.per != null ? `$${L.per.toFixed(2)}` : '–', `FYTD ${F.per != null ? `$${F.per.toFixed(2)}` : '–'} | Dec–Feb ${P.per != null ? `$${P.per.toFixed(2)}` : '–'}`),
    tile(`Ad cost per paying customer, ${lm}`, money(L?.cpp), `FYTD ${money(F.cpp)} | Dec–Feb ${money(P.cpp)}`),
    tile(`Ad cost per new buyer, ${lm}`, money(L?.cpn), `FYTD ${money(F.cpn)} | Dec–Feb ${money(P.cpn)}`),
  ].join('');
  const cats = ads.map(a => `${monY(a.month)}${a.partial ? ' *' : ''}`);
  const pctLabels = bars({ cats, mode: 'stack', w: 520, h: 185, fmt: v => moneyK1(v), labelFmt: () => '', series: [{ name: 'Google', color: C.blue, values: ads.map(a => a.google) }, { name: 'Meta', color: C.purple, values: ads.map(a => a.meta) }] });
  const withPct = pctLabels.replace(/<text([^>]*) class="vl">([^<]*)<\/text>/g, '');
  // add % labels above stacks
  const maxT = niceMax(Math.max(...ads.map(a => a.total ?? 0), 1));
  const step = (520 - 46 - 8) / ads.length;
  const pctSvg = withPct.replace('</svg>', ads.map((a, i) => `<text x="${46 + i * step + step / 2}" y="${14 + (185 - 14 - 18) * (1 - (a.total ?? 0) / maxT) - 3}" text-anchor="middle" class="vl sm">${pctOf(a.pctOfSales)}</text>`).join('') + '</svg>');
  const cpn = complete;
  const cpnChart = bars({ cats: cpn.map(a => monY(a.month)), mode: 'group', w: 520, h: 185, fmt: v => money(v), labelFmt: v => money(v), series: [{ name: 'cpn', color: C.red, values: cpn.map(a => a.costPerNew) }] });
  const rows = ads.map(a => [`${monY(a.month)}${a.partial ? ' *' : ''}`, money(a.sales), money(a.google), money(a.meta), `<b>${money(a.total)}</b>`, pctOf(a.pctOfSales), a.salesPerDollar?.toFixed(1) ?? '–', money(a.salesLessAds), int(a.paying), money(a.costPerPaying), int(a.newBuyers), `<b>${money(a.costPerNew)}</b>`, int(a.trialCustomers), money(a.costPerTrial)]);
  const cur = ads[ads.length - 1];
  const what = cur && lastC ? `<b>Seasonality:</b> ETZ is highly seasonal, driven by NAPLAN testing in March, and peak buying is always Dec–Feb. ${fullMonth(cur.month)} spend to date is ${money(cur.total)} (Google ${money(cur.google)}, Meta ${money(cur.meta)}): ${pctOf(cur.pctOfSales)} of online sales and $${cur.salesPerDollar?.toFixed(2) ?? '–'} back per $1, against ${pctOf(L?.pct)} and $${L?.per?.toFixed(2) ?? '–'} in ${fullMonth(lastC.month)}. Blended ad cost per new buyer is ${money(cur.costPerNew)} in ${fullMonth(cur.month)} vs ${money(lastC.costPerNew)} in ${fullMonth(lastC.month)}${P.cpn != null ? `, against ${money(P.cpn)} in last Dec–Feb` : ''}.` : '';
  return page(d, 9, 'Advertising: Google and Meta spend against online sales', `
    <div class="tiles t5">${t}</div>
    <div class="grid2"><div><h3>Ad spend by channel, per month</h3>${legend([{ color: C.blue, text: 'Google' }, { color: C.purple, text: 'Meta' }])}<span class="lnote">Label = ad spend as % of sales</span>${pctSvg}</div>
    <div><h3>Ad cost per new online buyer (blended), per month</h3><span class="lnote">Total ad spend ÷ people making their first ever paid online purchase that month. Complete months only.</span>${cpnChart}</div></div>
    ${table(['Month', 'Online sales', 'Google', 'Meta', 'Ad spend', 'Ad % of sales', 'Sales per $1', 'Sales less ads', 'Paying customers', 'Ad $ per paying customer', 'New buyers', 'Ad $ per new buyer', 'Trial customers', 'Ad $ per trial customer'], rows, { cls: 'dense' })}
    ${callout('What this shows.', what)}
    ${howto(`Google and Meta spend come from the planner's ad account connections (the same source as the advertising sheet). Online sales, paying customers, new buyers and trial customers are from the ETZ transaction list (Stripe above $0, duplicated bundle rows excluded). All cost-per figures are blended: total ad spend divided by all online customers, not just ad-attributed ones, so they show the trend, not each channel's true return. "Sales less ads" is sales minus ad spend only; it is not gross profit (no product, platform, Stripe or GST costs). * = month to date.`)}`);
}

function page10(d: D) {
  const ads = d.ads.filter(a => a.total != null);
  let cs = 0, ca = 0;
  const cum = ads.map(a => { cs += a.sales; ca += a.total ?? 0; return { m: a.month, s: cs, a: ca, partial: a.partial }; });
  const fyStart = d.periods.fy[0].slice(0, 7);
  const fy = ads.filter(a => a.month >= fyStart);
  const fyS = fy.reduce((s, a) => s + a.sales, 0), fyA = fy.reduce((s, a) => s + (a.total ?? 0), 0);
  const complete = ads.filter(a => !a.partial), lastC = complete[complete.length - 1];
  const best = ads.reduce((m, a) => ((a.salesLessAds ?? -Infinity) > (m?.salesLessAds ?? -Infinity) ? a : m), null as (typeof ads)[number] | null);
  const peak = complete.filter(a => ['12', '01', '02'].includes(a.month.slice(5, 7)) && a.month >= `${Number(fyStart.slice(0, 4)) - 1}-12`);
  const pS = peak.reduce((s, a) => s + a.sales, 0), pA = peak.reduce((s, a) => s + (a.total ?? 0), 0);
  const end = cum[cum.length - 1];
  const t = [
    tile(`Sales less ad spend, since ${monY(ads[0]?.month ?? fyStart)}`, money(end ? end.s - end.a : null), `${money(end?.s)} sales − ${money(end?.a)} ads`),
    tile('Sales less ad spend, FYTD', money(fyS - fyA), `${money(fyS)} sales − ${money(fyA)} ads`),
    tile(`Sales less ad spend, ${lastC ? monName(lastC.month) : ''}`, money(lastC?.salesLessAds), `${pctOf(lastC?.pctOfSales)} of sales spent on ads`),
    tile('Best month', money(best?.salesLessAds), best ? fullMonth(best.month) + ' ' + best.month.slice(0, 4) : ''),
    tile('Kept per $1 of sales, FYTD', fyS ? `$${((fyS - fyA) / fyS).toFixed(2)}` : '–', `Dec–Feb ${pS ? `$${((pS - pA) / pS).toFixed(2)}` : '–'}`),
  ].join('');
  const fyIdx = cum.findIndex(c => c.m === fyStart);
  const cumChart = lines({ n: cum.length, xLabels: cum.map((c, i) => ({ i, text: `${monY(c.m)}${c.partial ? ' *' : ''}` })), w: 1040, h: 235, fmt: v => moneyK(v), vline: fyIdx >= 0 ? { i: fyIdx, label: 'FY starts' } : undefined,
    area: { upper: cum.map(c => c.s), lower: cum.map(c => c.a), color: '#cfeee2', labels: cum.map((c, i) => ({ i, text: moneyK(c.s - c.a) })) },
    series: [{ name: 'Sales', color: C.blue, values: cum.map(c => c.s), dots: true, endLabel: `${moneyK(end?.s)} sales` }, { name: 'Ads', color: C.red, values: cum.map(c => c.a), dots: true, endLabel: `${moneyK(end?.a)} ads` }] });
  const monthly = bars({ cats: ads.map(a => `${monY(a.month)}${a.partial ? ' *' : ''}`), mode: 'group', w: 1040, h: 175, fmt: v => moneyK(v), labelFmt: v => moneyK1(v), series: [{ name: 'SLA', color: C.green, values: ads.map(a => a.salesLessAds) }] });
  const what = end ? `Since ${fullMonth(ads[0]!.month)} ${ads[0]!.month.slice(0, 4)}, ${moneyK(end.s)} of online sales against ${moneyK(end.a)} of ads leaves ${moneyK(end.s - end.a)}: ads have taken ${pctOf(end.a / end.s)} of online sales overall. FYTD each $1 of sales has kept $${fyS ? ((fyS - fyA) / fyS).toFixed(2) : '–'} after ads${pS ? `, against $${((pS - pA) / pS).toFixed(2)} in Dec–Feb` : ''}.` : '';
  return page(d, 10, 'Online sales less ad spend: monthly and progressive', `
    <div class="tiles t5">${t}</div>
    <h3>Progressive (cumulative) online sales vs ad spend</h3>${legend([{ color: C.blue, text: 'Cumulative online sales' }, { color: C.red, text: 'Cumulative ad spend' }, { color: '#cfeee2', text: 'Sales less ad spend, cumulative (label)' }])}<span class="lnote">Adds up from ${monY(ads[0]?.month ?? fyStart)}, the first month of ad data</span>
    ${cumChart}
    <h3>Sales less ad spend per month</h3>${monthly}
    ${callout('What this shows.', what)}
    ${howto(`Online sales = ETZ online revenue (Stripe above $0, duplicated bundle rows excluded). Ad spend = total Google + Meta spend. Sales less ad spend = online sales minus ad spend only. It does not deduct GST, Stripe fees, platform or content costs, and school revenue is not included. * = month to date.`)}`);
}

// ---------------------------------------------------------------- document

const CSS = `
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: ${C.ink}; font-size: 8.6px; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
.page { width: 297mm; height: 210mm; padding: 9mm 11mm 7mm; display: flex; flex-direction: column; page-break-after: always; overflow: hidden; position: relative; }
.page:last-child { page-break-after: auto; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid ${C.ink}; padding-bottom: 5px; margin-bottom: 7px; }
.title { font-size: 15px; font-weight: 800; letter-spacing: 0.02em; }
.title .bar { color: ${C.greyDark}; font-weight: 400; } .title .brand { color: ${C.blue}; }
.subtitle { font-size: 10px; color: ${C.ink}; margin-top: 2px; }
.meta { text-align: right; font-size: 8px; color: ${C.muted}; line-height: 1.4; }
.body { flex: 1; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
.foot { display: flex; justify-content: space-between; font-size: 7px; color: ${C.muted}; border-top: 1px solid ${C.grid}; padding-top: 4px; margin-top: 4px; }
h3 { font-size: 10px; margin: 4px 0 1px; font-weight: 700; } h4 { font-size: 9px; margin: 2px 0; font-weight: 700; }
.glance { background: #f1f4fa; border-left: 3px solid ${C.blue}; padding: 5px 9px; font-size: 8.4px; }
.glance .gt { font-size: 9.5px; } .glance ul { margin: 2px 0 0; padding-left: 14px; } .glance li { margin: 1px 0; }
.tiles { display: grid; gap: 6px; } .t4 { grid-template-columns: repeat(4, 1fr); } .t5 { grid-template-columns: repeat(5, 1fr); } .t6 { grid-template-columns: repeat(6, 1fr); }
.tile { border: 1px solid #d6dbe4; border-radius: 4px; padding: 5px 8px; background: #fff; }
.tile.alt { background: #f3f8f6; border-color: #d3e5dd; }
.tl { font-size: 7px; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.muted}; } .tv { font-size: 19px; font-weight: 800; margin: 1px 0; } .ts { font-size: 7.4px; color: ${C.muted}; }
.up { color: #148a4f; font-weight: 600; } .down { color: ${C.red}; font-weight: 600; }
.legend { display: inline-flex; gap: 10px; font-size: 7.6px; margin-right: 8px; } .legend span { display: inline-flex; align-items: center; gap: 3px; } .legend i { width: 9px; height: 9px; display: inline-block; }
.lnote { font-size: 7.4px; color: ${C.muted}; }
.chart { display: block; } .chart text { font-family: inherit; } .ax { font-size: 7.5px; fill: ${C.muted}; } .vl { font-size: 7.4px; fill: ${C.ink}; font-weight: 600; } .vl.sm { font-size: 6.6px; } .bandlbl { font-size: 7.6px; fill: #b4701c; font-weight: 600; } .brk { font-size: 7.6px; fill: ${C.ink}; font-weight: 600; } .note { font-size: 7px; fill: ${C.blue}; font-weight: 600; }
.tbl { width: 100%; border-collapse: collapse; font-size: 8px; font-variant-numeric: tabular-nums; } .tbl th { font-weight: 700; border-bottom: 1px solid ${C.ink}; padding: 2px 4px; } .tbl td { padding: 1.6px 4px; border-bottom: 1px solid #eef0f4; }
.tbl.dense td, .tbl.dense th { padding: 1.2px 4px; font-size: 7.6px; } .tbl .l { text-align: left; } .tbl .r { text-align: right; } .tbl tr.tot td { font-weight: 700; border-top: 1px solid ${C.ink}; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } .grid2.tight { gap: 6px; } .grid3 { display: grid; grid-template-columns: 1.1fr 1.2fr 1fr; gap: 12px; align-items: start; }
.callout { background: #fdf3e6; border-left: 3px solid ${C.orange}; padding: 5px 8px; font-size: 8px; }
.howto { font-size: 7.4px; color: ${C.ink}; margin-top: auto; } .small { font-size: 7.8px; color: ${C.muted}; }
.ttb { border: 1px solid #d3e5dd; background: #f3f8f6; border-radius: 4px; padding: 5px 8px; display: grid; grid-template-columns: auto auto 1fr; gap: 4px 14px; align-items: end; margin-top: 4px; }
.ttb .big { font-size: 15px; font-weight: 800; display: block; } .ttbn { font-size: 7.4px; color: ${C.muted}; }
.ttbar { grid-column: 1 / -1; display: flex; height: 14px; font-size: 7px; } .ttbar span { display: flex; align-items: center; padding-left: 3px; white-space: nowrap; overflow: hidden; color: #0b3d2c; }
`;

export function renderEtzExecHtml(d: D): string {
  const pages = [page1, page2, page3, page4, page5, page6, page7, page8, page9, page10].map(fn => fn(d)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>ETZ Executive Summary ${dmy(d.asOf)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${pages}</body></html>`;
}
