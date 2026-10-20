// One picture with every avatar a person has had, newest first, each with the date it was seen.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('../imgutils/cardFonts');
const { loadImageFromLink, decode } = require('./safeImage');
const { avatarUrl } = require('./identityHistory');

const COLUMNS = 6;
const TILE = 128;
const GAP = 14;
const LABEL = 26;
const PAD = 22;
const MAX_TILES = 48; // 8 rows of 6; the rest is counted in the message
const BG = '#17181c';
const TILE_BG = '#23252b';
const TEXT = '#c9c5bb';

const dateLabel = (value) => {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * `rows` are `{ value (the avatar hash), seen_at }` newest first. `stored` (hash -> bytes) are the kept copies, drawn instead of asking
 * Discord, which no longer serves most old avatars. Returns `{ buffer, shown }`: a PNG and how many avatars it holds
 * (a picture that could not be loaded is drawn as an empty tile). `loader` lets a test replace the download.
 */
async function renderAvatarSheet(userId, rows, { loader = loadImageFromLink, stored = new Map() } = {}) {
  registerCardFonts();
  const list = rows.slice(0, MAX_TILES);
  const fromCopy = async (bytes) => { try { return await decode(bytes); } catch { return null; } };
  const images = await Promise.all(list.map(async (row) => (stored.has(row.value) ? await fromCopy(stored.get(row.value)) : null) ?? loader(avatarUrl(userId, row.value, TILE))));
  const rowsCount = Math.max(1, Math.ceil(list.length / COLUMNS));
  const columns = Math.min(COLUMNS, Math.max(1, list.length));
  const width = PAD * 2 + columns * TILE + (columns - 1) * GAP;
  const height = PAD * 2 + rowsCount * (TILE + LABEL) + (rowsCount - 1) * GAP;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.font = canvasFont('Poppins', 400, 13);
  list.forEach((row, index) => {
    const x = PAD + (index % COLUMNS) * (TILE + GAP);
    const y = PAD + Math.floor(index / COLUMNS) * (TILE + LABEL + GAP);
    ctx.save();
    roundRect(ctx, x, y, TILE, TILE, 14);
    ctx.clip();
    ctx.fillStyle = TILE_BG;
    ctx.fillRect(x, y, TILE, TILE);
    if (images[index]) ctx.drawImage(images[index], x, y, TILE, TILE);
    ctx.restore();
    ctx.fillStyle = TEXT;
    ctx.fillText(dateLabel(row.seen_at), x + TILE / 2, y + TILE + 18);
  });
  return { buffer: canvas.toBuffer('image/png'), shown: list.length, width, height };
}

module.exports = { renderAvatarSheet, MAX_TILES };
