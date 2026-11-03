// An optional rank card design, "3D glass": a dark glass panel with a warm glow, the avatar in a glowing ring, the level badge, the rank, the
// total XP and the progress bar with a gradient, an inner shadow and a highlight. It is not the default card and no server uses it unless
// it is wired to one; nothing calls it today. It knows nothing about Discord: the caller passes the numbers and the avatar picture.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('./cardFonts');
const { drawProgressBar, HEX, shade } = require('./progressBarImage');
const { t, formatNumber } = require('../i18n');

const WIDTH = 900;
const HEIGHT = 300;
const WARM = '#ffb84d';
const TEAL = '#5eead4';

const layers = new Map(); // the background and the glass frame, which only depend on the accent: drawn once and reused
function frame(accent) {
  let layer = layers.get(accent);
  if (layer) return layer;
  layer = createCanvas(WIDTH, HEIGHT);
  const ctx = layer.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  base.addColorStop(0, '#34353b'); base.addColorStop(1, '#1b1c21');
  ctx.fillStyle = base; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const [x, y, r, alpha] of [[760, 40, 420, 0.34], [90, 300, 300, 0.16]]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, shade(accent, 0, alpha)); glow.addColorStop(1, shade(accent, 0, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  // The glass panel: a soft shadow, a fill that is lighter at the top, a bright edge and a line of light along the top.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.beginPath(); ctx.roundRect(16, 14, WIDTH - 32, HEIGHT - 32, 38); ctx.fillStyle = 'rgba(20,21,26,0.9)'; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(16, 14, WIDTH - 32, HEIGHT - 32, 38);
  const glass = ctx.createLinearGradient(0, 14, 0, HEIGHT - 18);
  glass.addColorStop(0, 'rgba(255,255,255,0.14)'); glass.addColorStop(0.5, 'rgba(255,255,255,0.04)'); glass.addColorStop(1, 'rgba(255,255,255,0.07)');
  ctx.fillStyle = glass; ctx.fill();
  ctx.lineWidth = 2;
  const edge = ctx.createLinearGradient(0, 14, 0, HEIGHT - 18);
  edge.addColorStop(0, 'rgba(255,255,255,0.4)'); edge.addColorStop(0.4, 'rgba(255,255,255,0.08)'); edge.addColorStop(1, 'rgba(255,255,255,0.2)');
  ctx.strokeStyle = edge; ctx.stroke();
  // The halo behind the avatar.
  const halo = ctx.createRadialGradient(150, 142, 40, 150, 142, 130);
  halo.addColorStop(0, shade(accent, 0, 0.5)); halo.addColorStop(1, shade(accent, 0, 0));
  ctx.fillStyle = halo; ctx.fillRect(10, 10, 280, 280);
  layers.set(accent, layer);
  while (layers.size > 8) layers.delete(layers.keys().next().value);
  return layer;
}

/** The text shrunk until it fits `max` pixels, then cut with an ellipsis if it still does not. */
function fitText(ctx, text, family, weight, size, min, max) {
  let px = size;
  ctx.font = canvasFont(family, weight, px);
  while (px > min && ctx.measureText(text).width > max) { px -= 2; ctx.font = canvasFont(family, weight, px); }
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max && ctx.measureText(out).width > max) out = out.slice(0, -1);
  return out === text ? text : `${out.trimEnd()}…`;
}

/**
 * The card as a canvas of 900x300. `avatar` is an image or null (a circle with the initial is drawn then). `rank` null shows "not ranked".
 * `accent` is a `#rrggbb` hex, by default warm yellow for messages and teal for voice.
 */
function drawGlassRankCard({ data, name, avatar = null, source = 'messages', lang = 'en', accent = null }) {
  registerCardFonts();
  const voice = source === 'voice' || data.source === 'voice';
  const color = typeof accent === 'string' && HEX.test(accent.trim()) ? accent.trim().toLowerCase() : voice ? TEAL : WARM;
  const n = (value) => formatNumber(lang, value);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(frame(color), 0, 0);
  ctx.textBaseline = 'alphabetic';

  // The avatar: a ring with a gradient and a glow, the picture inside it, and a gloss on top.
  const cx = 150, cy = 136, r = 80;
  ctx.save();
  ctx.shadowColor = shade(color, 0, 0.8); ctx.shadowBlur = 26;
  ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  ring.addColorStop(0, shade(color, 0.45)); ring.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = ring; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = shade(color, -0.45); ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = canvasFont('Fredoka', 700, 84);
    ctx.fillText(Array.from(printable(name) || '?')[0].toUpperCase(), cx, cy + 29);
  }
  const gloss = ctx.createLinearGradient(0, cy - r, 0, cy);
  gloss.addColorStop(0, 'rgba(255,255,255,0.22)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(cx - r, cy - r, r * 2, r);
  ctx.restore();

  // The level badge, a glossy pill that overlaps the bottom of the avatar.
  const badge = `${t(lang, 'leveling.glass.levelShort')} ${n(data.level)}`;
  ctx.font = canvasFont('Fredoka', 700, 30);
  const bw = Math.max(110, ctx.measureText(badge).width + 40);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.beginPath(); ctx.roundRect(cx - bw / 2, 214, bw, 44, 22);
  const fill = ctx.createLinearGradient(0, 214, 0, 258);
  fill.addColorStop(0, shade(color, 0.3)); fill.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(cx - bw / 2 + 4, 217, bw - 8, 16, 8);
  const shine = ctx.createLinearGradient(0, 217, 0, 233);
  shine.addColorStop(0, 'rgba(255,255,255,0.5)'); shine.addColorStop(1, 'rgba(255,255,255,0.04)');
  ctx.fillStyle = shine; ctx.fill();
  ctx.fillStyle = '#1b1c21'; ctx.textAlign = 'center'; ctx.fillText(badge, cx, 246);

  // The name, then the rank and the total XP side by side, each with a small label.
  const left = 272, right = WIDTH - 52, span = right - left;
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.fillText(fitText(ctx, printable(name) || '?', 'Fredoka', 700, 48, 30, span), left, 84);
  ctx.shadowColor = 'transparent';
  let position = t(lang, 'leveling.rankView.notRanked');
  if (data.rank) position = data.total ? t(lang, 'leveling.rankView.positionOf', { rank: n(data.rank), total: n(data.total) }) : `#${n(data.rank)}`;
  const blocks = [
    [t(lang, voice ? 'leveling.rankView.voiceRank' : 'leveling.rankView.serverRank'), position, left],
    [t(lang, 'leveling.glass.totalXp'), n(data.xp), left + span * 0.52],
  ];
  for (const [label, value, x] of blocks) {
    ctx.font = canvasFont('Fredoka', 400, 26); ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.fillText(label, x, 126);
    ctx.fillStyle = shade(color, 0.25); ctx.fillText(fitText(ctx, value, 'Fredoka', 700, 36, 24, span * 0.46), x, 166);
  }

  // The XP of the level over the bar, and the bar itself (the same drawing as the embed's) a little wider than its picture is tall.
  ctx.fillStyle = '#ffffff';
  ctx.font = canvasFont('Fredoka', 700, 28); ctx.fillText(`${n(data.xpCurrent)} / ${n(data.xpNeeded)} XP`, left, 208);
  ctx.textAlign = 'right'; ctx.fillStyle = shade(color, 0.25); ctx.fillText(`${data.progress}%`, right, 208);
  const bar = drawProgressBar(data.progress, color);
  ctx.drawImage(bar, left - 2, 214, span + 4, (span + 4) * (bar.height / bar.width) * 1.25);
  return canvas;
}

/** The card as a WebP buffer (about 20 KB). */
async function renderGlassRankCard(options) {
  return drawGlassRankCard(options).encode('webp', 88);
}

module.exports = { WIDTH, HEIGHT, drawGlassRankCard, renderGlassRankCard };
