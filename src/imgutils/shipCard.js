// Renders the picture of /ship: both avatars, a heart with the score between them and a bar underneath.
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

GlobalFonts.registerFromPath(path.join(__dirname, 'Chewy.ttf'), 'Chewy');

const W = 900;
const H = 420;
const AVATAR = 220;
const AVATAR_Y = 70;
const LEFT_X = 90;
const RIGHT_X = W - 90 - AVATAR;
const CENTER_X = W / 2;
const BAR = { x: 150, y: 362, w: W - 300, h: 26 };

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

function heartPath(ctx, cx, cy, size) {
  const top = cy - size * 0.35;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.55);
  ctx.bezierCurveTo(cx - size * 1.05, cy - size * 0.05, cx - size * 0.62, top - size * 0.5, cx, top + size * 0.1);
  ctx.bezierCurveTo(cx + size * 0.62, top - size * 0.5, cx + size * 1.05, cy - size * 0.05, cx, cy + size * 0.55);
  ctx.closePath();
}

let backgroundPromise = null;

function loadBackground() {
  backgroundPromise ??= loadImage(path.join(__dirname, 'fondoship.jpg')).catch(() => null);
  return backgroundPromise;
}

async function drawBackground(ctx) {
  const image = await loadBackground();
  if (!image) {
    // The picture is missing: a plain pink gradient stands in for it.
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, '#ffe3ef');
    gradient.addColorStop(1, '#f4b6d2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // Fill the card with the picture without stretching it.
  const scale = Math.max(W / image.width, H / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (W - width) / 2, (H - height) / 2, width, height);

  // A light veil keeps the names and the bar readable over the roses.
  ctx.fillStyle = 'rgba(255, 240, 247, 0.28)';
  ctx.fillRect(0, 0, W, H);
}

async function drawAvatar(ctx, url, x, y) {
  const cx = x + AVATAR / 2;
  const cy = y + AVATAR / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(180, 60, 110, 0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR / 2 + 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR / 2, 0, Math.PI * 2);
  ctx.clip();
  try {
    ctx.drawImage(await loadImage(url), x, y, AVATAR, AVATAR);
  } catch {
    // The avatar could not be loaded; a plain pink disc stands in for it.
    ctx.fillStyle = '#f6a5c6';
    ctx.fillRect(x, y, AVATAR, AVATAR);
  }
  ctx.restore();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

/**
 * @param {{avatarA: string, avatarB: string, nameA: string, nameB: string, score: number}} options
 * @returns {Promise<Buffer>} a PNG
 */
async function buildShipCard({ avatarA, avatarB, nameA, nameB, score }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.save();
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.clip();
  await drawBackground(ctx);

  await drawAvatar(ctx, avatarA, LEFT_X, AVATAR_Y);
  await drawAvatar(ctx, avatarB, RIGHT_X, AVATAR_Y);

  // The heart between them, with the score inside.
  ctx.save();
  ctx.shadowColor = 'rgba(190, 40, 100, 0.4)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  heartPath(ctx, CENTER_X, AVATAR_Y + AVATAR / 2 + 2, 108);
  const heart = ctx.createLinearGradient(CENTER_X, AVATAR_Y, CENTER_X, AVATAR_Y + AVATAR);
  heart.addColorStop(0, '#ff7eb6');
  heart.addColorStop(1, '#e83e8c');
  ctx.fillStyle = heart;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '58px Chewy, sans-serif';
  ctx.fillText(`${score}%`, CENTER_X, AVATAR_Y + AVATAR / 2 - 6);

  // Names under the avatars.
  ctx.fillStyle = '#7a1f4d';
  ctx.font = '30px Chewy, sans-serif';
  ctx.fillText(fitText(ctx, nameA, 260), LEFT_X + AVATAR / 2, AVATAR_Y + AVATAR + 38);
  ctx.fillText(fitText(ctx, nameB, 260), RIGHT_X + AVATAR / 2, AVATAR_Y + AVATAR + 38);

  // The compatibility bar.
  roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, BAR.h / 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fill();
  const filled = Math.max(BAR.h, (BAR.w * score) / 100);
  if (score > 0) {
    roundRect(ctx, BAR.x, BAR.y, filled, BAR.h, BAR.h / 2);
    const fill = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
    fill.addColorStop(0, '#ff9ccc');
    fill.addColorStop(1, '#e83e8c');
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { buildShipCard };
