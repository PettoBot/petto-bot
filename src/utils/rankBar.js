// The progress bar picture of the rank embed, with its cache. There are only 101 percentages and a few colors, so a bar is drawn the first
// time it is asked for and kept: after that, asking again is a map lookup with no drawing and no encoding. The files weigh about 1 KB each.
//   RANK_BAR_CACHE_ENTRIES  how many finished bars are kept (default 512, 16 to 5000); the least recently used one goes first
//   RANK_BAR_FORMAT         webp (default) or png
const { drawProgressBar, HEX } = require('../imgutils/progressBarImage');

const DEFAULT_COLOR = '#ffb199'; // Petto's peach, the accent of the messages rank card
const VOICE_COLOR = '#5eead4'; // and its teal, the accent of the voice one
const entries = () => Math.min(5000, Math.max(16, Math.floor(Number(process.env.RANK_BAR_CACHE_ENTRIES)) || 512));
const format = () => (String(process.env.RANK_BAR_FORMAT).toLowerCase() === 'png' ? 'png' : 'webp');
const QUALITY = 92;

const done = new Map(); // key -> { buffer, name }, the most recently used last
const pending = new Map();

/** The color of a bar: the one given when it is a `#rrggbb` hex, otherwise Petto's peach (messages) or teal (voice). */
function barColor(color, voice = false) {
  return typeof color === 'string' && HEX.test(color.trim()) ? color.trim().toLowerCase() : voice ? VOICE_COLOR : DEFAULT_COLOR;
}

/**
 * The picture of a bar as `{ buffer, name }` (the name is always `rank-bar.webp`, or `.png`, so the embed points at the same file every time).
 * `percent` is 0 to 100. It never throws for a bad value; it throws only when the picture cannot be encoded, and the caller then uses text.
 */
async function renderRankBar({ percent, color, voice = false } = {}) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const type = format();
  const key = `${type}|${pct}|${barColor(color, voice)}`;
  const hit = done.get(key);
  if (hit) { done.delete(key); done.set(key, hit); return hit; }
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const canvas = drawProgressBar(pct, barColor(color, voice));
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

module.exports = { DEFAULT_COLOR, VOICE_COLOR, barColor, renderRankBar, clearRankBars, rankBarCacheSize };
