// i18n-ignore-file: the text drawn on the picture is the title and the artist of the song, never a message of Petto
// The picture of a song, an album or an artist: the cover on the left, and next to it a panel with the same cover blurred behind the title and
// the artist (the look of the music players of other bots). It is one picture, so it can be sent as one attachment.
const { createCanvas } = require('@napi-rs/canvas');
const { loadImageFromLink } = require('../utils/safeImage');
const { registerCardFonts, canvasFont } = require('./cardFonts');

const W = 1000;
const H = 260;
const GAP = 28;
const RADIUS = 30;
const PAD = 40;
const CACHE_LIMIT = 40;
const CACHE_MS = 10 * 60_000;
const cache = new Map();

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The text cut with an ellipsis so it is not wider than `max`. */
function fit(ctx, text, max) {
  const value = String(text ?? '');
  if (ctx.measureText(value).width <= max) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** A blurred copy of a picture over a rectangle: it is drawn tiny and then bigger, twice, which smooths it like a blur. */
function drawBlurred(ctx, image, x, y, w, h) {
  const steps = [24, 96];
  let source = image;
  for (const size of steps) {
    const small = createCanvas(size, Math.max(8, Math.round(size * (h / w))));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    // The picture covers the whole small canvas, cropped from the middle.
    const sw = source.width ?? size;
    const sh = source.height ?? size;
    const scale = Math.max(small.width / sw, small.height / sh);
    sctx.drawImage(source, (small.width - sw * scale) / 2, (small.height - sh * scale) / 2, sw * scale, sh * scale);
    source = small;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, w, h);
}

/**
 * @param {object} options
 * @param {string|null} options.coverUrl  The cover (https); without it, or when it cannot be loaded, the panel is plain.
 * @param {string} options.title          Song, album or artist.
 * @param {string} [options.subtitle]     Artist, or what it is.
 * @param {string} [options.detail]       A smaller third line (album, year...).
 * @param {boolean} [options.round]       The cover as a circle (an artist).
 * @returns {Promise<Buffer>} A PNG.
 */
async function buildSongCard({ coverUrl = null, title, subtitle = '', detail = '', round = false }) {
  const key = JSON.stringify([coverUrl, title, subtitle, detail, round]);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.buffer;

  registerCardFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cover = coverUrl ? await loadImageFromLink(coverUrl).catch(() => null) : null;

  // The cover on the left.
  ctx.save();
  if (round) { ctx.beginPath(); ctx.arc(H / 2, H / 2, H / 2, 0, Math.PI * 2); ctx.closePath(); } else roundRect(ctx, 0, 0, H, H, RADIUS);
  ctx.clip();
  if (cover) ctx.drawImage(cover, 0, 0, H, H);
  else { ctx.fillStyle = '#2b2d31'; ctx.fillRect(0, 0, H, H); ctx.fillStyle = '#ffffff55'; ctx.font = canvasFont('Poppins', 700, 120); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♪', H / 2, H / 2 + 6); }
  ctx.restore();

  // The panel: the cover blurred, darkened, with a shade from the left so the text always reads.
  const px = H + GAP;
  const pw = W - px;
  ctx.save();
  roundRect(ctx, px, 0, pw, H, RADIUS);
  ctx.clip();
  if (cover) drawBlurred(ctx, cover, px, 0, pw, H);
  else { ctx.fillStyle = '#35373c'; ctx.fillRect(px, 0, pw, H); }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(px, 0, pw, H);
  const shade = ctx.createLinearGradient(px, 0, px + pw, 0);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shade;
  ctx.fillRect(px, 0, pw, H);
  ctx.restore();

  // The text, in the middle of the panel.
  const tx = px + PAD;
  const max = pw - PAD * 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = [title, subtitle, detail].filter((line) => String(line ?? '').trim());
  const sizes = [58, 38, 30];
  const weights = [800, 400, 400];
  const colors = ['#ffffff', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.65)'];
  const heights = [66, 48, 40];
  const total = lines.reduce((sum, _, index) => sum + heights[index], 0);
  let y = (H - total) / 2;
  lines.forEach((line, index) => {
    ctx.font = canvasFont('Poppins', weights[index], sizes[index]);
    ctx.fillStyle = colors[index];
    y += heights[index];
    ctx.fillText(fit(ctx, line, max), tx, y - (heights[index] - sizes[index]) / 2 - 4);
  });

  const buffer = canvas.toBuffer('image/png');
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, { buffer, until: Date.now() + CACHE_MS });
  return buffer;
}

module.exports = { buildSongCard, fit };
