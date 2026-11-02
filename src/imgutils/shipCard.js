// Renders the picture of /ship: a love-themed card drawn in code. Two avatars in rings, a big heart with the score between them, the name of
// the pair on top and a row of hearts that fills with the score. The colors follow the step of the score (see SHIP_TIERS in utils/funGames.js):
// gray-blue with a broken heart when it is low, pinks in the middle, red and gold with sparkles for soulmates.
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { shipTier, shipName, plainName } = require('../utils/funGames');

GlobalFonts.registerFromPath(path.join(__dirname, 'Chewy.ttf'), 'Chewy');

const W = 900;
const H = 500;
const AVATAR_R = 98;
const LEFT_X = 165;
const RIGHT_X = W - 165;
const MID_Y = 262;
const CENTER_X = W / 2;
const HEART_SIZE = 112;
const FONT = 'Chewy, sans-serif'; // i18n-ignore: font, not text
const AVATAR_TIMEOUT_MS = 6_000;

// One theme for each look of a step. `bg` goes from the top left to the bottom right; `ring` and `heart` from light to dark.
const THEMES = {
  cold: { bg: ['#eaf0f6', '#c5d1df', '#97a7bd'], ring: ['#d5deea', '#7388a2'], heart: ['#b3c0d2', '#6a7b94'], ink: '#33445b', outline: '#40526b', meter: ['#9fb0c6', '#657891'], hearts: ['#ffffff', '#8fa2ba'], sparkle: '#ffffff', sparkles: 8, decor: 30 },
  soft: { bg: ['#fdeef5', '#efd5ec', '#cdbfe8'], ring: ['#e6c2f0', '#9f86d4'], heart: ['#eba1cf', '#b27ad2'], ink: '#5a2a6a', outline: '#7a3f93', meter: ['#e9a6d3', '#a97bd3'], hearts: ['#ffffff', '#d79ad0'], sparkle: '#ffffff', sparkles: 10, decor: 34 },
  warm: { bg: ['#ffeef4', '#ffc6dd', '#f58cb7'], ring: ['#ffb3d3', '#e0357f'], heart: ['#ff86ba', '#df2f7e'], ink: '#7a1f4d', outline: '#a3175f', meter: ['#ff9dca', '#e0357f'], hearts: ['#ffffff', '#ff7fb0'], sparkle: '#fff4fa', sparkles: 13, decor: 38 },
  hot: { bg: ['#ffe0e4', '#ff94ac', '#e04a74'], ring: ['#ff9db3', '#c61f4e'], heart: ['#ff5f80', '#c0173f'], ink: '#6e1030', outline: '#98113a', meter: ['#ff7a98', '#c61f4e'], hearts: ['#ffffff', '#ff6f8e'], sparkle: '#fff2c4', sparkles: 18, decor: 40 },
  soulmates: { bg: ['#ff6b82', '#d3214b', '#7e0c2e'], ring: ['#fff0a6', '#c9921a'], heart: ['#ff506f', '#b80f2f'], ink: '#6e0f2a', outline: '#6e0a22', meter: ['#ffe07a', '#e0a21b'], hearts: ['#ffd98a', '#ff8fa5'], sparkle: '#ffe9a3', sparkles: 28, decor: 44 },
};

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** A heart about `2.3 * size` wide centered on (cx, cy). */
function heartPath(ctx, cx, cy, size) {
  const s = size;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.95);
  ctx.bezierCurveTo(cx - s * 0.55, cy + s * 0.62, cx - s * 1.2, cy + s * 0.12, cx - s * 1.15, cy - s * 0.32);
  ctx.bezierCurveTo(cx - s * 1.1, cy - s * 0.82, cx - s * 0.42, cy - s * 1.0, cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.42, cy - s * 1.0, cx + s * 1.1, cy - s * 0.82, cx + s * 1.15, cy - s * 0.32);
  ctx.bezierCurveTo(cx + s * 1.2, cy + s * 0.12, cx + s * 0.55, cy + s * 0.62, cx, cy + s * 0.95);
  ctx.closePath();
}

/** A four point sparkle with curved sides. */
function sparklePath(ctx, cx, cy, size) {
  const pinch = size * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.quadraticCurveTo(cx + pinch, cy - pinch, cx + size, cy);
  ctx.quadraticCurveTo(cx + pinch, cy + pinch, cx, cy + size);
  ctx.quadraticCurveTo(cx - pinch, cy + pinch, cx - size, cy);
  ctx.quadraticCurveTo(cx - pinch, cy - pinch, cx, cy - size);
  ctx.closePath();
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((color, index) => gradient.addColorStop(stops.length === 1 ? 0 : index / (stops.length - 1), color));
  return gradient;
}

/** Places a shape that stays out of every area in `keepOut` (circles and boxes); null when no free spot was found. */
function freeSpot(random, size, keepOut) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = size + random() * (W - size * 2);
    const y = size + random() * (H - size * 2);
    const clear = keepOut.every((area) => (area.r
      ? Math.hypot(x - area.x, y - area.y) > area.r + size
      : x + size > area.x + area.w || x - size < area.x || y + size > area.y + area.h || y - size < area.y));
    if (clear) return { x, y };
  }
  return null;
}

function drawBackground(ctx, theme, keepOut, random, tierId) {
  ctx.fillStyle = linear(ctx, 0, 0, W, H, theme.bg);
  ctx.fillRect(0, 0, W, H);

  // A soft glow behind the middle of the card.
  const glow = ctx.createRadialGradient(CENTER_X, MID_Y, 20, CENTER_X, MID_Y, 380);
  glow.addColorStop(0, tierId === 'soulmates' ? 'rgba(255, 214, 130, 0.5)' : 'rgba(255, 255, 255, 0.5)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Hearts of every size and opacity, only where nothing else is drawn.
  for (let index = 0; index < theme.decor; index += 1) {
    const size = 7 + random() * random() * 24;
    const spot = freeSpot(random, size * 1.2, keepOut);
    if (!spot) continue;
    ctx.save();
    ctx.translate(spot.x, spot.y);
    ctx.rotate((random() - 0.5) * 0.9);
    ctx.globalAlpha = 0.14 + random() * 0.3;
    ctx.fillStyle = theme.hearts[Math.floor(random() * theme.hearts.length)];
    heartPath(ctx, 0, 0, size);
    ctx.fill();
    ctx.restore();
  }

  // Sparkles (and a few dots, like snow on a cold card).
  for (let index = 0; index < theme.sparkles; index += 1) {
    const size = 5 + random() * 12;
    const spot = freeSpot(random, size, keepOut);
    if (!spot) continue;
    ctx.save();
    ctx.globalAlpha = 0.45 + random() * 0.5;
    ctx.fillStyle = theme.sparkle;
    if (tierId === 'notMeant' || tierId === 'chilly') {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, size * 0.32, 0, Math.PI * 2);
    } else {
      sparklePath(ctx, spot.x, spot.y, size);
    }
    ctx.fill();
    ctx.restore();
  }
}

/** The picture of an avatar, or null when it cannot be loaded in time. */
async function loadAvatar(source) {
  let timer;
  try {
    return await Promise.race([
      loadImage(source),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), AVATAR_TIMEOUT_MS); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function drawAvatar(ctx, theme, image, cx, cy) {
  ctx.save();
  ctx.shadowColor = 'rgba(40, 10, 30, 0.35)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = linear(ctx, cx - AVATAR_R, cy - AVATAR_R, cx + AVATAR_R, cy + AVATAR_R, theme.ring);
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_R + 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_R + 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_R, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, cx - AVATAR_R, cy - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
  } else {
    // It could not be loaded: a disc in the colors of the card with a simple figure stands in for it.
    ctx.fillStyle = linear(ctx, cx, cy - AVATAR_R, cx, cy + AVATAR_R, theme.heart);
    ctx.fillRect(cx - AVATAR_R, cy - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy - 22, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + 78, 62, 52, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Writes `text` in the widest size (from `max` down to `min`) that fits `maxWidth`, and cuts it with an ellipsis if even `min` does not. */
function fitText(ctx, text, maxWidth, max, min) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  ctx.font = `${min}px ${FONT}`;
  let clipped = Array.from(text);
  while (clipped.length > 1 && ctx.measureText(`${clipped.join('')}…`).width > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped.join('')}…`;
}

function drawNamePlate(ctx, theme, text, cx, cy) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shown = fitText(ctx, text, 262, 38, 26);
  const width = Math.min(300, ctx.measureText(shown).width + 44);
  ctx.save();
  ctx.shadowColor = 'rgba(40, 10, 30, 0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, cx - width / 2, cy - 27, width, 54, 27);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = theme.ink;
  ctx.fillText(shown, cx, cy + 2);
}

/** The heart in the middle: whole, or split in two with a crack for the lowest steps. */
function drawBigHeart(ctx, theme, tierId, score) {
  const cy = MID_Y - 4;
  const broken = tierId === 'notMeant' || tierId === 'chilly';
  const paint = () => {
    heartPath(ctx, CENTER_X, cy, HEART_SIZE);
    ctx.fillStyle = linear(ctx, CENTER_X, cy - HEART_SIZE, CENTER_X, cy + HEART_SIZE, theme.heart);
    ctx.fill();
    ctx.lineWidth = tierId === 'soulmates' ? 7 : 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tierId === 'soulmates' ? linear(ctx, CENTER_X, cy - HEART_SIZE, CENTER_X, cy + HEART_SIZE, ['#fff0a6', '#d9a22a']) : 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
  };

  ctx.save();
  ctx.shadowColor = 'rgba(60, 10, 40, 0.38)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  if (!broken) {
    paint();
  } else {
    // The crack runs from the notch at the top to the tip at the bottom; each half is turned a little away from the other.
    const crack = [[0, -0.42], [0.2, -0.12], [-0.16, 0.12], [0.18, 0.4], [-0.06, 0.62], [0, 0.95]].map(([dx, dy]) => [CENTER_X + dx * HEART_SIZE, cy + dy * HEART_SIZE]);
    const pivotX = CENTER_X;
    const pivotY = cy + HEART_SIZE * 0.95;
    const half = (side) => {
      ctx.save();
      ctx.translate(pivotX + side * 13, pivotY + 4);
      ctx.rotate(side * 0.12);
      ctx.translate(-pivotX, -pivotY);
      ctx.beginPath();
      ctx.moveTo(crack[0][0], cy - HEART_SIZE * 1.4);
      for (const [x, y] of crack) ctx.lineTo(x, y);
      ctx.lineTo(CENTER_X, cy + HEART_SIZE * 1.3);
      ctx.lineTo(CENTER_X + side * HEART_SIZE * 2, cy + HEART_SIZE * 1.3);
      ctx.lineTo(CENTER_X + side * HEART_SIZE * 2, cy - HEART_SIZE * 1.4);
      ctx.closePath();
      ctx.clip();
      paint();
      ctx.beginPath();
      crack.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();
      ctx.restore();
    };
    half(-1);
    half(1);
  }
  ctx.restore();

  // The score, outlined so it reads on any color and at a small size.
  const text = `${score}%`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${score >= 100 ? 82 : 96}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = theme.outline;
  ctx.strokeText(text, CENTER_X, cy + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, CENTER_X, cy + 2);
}

/** Ten small hearts under the big one; they fill from the left (the one at the edge of the score is filled in part). */
function drawMeter(ctx, theme, score) {
  const size = 15;
  const step = 46;
  const y = 452;
  const startX = CENTER_X - (step * 9) / 2;
  for (let index = 0; index < 10; index += 1) {
    const cx = startX + index * step;
    heartPath(ctx, cx, y, size);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    const share = Math.min(1, Math.max(0, score / 10 - index));
    if (share > 0) {
      ctx.save();
      heartPath(ctx, cx, y, size);
      ctx.clip();
      ctx.fillStyle = linear(ctx, cx, y - size, cx, y + size, theme.meter);
      ctx.fillRect(cx - size * 1.2, y - size * 1.2, size * 2.4 * share, size * 2.4);
      ctx.restore();
    }
    heartPath(ctx, cx, y, size);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }
}

function drawTitle(ctx, theme, title) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shown = fitText(ctx, title, 700, 68, 38);
  ctx.save();
  ctx.shadowColor = 'rgba(40, 10, 30, 0.3)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = theme.outline;
  ctx.strokeText(shown, CENTER_X, 62);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(shown, CENTER_X, 62);
  return ctx.measureText(shown).width;
}

/**
 * @param {{avatarA: string, avatarB: string, nameA: string, nameB: string, score: number, shipName?: string, seed?: number}} options
 *   `shipName` is the name of the pair written on the card (it is made from the two names when it is not given) and `seed` moves the
 *   hearts around: the same seed gives the same card.
 * @returns {Promise<Buffer>} a PNG
 */
async function buildShipCard({ avatarA, avatarB, nameA, nameB, score, shipName: title, seed }) {
  const value = Math.min(100, Math.max(0, Math.round(Number(score) || 0)));
  const tier = shipTier(value);
  const theme = THEMES[tier.look];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const random = seededRandom(seed ?? value * 7919 + 13);
  const name = (raw) => plainName(raw) || '?';

  // Where the decoration must not go: the avatars, the heart, the title, the names and the meter.
  const keepOut = [
    { x: LEFT_X, y: MID_Y, r: AVATAR_R + 26 },
    { x: RIGHT_X, y: MID_Y, r: AVATAR_R + 26 },
    { x: CENTER_X, y: MID_Y, r: 150 },
    { x: 140, y: 14, w: W - 280, h: 100 },
    { x: 10, y: 360, w: 320, h: 70 },
    { x: W - 330, y: 360, w: 320, h: 70 },
    { x: CENTER_X - 250, y: 420, w: 500, h: 70 },
  ];

  const images = await Promise.all([loadAvatar(avatarA), loadAvatar(avatarB)]);

  ctx.save();
  roundRect(ctx, 0, 0, W, H, 36);
  ctx.clip();
  drawBackground(ctx, theme, keepOut, random, tier.id);
  drawAvatar(ctx, theme, images[0], LEFT_X, MID_Y);
  drawAvatar(ctx, theme, images[1], RIGHT_X, MID_Y);
  drawBigHeart(ctx, theme, tier.id, value);
  drawTitle(ctx, theme, title || shipName(nameA, nameB));
  drawNamePlate(ctx, theme, name(nameA), LEFT_X, 396);
  drawNamePlate(ctx, theme, name(nameB), RIGHT_X, 396);
  drawMeter(ctx, theme, value);
  ctx.restore();

  // Soft gradients make a heavy PNG: rounding each color to a multiple of 4 is invisible and halves it.
  const pixels = ctx.getImageData(0, 0, W, H);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.min(255, (data[index] + 2) & ~3);
    data[index + 1] = Math.min(255, (data[index + 1] + 2) & ~3);
    data[index + 2] = Math.min(255, (data[index + 2] + 2) & ~3);
  }
  ctx.putImageData(pixels, 0, 0);

  return canvas.toBuffer('image/png');
}

module.exports = { buildShipCard, THEMES, WIDTH: W, HEIGHT: H };
