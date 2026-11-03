// The progress bar picture of the rank embed, with its cache. There are only 101 percentages, three themes and a few colors, so a bar is drawn the
// first time it is asked for and kept: after that, asking again is a map lookup with no drawing and no encoding. The files weigh a few KB each.
//   RANK_BAR_THEME          auto (default), normal, halloween or christmas. `auto` follows the date (see `themeFor`)
//   RANK_BAR_CACHE_ENTRIES  how many finished bars are kept (default 512, 16 to 5000); the least recently used one goes first
//   RANK_BAR_FORMAT         png (default: flat colors stay exact and it is as small as WebP) or webp
const { drawProgressBar, themeColor, HEX, THEMES } = require('../imgutils/progressBarImage');

const entries = () => Math.min(5000, Math.max(16, Math.floor(Number(process.env.RANK_BAR_CACHE_ENTRIES)) || 512));
const format = () => (String(process.env.RANK_BAR_FORMAT).toLowerCase() === 'webp' ? 'webp' : 'png');
const QUALITY = 90;

/** The theme of a date: Halloween all of October, Christmas from November 1 to January 10 (UTC), the normal one otherwise. */
function themeFor(date = new Date()) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === 10) return 'halloween';
  if (month === 11 || month === 12 || (month === 1 && day <= 10)) return 'christmas';
  return 'normal';
}

/** The theme to draw now: `RANK_BAR_THEME` when it names one, otherwise the one of today's date. */
function currentTheme(date = new Date()) {
  const wanted = String(process.env.RANK_BAR_THEME ?? '').trim().toLowerCase();
  return THEMES.includes(wanted) ? wanted : themeFor(date);
}

const done = new Map(); // key -> { buffer, name }, the most recently used last
const pending = new Map();

/** The fill color of a bar: the one given when it is a `#rrggbb` hex, otherwise the theme's own (a different one for voice). */
function barColor(color, voice = false, theme = 'normal') {
  return typeof color === 'string' && HEX.test(color.trim()) ? color.trim().toLowerCase() : themeColor(theme, voice);
}

/**
 * The picture of a bar as `{ buffer, name }` (the name is always `rank-bar.png`, or `.webp`, so the embed points at the same file every time).
 * `percent` is 0 to 100; `theme` is one of the three, by default the current one. It never throws for a bad value; it throws only when the
 * picture cannot be encoded, and the caller then uses text.
 */
async function renderRankBar({ percent, color, voice = false, theme } = {}) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const look = THEMES.includes(theme) ? theme : currentTheme();
  const type = format();
  const fill = barColor(color, voice, look);
  const key = `${type}|${look}|${pct}|${fill}`;
  const hit = done.get(key);
  if (hit) { done.delete(key); done.set(key, hit); return hit; }
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const canvas = drawProgressBar(pct, fill, look);
      const buffer = type === 'png' ? await canvas.encode('png') : await canvas.encode('webp', QUALITY);
      const value = { buffer, name: `rank-bar.${type}` };
      done.set(key, value);
      while (done.size > entries()) done.delete(done.keys().next().value);
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}

function clearRankBars() { done.clear(); pending.clear(); }
function rankBarCacheSize() { return { entries: done.size, bytes: [...done.values()].reduce((sum, item) => sum + item.buffer.length, 0) }; }

module.exports = { THEMES, themeFor, currentTheme, barColor, renderRankBar, clearRankBars, rankBarCacheSize };
