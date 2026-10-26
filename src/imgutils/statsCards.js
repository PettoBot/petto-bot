// The pictures of `!stats`: the trend of the period against the one before, the week by hour, the top channels and members, how the server grows,
// the side-by-side of two periods and what one member did. Same colors and fonts as the summary (see summaryCard.js). Each function returns a PNG buffer.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts } = require('./cardFonts');
const { kit } = require('./summaryCard');
const { loadImageFromLink } = require('../utils/safeImage');
const { t, tn, currentLanguage } = require('../i18n');

const { W, H, BG, PANEL, BORDER, TEXT, MUTED, GRID, ACCENT, COLORS, WEEKDAYS, FONT, compact, duration, panel, text, niceMax, formatDay } = kit;
const GREEN = '#8fdca8';
const RED = '#f08fa0';
const BEFORE = '#6f655f'; // the period before, drawn quieter than this one
const GOLD = '#f5c26b';

function start(guildName, title, subtitle, color = ACCENT) {
  registerCardFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(ctx, guildName.length > 38 ? `${guildName.slice(0, 37)}…` : guildName, 40, 56, { font: FONT(700, 30) });
  text(ctx, subtitle, 40, 84, { font: FONT(400, 15), color: MUTED });
  ctx.font = FONT(700, 15);
  const chipW = ctx.measureText(title).width + 34;
  ctx.beginPath();
  ctx.roundRect(W - 40 - chipW, 36, chipW, 36, 18);
  ctx.fillStyle = `${color}33`;
  ctx.fill();
  text(ctx, title, W - 40 - chipW / 2, 55, { font: FONT(700, 15), color, align: 'center', baseline: 'middle' });
  return { canvas, ctx };
}

const versus = (days, lang) => tn(lang, 'info.statsCard.versus', days, { count: days });
const percentText = (value) => `${value > 0 ? '+' : ''}${Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(1).replace('.0', '')}%`;

/** The labels under a chart: about `target` of them, evenly, and the last one only when it does not touch the one before it (a label is about 60 px wide). */
function axisLabels(ctx, labels, position, y, target) {
  const every = Math.max(1, Math.ceil(labels.length / target));
  const last = labels.length - 1;
  let previous = -1;
  labels.forEach((label, i) => {
    const regular = i % every === 0;
    if (!regular && !(i === last && previous >= 0 && position(i) - position(previous) >= 64)) return;
    previous = i;
    text(ctx, label, position(i), y, { font: FONT(400, 10.5), color: MUTED, align: i === 0 ? 'left' : i === last ? 'right' : 'center' });
  });
}

/** A small pill with the change: green up, red down, grey "new" when there was nothing before. `inverse` makes a drop the good news (members who left). */
function deltaChip(ctx, value, x, y, lang, { inverse = false, align = 'left' } = {}) {
  const label = value === null ? t(lang, 'info.statsCard.new') : value === 0 ? '0%' : `${value > 0 ? '▲' : '▼'} ${percentText(Math.abs(value)).replace('+', '')}`;
  const good = value === null || value === 0 ? null : (value > 0) !== inverse;
  const color = good === null ? MUTED : good ? GREEN : RED;
  ctx.font = FONT(700, 12);
  const w = ctx.measureText(label).width + 18;
  const left = align === 'right' ? x - w : x;
  ctx.beginPath();
  ctx.roundRect(left, y, w, 22, 11);
  ctx.fillStyle = `${color}2e`;
  ctx.fill();
  text(ctx, label, left + w / 2, y + 11.5, { font: FONT(700, 12), color, align: 'center', baseline: 'middle' });
  return w;
}

function tile(ctx, { x, y, w, label, value, color, change, inverse, lang, highlight = false }) {
  panel(ctx, x, y, w, 100, highlight ? color : BORDER);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + 18, y + 16, 22, 4, 2);
  ctx.fill();
  text(ctx, label, x + 18, y + 44, { font: FONT(700, 11), color: MUTED });
  text(ctx, value, x + 18, y + 76, { font: FONT(700, 26) });
  if (change !== undefined) deltaChip(ctx, change, x + w - 14, y + 16, lang, { inverse, align: 'right' });
}

/** Lines over a grid: `series` are { values, color, dashed, fill }, drawn in order (draw the quiet one first). */
function lineChart(ctx, { x, y, w, h, series, labels, format = compact }) {
  const left = x + 46;
  const plotW = w - 46 - 8;
  const plotH = h - 30;
  const max = niceMax(Math.max(0, ...series.flatMap((line) => line.values)));
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(left + plotW, gy);
    ctx.stroke();
    text(ctx, format((max * i) / 4), left - 8, gy, { font: FONT(400, 10.5), color: MUTED, align: 'right', baseline: 'middle' });
  }
  ctx.setLineDash([]);
  const count = Math.max(series[0]?.values.length ?? 0, 2);
  const px = (i) => left + (plotW * i) / (count - 1);
  const py = (value) => y + plotH - (value / max) * plotH;
  for (const line of series) {
    if (line.fill) {
      const gradient = ctx.createLinearGradient(0, y, 0, y + plotH);
      gradient.addColorStop(0, `${line.color}40`);
      gradient.addColorStop(1, `${line.color}00`);
      ctx.beginPath();
      ctx.moveTo(px(0), y + plotH);
      line.values.forEach((value, i) => ctx.lineTo(px(i), py(value)));
      ctx.lineTo(px(line.values.length - 1), y + plotH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.beginPath();
    line.values.forEach((value, i) => (i === 0 ? ctx.moveTo(px(i), py(value)) : ctx.lineTo(px(i), py(value))));
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.dashed ? 2 : 3;
    ctx.lineJoin = 'round';
    ctx.setLineDash(line.dashed ? [6, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!line.dashed && line.values.length <= 31) {
      ctx.fillStyle = line.color;
      line.values.forEach((value, i) => { ctx.beginPath(); ctx.arc(px(i), py(value), 3, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  axisLabels(ctx, labels, px, y + plotH + 20, plotW > 500 ? 12 : 5);
}

function legend(ctx, x, y, lang) {
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 22, y); ctx.stroke();
  text(ctx, t(lang, 'info.statsCard.legend.current'), x + 30, y, { font: FONT(400, 11.5), color: MUTED, baseline: 'middle' });
  const second = x + 30 + 110;
  ctx.strokeStyle = BEFORE; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(second, y); ctx.lineTo(second + 22, y); ctx.stroke(); ctx.setLineDash([]);
  text(ctx, t(lang, 'info.statsCard.legend.before'), second + 30, y, { font: FONT(400, 11.5), color: MUTED, baseline: 'middle' });
}

/** A row of a ranking: place, name, a bar and the number with its share. */
function rankRows(ctx, { x, y, w, rows, color, format, rowH = 46 }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    text(ctx, String(i + 1), x, ry + 14, { font: FONT(700, 13), color: i < 3 ? color : MUTED, baseline: 'middle' });
    let label = row.label;
    ctx.font = FONT(400, 14);
    while (ctx.measureText(label).width > w - 190 && label.length > 3) label = `${label.slice(0, -2)}…`;
    text(ctx, label, x + 26, ry + 14, { font: FONT(400, 14), baseline: 'middle' });
    text(ctx, `${format(row.value)}${row.share ? `  ·  ${Math.round(row.share * 100)}%` : ''}`, x + w, ry + 14, { font: FONT(700, 13), color: MUTED, align: 'right', baseline: 'middle' });
    ctx.fillStyle = '#2a2421';
    ctx.beginPath(); ctx.roundRect(x + 26, ry + 26, w - 26, 8, 4); ctx.fill();
    ctx.fillStyle = i < 3 ? color : `${color}99`;
    ctx.beginPath(); ctx.roundRect(x + 26, ry + 26, Math.max(6, ((w - 26) * row.value) / max), 8, 4); ctx.fill();
  });
}

/** The overview: six numbers with their change, and three lines (messages, voice, active members) set against the period before. */
function buildTrendCard({ guildName, days, stats, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, 'info.statsCard.title.overview'), versus(days, lang));
  const totals = stats.current.totals;
  const change = stats.change;
  const tiles = [
    { key: 'messages', value: compact(totals.messages), color: COLORS.messages, change: change.messages },
    { key: 'active', value: compact(totals.activeMembers), color: ACCENT, change: change.activeMembers },
    { key: 'voice', value: duration(totals.voiceSeconds), color: COLORS.voice, change: change.voiceSeconds },
    { key: 'joins', value: compact(totals.joins), color: COLORS.joins, change: change.joins },
    { key: 'leaves', value: compact(totals.leaves), color: COLORS.leaves, change: change.leaves, inverse: true },
    { key: 'perDay', value: compact(Math.round(totals.perDay)), color: GOLD, change: percentOf(stats.previous.totals.perDay, totals.perDay) },
  ];
  const gap = 14;
  const tileW = (W - 80 - gap * 5) / 6;
  tiles.forEach((entry, i) => tile(ctx, { x: 40 + i * (tileW + gap), y: 108, w: tileW, label: t(lang, entry.key === 'perDay' ? 'info.statsCard.tile.perDay' : `info.summaryCard.tile.${entry.key}`), value: entry.value, color: entry.color, change: entry.change, inverse: entry.inverse, lang }));

  const labels = stats.current.days.map((day) => formatDay(day, lang));
  const panels = [
    { title: 'messages', now: stats.current.series.messages, before: stats.previous.series.messages, color: COLORS.messages, format: compact },
    { title: 'voice', now: stats.current.series.voice.map((s) => s / 3600), before: stats.previous.series.voice.map((s) => s / 3600), color: COLORS.voice, format: (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) },
    { title: 'members', now: stats.current.series.activeMembers, before: stats.previous.series.activeMembers, color: ACCENT, format: compact },
  ];
  const panelW = (W - 80 - 24 * 2) / 3;
  panels.forEach((entry, i) => {
    const px = 40 + i * (panelW + 24);
    panel(ctx, px, 230, panelW, 430);
    text(ctx, t(lang, `info.statsCard.chart.${entry.title}`), px + 22, 268, { font: FONT(700, 16) });
    if (i === 0) legend(ctx, px + 22, 292, lang); else text(ctx, ' ', px, 292);
    lineChart(ctx, { x: px + 10, y: 312, w: panelW - 20, h: 330, labels, format: entry.format, series: [{ values: entry.before, color: BEFORE, dashed: true }, { values: entry.now, color: entry.color, fill: true }] });
  });
  return canvas.toBuffer('image/png');
}

const percentOf = (before, now) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? null : 0);

/** The week by hour: a cell for each hour of each weekday, brighter the busier. */
function buildHeatmapCard({ guildName, days, stats, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, 'info.statsCard.title.heatmap'), tn(lang, 'info.statsCard.period', days, { count: days }), COLORS.messages);
  const grid = stats.heatmap.messages;
  const max = Math.max(1, ...grid.flat());
  panel(ctx, 40, 108, 840, 552);
  text(ctx, t(lang, 'info.statsCard.heatmap.title'), 64, 148, { font: FONT(700, 18) });
  const peak = stats.peak;
  text(ctx, peak ? t(lang, 'info.statsCard.heatmap.busiest', { day: t(lang, `info.summaryCard.day.${WEEKDAYS[peak.weekday]}`), hour: `${String(peak.hour).padStart(2, '0')}:00`, count: compact(peak.value) }) : t(lang, 'info.statsCard.noData'), 64, 172, { font: FONT(400, 13), color: peak ? ACCENT : MUTED });
  const left = 120;
  const top = 232;
  const cell = (840 - 80 - (left - 40)) / 24;
  const cellH = 50;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    text(ctx, t(lang, `info.summaryCard.day.${WEEKDAYS[weekday]}`), left - 14, top + weekday * (cellH + 6) + cellH / 2, { font: FONT(400, 12), color: MUTED, align: 'right', baseline: 'middle' });
    for (let hour = 0; hour < 24; hour += 1) {
      const value = grid[weekday][hour];
      const level = value ? 0.12 + 0.88 * Math.sqrt(value / max) : 0;
      ctx.beginPath();
      ctx.roundRect(left + hour * cell + 1.5, top + weekday * (cellH + 6), cell - 3, cellH, 6);
      ctx.fillStyle = value ? `${COLORS.messages}${Math.round(level * 255).toString(16).padStart(2, '0')}` : '#221d1b';
      ctx.fill();
      if (peak && peak.weekday === weekday && peak.hour === hour) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }
  for (let hour = 0; hour < 24; hour += 3) text(ctx, String(hour).padStart(2, '0'), left + hour * cell + cell / 2, top - 12, { font: FONT(400, 11), color: MUTED, align: 'center' });
  // The scale: from quiet to busy.
  text(ctx, t(lang, 'info.statsCard.heatmap.less'), 64, 636, { font: FONT(400, 11), color: MUTED, baseline: 'middle' });
  for (let i = 0; i < 6; i += 1) { ctx.fillStyle = `${COLORS.messages}${Math.round((0.12 + 0.88 * (i / 5)) * 255).toString(16).padStart(2, '0')}`; ctx.beginPath(); ctx.roundRect(140 + i * 22, 628, 18, 16, 4); ctx.fill(); }
  text(ctx, t(lang, 'info.statsCard.heatmap.more'), 280, 636, { font: FONT(400, 11), color: MUTED, baseline: 'middle' });

  // The day split in four, and the share of each weekday.
  panel(ctx, 904, 108, 336, 252);
  text(ctx, t(lang, 'info.statsCard.heatmap.dayparts'), 926, 148, { font: FONT(700, 16) });
  ['night', 'morning', 'afternoon', 'evening'].forEach((part, i) => {
    const share = stats.dayparts[i];
    const y = 176 + i * 42;
    text(ctx, t(lang, `info.statsCard.heatmap.${part}`), 926, y + 8, { font: FONT(400, 13), baseline: 'middle' });
    text(ctx, `${Math.round(share * 100)}%`, 1218, y + 8, { font: FONT(700, 13), color: MUTED, align: 'right', baseline: 'middle' });
    ctx.fillStyle = '#2a2421'; ctx.beginPath(); ctx.roundRect(926, y + 22, 292, 7, 4); ctx.fill();
    ctx.fillStyle = COLORS.messages; ctx.beginPath(); ctx.roundRect(926, y + 22, Math.max(5, 292 * share), 7, 4); ctx.fill();
  });
  panel(ctx, 904, 384, 336, 276);
  text(ctx, t(lang, 'info.statsCard.heatmap.weekdays'), 926, 424, { font: FONT(700, 16) });
  const weekdayTotal = Math.max(1, stats.byWeekday.reduce((a, b) => a + b, 0));
  const weekdayMax = Math.max(1, ...stats.byWeekday);
  stats.byWeekday.forEach((value, i) => {
    const y = 444 + i * 29;
    text(ctx, t(lang, `info.summaryCard.day.${WEEKDAYS[i]}`), 926, y + 8, { font: FONT(400, 12), color: MUTED, baseline: 'middle' });
    ctx.fillStyle = '#2a2421'; ctx.beginPath(); ctx.roundRect(972, y + 2, 190, 12, 6); ctx.fill();
    ctx.fillStyle = value === weekdayMax && value > 0 ? ACCENT : `${COLORS.messages}99`; ctx.beginPath(); ctx.roundRect(972, y + 2, Math.max(value ? 6 : 0, (190 * value) / weekdayMax), 12, 6); ctx.fill();
    text(ctx, `${Math.round((value / weekdayTotal) * 100)}%`, 1218, y + 8, { font: FONT(700, 12), color: MUTED, align: 'right', baseline: 'middle' });
  });
  return canvas.toBuffer('image/png');
}

/** The top channels (or members): by messages on the left, by voice time on the right. `rows` are { label, value, share }. */
function buildTopCard({ guildName, days, kind, messages, voice, note = null, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, `info.statsCard.title.${kind}`), tn(lang, 'info.statsCard.period', days, { count: days }), kind === 'channels' ? COLORS.messages : COLORS.voice);
  const columns = [
    { title: t(lang, `info.statsCard.top.${kind}Messages`), rows: messages, color: COLORS.messages, format: (v) => compact(v), x: 40 },
    { title: t(lang, `info.statsCard.top.${kind}Voice`), rows: voice, color: COLORS.voice, format: (v) => duration(v), x: 664 },
  ];
  for (const column of columns) {
    panel(ctx, column.x, 108, 576, note ? 500 : 552);
    text(ctx, column.title, column.x + 24, 148, { font: FONT(700, 18) });
    if (!column.rows.length) text(ctx, t(lang, 'info.statsCard.noData'), column.x + 24, 190, { font: FONT(400, 14), color: MUTED });
    else rankRows(ctx, { x: column.x + 24, y: 172, w: 528, rows: column.rows.slice(0, 10), color: column.color, format: column.format, rowH: 46 });
  }
  if (note) {
    panel(ctx, 40, 624, 1200, 36);
    text(ctx, note, 64, 642, { font: FONT(400, 14), color: ACCENT, baseline: 'middle' });
  }
  return canvas.toBuffer('image/png');
}

/** How the server grows: the members (or the net change) over the days, joins against leaves, and how long the ones who left had stayed. */
function buildGrowthCard({ guildName, days, stats, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, 'info.statsCard.title.growth'), versus(days, lang), COLORS.joins);
  const totals = stats.current.totals;
  const tiles = [
    { label: t(lang, 'info.summaryCard.tile.joins'), value: compact(totals.joins), color: COLORS.joins, change: stats.change.joins },
    { label: t(lang, 'info.summaryCard.tile.leaves'), value: compact(totals.leaves), color: COLORS.leaves, change: stats.change.leaves, inverse: true },
    { label: t(lang, 'info.statsCard.tile.net'), value: `${totals.net > 0 ? '+' : ''}${compact(totals.net)}`, color: totals.net >= 0 ? GREEN : RED, change: undefined },
    { label: t(lang, 'info.statsCard.tile.leftEarly'), value: stats.growth.earlyLeaveShare === null ? '—' : `${Math.round(stats.growth.earlyLeaveShare * 100)}%`, color: GOLD, change: undefined },
  ];
  const tileW = (W - 80 - 14 * 3) / 4;
  tiles.forEach((entry, i) => tile(ctx, { x: 40 + i * (tileW + 14), y: 108, w: tileW, label: entry.label, value: entry.value, color: entry.color, change: entry.change, inverse: entry.inverse, lang }));

  const labels = stats.current.days.map((day) => formatDay(day, lang));
  panel(ctx, 40, 230, 760, 430);
  const line = stats.growth.memberLine;
  text(ctx, t(lang, line ? 'info.statsCard.growth.members' : 'info.statsCard.growth.net'), 64, 268, { font: FONT(700, 18) });
  const net = stats.current.series.net;
  let running = 0;
  const cumulative = net.map((value) => (running += value));
  lineChart(ctx, { x: 54, y: 290, w: 732, h: 350, labels, series: [{ values: line ?? cumulative.map((value) => Math.max(0, value - Math.min(0, ...cumulative))), color: COLORS.joins, fill: true }] });

  panel(ctx, 824, 230, 416, 430);
  text(ctx, t(lang, 'info.statsCard.growth.stay'), 848, 268, { font: FONT(700, 16) });
  const buckets = ['day', 'week', 'month', 'quarter', 'longer'];
  const total = stats.growth.lifespanTotal;
  if (!total) {
    text(ctx, t(lang, 'info.statsCard.growth.noStay'), 848, 310, { font: FONT(400, 13), color: MUTED });
  } else {
    const max = Math.max(1, ...stats.growth.lifespan);
    buckets.forEach((bucket, i) => {
      const y = 296 + i * 64;
      const value = stats.growth.lifespan[i];
      text(ctx, t(lang, `info.statsCard.growth.stay.${bucket}`), 848, y + 8, { font: FONT(400, 13), baseline: 'middle' });
      text(ctx, `${value}  ·  ${Math.round((value / total) * 100)}%`, 1216, y + 8, { font: FONT(700, 13), color: MUTED, align: 'right', baseline: 'middle' });
      ctx.fillStyle = '#2a2421'; ctx.beginPath(); ctx.roundRect(848, y + 24, 368, 10, 5); ctx.fill();
      ctx.fillStyle = i < 2 ? RED : i < 3 ? GOLD : GREEN; ctx.beginPath(); ctx.roundRect(848, y + 24, Math.max(value ? 8 : 0, (368 * value) / max), 10, 5); ctx.fill();
    });
  }
  return canvas.toBuffer('image/png');
}

/** The two periods side by side, number by number, and how messages are made (links, files, replies, mentions). */
function buildCompareCard({ guildName, days, stats, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, 'info.statsCard.title.compare'), versus(days, lang));
  const now = stats.current.totals;
  const before = stats.previous.totals;
  const rows = [
    { key: 'messages', now: now.messages, before: before.messages, change: stats.change.messages, color: COLORS.messages, format: compact },
    { key: 'active', now: now.activeMembers, before: before.activeMembers, change: stats.change.activeMembers, color: ACCENT, format: compact },
    { key: 'voice', now: now.voiceSeconds, before: before.voiceSeconds, change: stats.change.voiceSeconds, color: COLORS.voice, format: duration },
    { key: 'reactions', now: now.reactions, before: before.reactions, change: stats.change.reactions, color: GOLD, format: compact },
    { key: 'joins', now: now.joins, before: before.joins, change: stats.change.joins, color: COLORS.joins, format: compact },
    { key: 'leaves', now: now.leaves, before: before.leaves, change: stats.change.leaves, color: COLORS.leaves, format: compact, inverse: true },
  ];
  panel(ctx, 40, 108, 780, 552);
  text(ctx, t(lang, 'info.statsCard.compare.title'), 64, 148, { font: FONT(700, 18) });
  legendBars(ctx, 64, 170, lang);
  rows.forEach((row, i) => {
    const y = 196 + i * 74;
    text(ctx, t(lang, row.key === 'reactions' ? 'info.statsCard.tile.reactions' : `info.summaryCard.tile.${row.key}`), 64, y + 6, { font: FONT(700, 12), color: MUTED, baseline: 'middle' });
    deltaChip(ctx, row.change, 796, y - 6, lang, { inverse: row.inverse, align: 'right' });
    const max = Math.max(1, row.now, row.before);
    ctx.fillStyle = BEFORE; ctx.beginPath(); ctx.roundRect(64, y + 18, Math.max(4, (560 * row.before) / max), 14, 7); ctx.fill();
    text(ctx, row.format(row.before), 64 + Math.max(4, (560 * row.before) / max) + 10, y + 25, { font: FONT(400, 12), color: MUTED, baseline: 'middle' });
    ctx.fillStyle = row.color; ctx.beginPath(); ctx.roundRect(64, y + 38, Math.max(4, (560 * row.now) / max), 14, 7); ctx.fill();
    text(ctx, row.format(row.now), 64 + Math.max(4, (560 * row.now) / max) + 10, y + 45, { font: FONT(700, 13), baseline: 'middle' });
  });

  panel(ctx, 844, 108, 396, 552);
  text(ctx, t(lang, 'info.statsCard.content.title'), 868, 148, { font: FONT(700, 18) });
  text(ctx, t(lang, 'info.statsCard.content.sub'), 868, 170, { font: FONT(400, 12), color: MUTED });
  const kinds = [['links', COLORS.invites], ['attachments', COLORS.voice], ['replies', COLORS.joins], ['mentions', GOLD]];
  kinds.forEach(([key, color], i) => {
    const y = 206 + i * 104;
    const value = stats.content.per100(key);
    text(ctx, t(lang, `info.statsCard.content.${key}`), 868, y + 8, { font: FONT(400, 14), baseline: 'middle' });
    text(ctx, `${value}`, 1216, y + 8, { font: FONT(700, 22), align: 'right', baseline: 'middle' });
    ctx.fillStyle = '#2a2421'; ctx.beginPath(); ctx.roundRect(868, y + 26, 348, 10, 5); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(868, y + 26, Math.max(value ? 8 : 0, (348 * Math.min(100, value)) / 100), 10, 5); ctx.fill();
    text(ctx, t(lang, 'info.statsCard.content.count', { count: compact(stats.content[key]) }), 868, y + 56, { font: FONT(400, 11.5), color: MUTED });
  });
  return canvas.toBuffer('image/png');
}

function legendBars(ctx, x, y, lang) {
  ctx.fillStyle = BEFORE; ctx.beginPath(); ctx.roundRect(x, y - 6, 22, 10, 5); ctx.fill();
  text(ctx, t(lang, 'info.statsCard.legend.before'), x + 30, y, { font: FONT(400, 11.5), color: MUTED, baseline: 'middle' });
  ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.roundRect(x + 140, y - 6, 22, 10, 5); ctx.fill();
  text(ctx, t(lang, 'info.statsCard.legend.current'), x + 170, y, { font: FONT(400, 11.5), color: MUTED, baseline: 'middle' });
}

/** What one member did: numbers, their place among the members, their share and the messages of each day. */
async function buildMemberCard({ guildName, name, avatarUrl = null, member, lang = currentLanguage() }) {
  const { ctx, canvas } = start(guildName, t(lang, 'info.statsCard.title.member'), tn(lang, 'info.statsCard.period', member.days, { count: member.days }));
  // The member: picture (a circle) and name. A picture that cannot be had leaves a circle with the first letter.
  const cx = 40 + 34;
  let drawn = false;
  if (avatarUrl) {
    try {
      const image = await loadImageFromLink(avatarUrl);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, 150, 34, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, cx - 34, 116, 68, 68); ctx.restore();
      drawn = true;
    } catch { /* the letter is drawn */ }
  }
  if (!drawn) {
    ctx.fillStyle = '#2f2926'; ctx.beginPath(); ctx.arc(cx, 150, 34, 0, Math.PI * 2); ctx.fill();
    text(ctx, [...name][0]?.toUpperCase() ?? '?', cx, 150, { font: FONT(700, 28), align: 'center', baseline: 'middle' });
  }
  text(ctx, name.length > 30 ? `${name.slice(0, 29)}…` : name, 124, 146, { font: FONT(700, 26) });
  text(ctx, t(lang, 'info.statsCard.member.activeShare', { days: member.activeDays, total: member.dayLabels.length }), 124, 172, { font: FONT(400, 14), color: MUTED });

  const tiles = [
    { label: t(lang, 'info.statsCard.member.messages'), value: compact(member.totals.messages), color: COLORS.messages, change: member.change.messages },
    { label: t(lang, 'info.statsCard.member.voice'), value: duration(member.totals.voiceSeconds), color: COLORS.voice, change: member.change.voiceSeconds },
    { label: t(lang, 'info.statsCard.member.streak'), value: String(member.streak), color: GOLD, change: undefined },
    { label: t(lang, 'info.statsCard.member.perActiveDay'), value: compact(Math.round(member.perActiveDay)), color: COLORS.joins, change: undefined },
  ];
  const tileW = (W - 80 - 14 * 3) / 4;
  tiles.forEach((entry, i) => tile(ctx, { x: 40 + i * (tileW + 14), y: 206, w: tileW, label: entry.label, value: entry.value, color: entry.color, change: entry.change, lang }));

  panel(ctx, 40, 326, 760, 334);
  text(ctx, t(lang, 'info.statsCard.member.daily'), 64, 364, { font: FONT(700, 16) });
  const labels = member.dayLabels.map((day) => formatDay(day, lang));
  const bestIndex = member.bestDay ? member.dayLabels.indexOf(member.bestDay.day) : -1;
  const values = member.daily;
  const plotLeft = 118;
  const plotW = 760 - 118 + 40 - 24;
  const plotH = 224;
  const max = niceMax(Math.max(0, ...values));
  const slot = plotW / values.length;
  ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
  for (let i = 0; i <= 4; i += 1) {
    const gy = 386 + plotH - (plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(plotLeft, gy); ctx.lineTo(plotLeft + plotW, gy); ctx.stroke();
    text(ctx, compact((max * i) / 4), plotLeft - 8, gy, { font: FONT(400, 10.5), color: MUTED, align: 'right', baseline: 'middle' });
  }
  ctx.setLineDash([]);
  values.forEach((value, i) => {
    const h = (value / max) * plotH;
    const w = Math.max(1, Math.min(26, slot * 0.64));
    ctx.fillStyle = i === bestIndex ? ACCENT : `${COLORS.messages}88`;
    ctx.beginPath(); ctx.roundRect(plotLeft + slot * i + (slot - w) / 2, 386 + plotH - h, w, h, [Math.min(5, w / 2), Math.min(5, w / 2), 0, 0]); ctx.fill();
  });
  axisLabels(ctx, labels, (i) => plotLeft + slot * i + slot / 2, 386 + plotH + 20, 10);

  panel(ctx, 824, 326, 416, 334);
  text(ctx, t(lang, 'info.statsCard.member.place'), 848, 364, { font: FONT(700, 16) });
  const places = [
    { label: t(lang, 'info.statsCard.member.rankMessages'), rank: member.rank.messages, share: member.share.messages, color: COLORS.messages, shareKey: 'shareMessages' },
    { label: t(lang, 'info.statsCard.member.rankVoice'), rank: member.rank.voice, share: member.share.voice, color: COLORS.voice, shareKey: 'shareVoice' },
  ];
  places.forEach((place, i) => {
    const y = 396 + i * 124;
    text(ctx, place.label, 848, y + 8, { font: FONT(400, 13), color: MUTED, baseline: 'middle' });
    text(ctx, place.rank ? t(lang, 'info.statsCard.member.rankOf', { rank: place.rank.rank, total: place.rank.of }) : '—', 848, y + 44, { font: FONT(700, 28), baseline: 'middle' });
    if (place.rank) {
      const top = Math.max(1, Math.ceil((place.rank.rank / place.rank.of) * 100));
      text(ctx, t(lang, 'info.statsCard.member.top', { percent: top }), 1216, y + 44, { font: FONT(700, 15), color: place.color, align: 'right', baseline: 'middle' });
    }
    ctx.fillStyle = '#2a2421'; ctx.beginPath(); ctx.roundRect(848, y + 72, 368, 10, 5); ctx.fill();
    ctx.fillStyle = place.color; ctx.beginPath(); ctx.roundRect(848, y + 72, Math.max(place.share ? 8 : 0, 368 * Math.min(1, place.share * 4)), 10, 5); ctx.fill();
    text(ctx, t(lang, `info.statsCard.member.${place.shareKey}`, { percent: (place.share * 100).toFixed(place.share >= 0.1 ? 0 : 1) }), 848, y + 98, { font: FONT(400, 11.5), color: MUTED });
  });
  return canvas.toBuffer('image/png');
}

module.exports = { buildTrendCard, buildHeatmapCard, buildTopCard, buildGrowthCard, buildCompareCard, buildMemberCard };
