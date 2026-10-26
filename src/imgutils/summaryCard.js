// The picture of `/summary`: the numbers of the period as tiles, the metric of the day-by-day bars and, next to them, the
// hours of the day (or the days of the week) with the busiest one lit. Drawn in Petto's colors with its own fonts.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts } = require('./cardFonts');
const { hourLabel } = require('../utils/activitySummary');
const { t, tn, currentLanguage } = require('../i18n');

const W = 1280;
const H = 700;
const BG = '#14110f';
const PANEL = '#1d1917';
const BORDER = '#2f2926';
const TEXT = '#f6efe9';
const MUTED = '#9a8f88';
const GRID = '#2a2421';
const ACCENT = '#f0a88f';
const COLORS = { messages: '#f0a88f', voice: '#9bd0f5', joins: '#8fdca8', leaves: '#f08fa0', invites: '#c6a8f5', overview: '#f0a88f', sanctions: '#f5c26b' };
// Monday first, as the catalog keys of the days (`info.summaryCard.day.<day>` short, `info.summaryCard.busiestOn.<day>`).
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const KINDS = ['bans', 'mutes', 'warns', 'kicks', 'jails'];
const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const FONT = (weight, size) => `${weight} ${size}px "Poppins ${weight}", "Poppins", sans-serif`; // i18n-ignore: a font, not text

const compact = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(value));
};
const duration = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

function panel(ctx, x, y, w, h, outline = BORDER) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function text(ctx, value, x, y, { font = FONT(400, 14), color = TEXT, align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(value, x, y);
}

/** A rounded-top bar. */
function bar(ctx, x, y, w, h, color) {
  if (h <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [Math.min(6, w / 2), Math.min(6, w / 2), 0, 0]);
  ctx.fillStyle = color;
  ctx.fill();
}

/** The top of the axis: four equal steps, each one a round number (1, 2, 5 or 10 times a power of ten). */
function niceMax(value) {
  const raw = Math.max(value, 4) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw);
  return step * 4;
}

/** Bars with a grid, the axis labels, the average line and one highlighted bar. */
function barChart(ctx, { x, y, w, h, values, labels, color, highlight = -1, format = compact, average = null, lang = currentLanguage() }) {
  const left = x + 54;
  const gutter = average != null && average > 0 ? 58 : 0; // room for the label of the average, so no bar covers it
  const plotW = w - 54 - 8 - gutter;
  const plotH = h - 34;
  const max = niceMax(Math.max(0, ...values));
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(left + plotW, gy);
    ctx.stroke();
    text(ctx, format((max * i) / 4), left - 8, gy, { font: FONT(400, 11), color: MUTED, align: 'right', baseline: 'middle' });
  }
  ctx.setLineDash([]);

  const slot = plotW / values.length;
  const barW = Math.max(1, Math.min(34, slot * 0.64));
  values.forEach((value, i) => {
    const bh = (value / max) * plotH;
    const bx = left + slot * i + (slot - barW) / 2;
    bar(ctx, bx, y + plotH - bh, barW, bh, i === highlight ? ACCENT : color + (highlight === -1 ? '' : '88'));
  });

  if (average != null && average > 0) {
    const ay = y + plotH - (average / max) * plotH;
    ctx.strokeStyle = '#ffffff55';
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(left, ay);
    ctx.lineTo(left + plotW, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    text(ctx, t(lang, 'info.summaryCard.average', { value: format(average) }), left + plotW + 8, ay, { font: FONT(700, 11), color: ACCENT, align: 'left', baseline: 'middle' });
  }

  const every = Math.ceil(values.length / (plotW > 500 ? 12 : 8));
  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    text(ctx, label, left + slot * i + slot / 2, y + plotH + 20, { font: FONT(400, 11), color: MUTED, align: 'center' });
  });
}

/** The label of a day under the bars: "Oct 9" in English, "9 oct" in Spanish and "9 out" in Portuguese (no "de" and no dot, to fit). */
function formatDay(day, lang) {
  const date = new Date(`${day}T00:00:00Z`);
  const options = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (!DATE_LOCALES[lang] || lang === 'en') return date.toLocaleDateString('en-US', options);
  const parts = new Intl.DateTimeFormat(DATE_LOCALES[lang], options).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')} ${part('month').replace(/\./g, '')}`;
}

/**
 * `metric` is one of overview, messages, voice, joins, leaves, invites. Returns a PNG buffer.
 */
function buildSummaryCard({ guildName, days, metric = 'overview', summary, lang = currentLanguage() }) {
  registerCardFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const color = COLORS[metric] ?? ACCENT;
  const { totals } = summary;

  text(ctx, guildName.length > 38 ? `${guildName.slice(0, 37)}…` : guildName, 40, 56, { font: FONT(700, 30) });
  text(ctx, tn(lang, 'info.summaryCard.period', days, { count: days }), 40, 84, { font: FONT(400, 15), color: MUTED });
  const chip = t(lang, `info.summary.title.${metric}`);
  ctx.font = FONT(700, 15);
  const chipW = ctx.measureText(chip).width + 34;
  ctx.beginPath();
  ctx.roundRect(W - 40 - chipW, 36, chipW, 36, 18);
  ctx.fillStyle = color + '33';
  ctx.fill();
  text(ctx, chip, W - 40 - chipW / 2, 55, { font: FONT(700, 15), color, align: 'center', baseline: 'middle' });

  const g = summary.sanctions.byGroup;
  const tiles = metric === 'sanctions' ? [
    { key: 'sanctions', value: compact(summary.sanctions.total), color: COLORS.sanctions },
    { key: 'bans', value: compact(g.bans), color: '#f08fa0' },
    { key: 'mutes', value: compact(g.mutes), color: '#9bd0f5' },
    { key: 'warns', value: compact(g.warns), color: '#f5c26b' },
    { key: 'kicks', value: compact(g.kicks), color: '#c6a8f5' },
    { key: 'auto', value: compact(summary.sanctions.automatic), color: '#8fdca8' },
  ] : [
    { key: 'messages', value: compact(totals.messages), color: COLORS.messages },
    { key: 'active', value: compact(totals.activeMembers), color: ACCENT },
    { key: 'voice', value: duration(totals.voiceSeconds), color: COLORS.voice },
    { key: 'joins', value: compact(totals.joins), color: COLORS.joins },
    { key: 'leaves', value: compact(totals.leaves), color: COLORS.leaves },
    { key: 'invites', value: compact(totals.invited), color: COLORS.invites },
  ];
  const gap = 14;
  const tileW = (W - 80 - gap * 5) / 6;
  tiles.forEach((tile, i) => {
    const tx = 40 + i * (tileW + gap);
    panel(ctx, tx, 108, tileW, 92, tile.key === metric ? tile.color : BORDER);
    ctx.fillStyle = tile.color;
    ctx.beginPath();
    ctx.roundRect(tx + 18, 126, 22, 4, 2);
    ctx.fill();
    text(ctx, t(lang, `info.summaryCard.tile.${tile.key}`), tx + 18, 154, { font: FONT(700, 11), color: MUTED });
    text(ctx, tile.value, tx + 18, 186, { font: FONT(700, 27) });
  });

  // The day-by-day bars of the metric.
  const key = { overview: 'messages', messages: 'messages', voice: 'voice', joins: 'joins', leaves: 'leaves', invites: 'invited', sanctions: 'sanctions' }[metric];
  const values = metric === 'voice' ? summary.daily.voice.map((s) => s / 3600) : metric === 'sanctions' ? summary.sanctions.daily : summary.daily[key];
  const total = values.reduce((a, b) => a + b, 0);
  const unit = metric === 'voice' ? 'voice' : ['messages', 'joins', 'leaves', 'invites', 'sanctions'].includes(key) ? key : 'messages';
  panel(ctx, 40, 222, 760, 438);
  text(ctx, t(lang, `info.summaryCard.perDay.${unit}`), 64, 262, { font: FONT(700, 18) });
  text(ctx, t(lang, 'info.summaryCard.total', { total: metric === 'voice' ? `${total.toFixed(1)} h` : compact(total) }), 64, 284, { font: FONT(400, 13), color: MUTED });
  barChart(ctx, {
    lang,
    x: 54, y: 306, w: 732, h: 330, values, labels: summary.days.map((day) => formatDay(day, lang)), color,
    average: values.length ? total / values.length : null,
    format: metric === 'voice' ? (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) : compact,
  });

  // The hours of the day, or the days of the week for the metrics that have no hour.
  const byHour = metric === 'voice' ? summary.hours.voice : summary.hours.messages;
  const useHours = ['overview', 'messages', 'voice'].includes(metric);
  const kinds = metric === 'sanctions';
  const second = kinds ? [g.bans, g.mutes, g.warns, g.kicks, g.jails] : useHours ? byHour : summary.weekdays[key];
  const labels = kinds
    ? KINDS.map((kind) => t(lang, `info.summaryCard.kind.${kind}`))
    : useHours ? byHour.map((_, h) => (h % 3 === 0 ? String(h).padStart(2, '0') : '')) : WEEKDAYS.map((day) => t(lang, `info.summaryCard.day.${day}`));
  let best = -1;
  second.forEach((v, i) => { if (v > 0 && (best === -1 || v > second[best])) best = i; });
  panel(ctx, 824, 222, 416, 438);
  text(ctx, t(lang, kinds ? 'info.summaryCard.byKind' : useHours ? 'info.summaryCard.activeHours' : 'info.summaryCard.bestDays'), 848, 262, { font: FONT(700, 18) });
  const caption = best === -1
    ? t(lang, 'info.summaryCard.noData')
    : kinds ? t(lang, `info.summaryCard.most.${KINDS[best]}`) : useHours ? t(lang, 'info.summaryCard.busiestAt', { hour: hourLabel(best) }) : t(lang, `info.summaryCard.busiestOn.${WEEKDAYS[best]}`);
  text(ctx, caption, 848, 284, { font: FONT(400, 13), color: best === -1 ? MUTED : ACCENT });
  barChart(ctx, {
    lang,
    x: 838, y: 306, w: 392, h: 330,
    values: metric === 'voice' && useHours ? second.map((s) => s / 3600) : second,
    labels, color, highlight: best,
    format: metric === 'voice' && useHours ? (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) : compact,
  });

  return canvas.toBuffer('image/png');
}

// The drawing pieces, shared with the cards of `!stats` (src/imgutils/statsCards.js) so that all of them look alike.
const kit = { W, H, BG, PANEL, BORDER, TEXT, MUTED, GRID, ACCENT, COLORS, WEEKDAYS, FONT, compact, duration, panel, text, niceMax, formatDay };

module.exports = { buildSummaryCard, kit };
