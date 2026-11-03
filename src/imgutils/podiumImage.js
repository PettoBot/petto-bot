// i18n-ignore-file: draws what it is given; the texts come ready from the caller, in the language of the server
// The top three of a leaderboard as one picture: a dark glass panel with a podium, the first place in the middle and a little higher, each one
// with the avatar in a ring of the medal color (gold, silver, bronze), a crown on the first, the position in a small medal, the name, and the
// level and XP on the face of the block. It knows nothing about Discord or the database: the caller passes ready texts and avatars.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('./cardFonts');
const { shade } = require('./progressBarImage');

const WIDTH = 900;
const HEIGHT = 380;
const MEDALS = { 1: '#ffd34d', 2: '#d4dbe6', 3: '#e8995c' };
// Where each place stands: its column, the size of the avatar and where the name and the block start.
const SLOTS = {
  1: { cx: 450, r: 56, cy: 110, name: 208, top: 224, size: 38 },
  2: { cx: 160, r: 46, cy: 140, name: 232, top: 248, size: 33 },
  3: { cx: 740, r: 42, cy: 160, name: 250, top: 266, size: 33 },
};
const BOTTOM = 364;

let frameLayer = null; // the panel behind everything: the same for every picture
function frame() {
  if (frameLayer) return frameLayer;
  frameLayer = createCanvas(WIDTH, HEIGHT);
  const ctx = frameLayer.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  ctx.beginPath(); ctx.roundRect(8, 6, WIDTH - 16, HEIGHT - 14, 30); ctx.fillStyle = '#17181c'; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(8, 6, WIDTH - 16, HEIGHT - 14, 30);
  const base = ctx.createLinearGradient(0, 6, 0, HEIGHT);
  base.addColorStop(0, '#2c2d33'); base.addColorStop(1, '#17181c');
  ctx.fillStyle = base; ctx.fill();
  ctx.save(); ctx.clip();
  const spot = ctx.createRadialGradient(450, 70, 10, 450, 120, 380); // a warm light over the winner
  spot.addColorStop(0, 'rgba(255,211,77,0.24)'); spot.addColorStop(1, 'rgba(255,211,77,0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(9, 7, WIDTH - 18, HEIGHT - 16, 29); ctx.lineWidth = 2;
  const edge = ctx.createLinearGradient(0, 6, 0, HEIGHT);
  edge.addColorStop(0, 'rgba(255,255,255,0.32)'); edge.addColorStop(0.35, 'rgba(255,255,255,0.06)'); edge.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.strokeStyle = edge; ctx.stroke();
  return frameLayer;
}

function fit(ctx, text, size, min, max) {
  let px = size;
  ctx.font = canvasFont('Fredoka', 700, px);
  while (px > min && ctx.measureText(text).width > max) { px -= 2; ctx.font = canvasFont('Fredoka', 700, px); }
  let out = text;
  while (out.length > 1 && ctx.measureText(out).width > max) out = out.slice(0, -1);
  return out === text ? text : `${out.trimEnd()}…`;
}

function crown(ctx, cx, y, color) {
  const w = 44, h = 28;
  ctx.save();
  ctx.translate(cx - w / 2, y);
  ctx.beginPath();
  ctx.moveTo(0, h); ctx.lineTo(0, 8); ctx.lineTo(w * 0.25, h * 0.5); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.75, h * 0.5); ctx.lineTo(w, 8); ctx.lineTo(w, h);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, shade(color, 0.4)); gradient.addColorStop(1, shade(color, -0.25));
  ctx.shadowColor = shade(color, 0, 0.8); ctx.shadowBlur = 12;
  ctx.fillStyle = gradient; ctx.fill();
  ctx.restore();
}

/**
 * The picture as a canvas of 900x380. `entries` are up to three of `{ position: 1|2|3, name, line1, line2, avatar }`: `line1` is the big line on the
 * block (the level), `line2` the small one (the XP), `avatar` an image or null (a circle with the initial is drawn then).
 */
function drawPodium(entries) {
  registerCardFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(frame(), 0, 0);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';

  // The tallest first, so the lower blocks and their lights are over the ones behind.
  for (const entry of [...entries].filter((e) => SLOTS[e.position]).sort((a, b) => a.position - b.position)) {
    const slot = SLOTS[entry.position];
    const color = MEDALS[entry.position];
    const { cx, r, cy } = slot;

    // The block: glass tinted with the medal, a bright top edge and a soft light from above.
    const bw = 236, bx = cx - bw / 2, bh = BOTTOM - slot.top;
    ctx.save();
    ctx.shadowColor = shade(color, 0, entry.position === 1 ? 0.45 : 0.22); ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.roundRect(bx, slot.top, bw, bh, 20); ctx.fillStyle = '#1b1c20'; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(bx, slot.top, bw, bh, 20);
    const fill = ctx.createLinearGradient(0, slot.top, 0, BOTTOM);
    fill.addColorStop(0, shade(color, -0.1, 0.5)); fill.addColorStop(1, shade(color, -0.55, 0.16));
    ctx.fillStyle = fill; ctx.fill();
    ctx.save(); ctx.clip();
    const gloss = ctx.createLinearGradient(0, slot.top, 0, slot.top + bh * 0.45);
    gloss.addColorStop(0, 'rgba(255,255,255,0.22)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss; ctx.fillRect(bx, slot.top, bw, bh * 0.45);
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(bx + 0.5, slot.top + 0.5, bw - 1, bh - 1, 20); ctx.lineWidth = 2;
    const rim = ctx.createLinearGradient(0, slot.top, 0, BOTTOM);
    rim.addColorStop(0, shade(color, 0.3, 0.9)); rim.addColorStop(1, shade(color, 0, 0.12));
    ctx.strokeStyle = rim; ctx.stroke();

    // The level and the XP on the face of the block.
    const middle = slot.top + bh / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    if (entry.line2) {
      ctx.font = canvasFont('Fredoka', 700, 38); ctx.fillText(fit(ctx, entry.line1, 38, 24, bw - 24), cx, middle + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = canvasFont('Fredoka', 700, 31); ctx.fillText(fit(ctx, entry.line2, 31, 20, bw - 24), cx, middle + 38);
    } else {
      ctx.font = canvasFont('Fredoka', 700, 38); ctx.fillText(fit(ctx, entry.line1, 38, 24, bw - 24), cx, middle + 12);
    }
    ctx.shadowColor = 'transparent';

    // The avatar: a glowing ring in the medal color, the picture, a gloss, and the position in a small medal.
    ctx.save();
    ctx.shadowColor = shade(color, 0, 0.75); ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    const ring = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    ring.addColorStop(0, shade(color, 0.45)); ring.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = ring; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (entry.avatar) ctx.drawImage(entry.avatar, cx - r, cy - r, r * 2, r * 2);
    else {
      ctx.fillStyle = shade(color, -0.6); ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = shade(color, 0.3); ctx.font = canvasFont('Fredoka', 700, Math.round(r * 1.1));
      ctx.fillText(Array.from(printable(entry.name) || '?')[0].toUpperCase(), cx, cy + r * 0.38);
    }
    const shine = ctx.createLinearGradient(0, cy - r, 0, cy);
    shine.addColorStop(0, 'rgba(255,255,255,0.2)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine; ctx.fillRect(cx - r, cy - r, r * 2, r);
    ctx.restore();
    if (entry.position === 1) crown(ctx, cx, cy - r - 36, color);
    const mx = cx + r * 0.74, my = cy + r * 0.74;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(mx, my, 20, 0, Math.PI * 2);
    const medal = ctx.createLinearGradient(0, my - 20, 0, my + 20);
    medal.addColorStop(0, shade(color, 0.4)); medal.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = medal; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1b1c20'; ctx.font = canvasFont('Fredoka', 700, 26); ctx.fillText(String(entry.position), mx, my + 9);

    // The name between the avatar and the block.
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fit(ctx, printable(entry.name) || '?', slot.size, 22, 250), cx, slot.name);
    ctx.shadowColor = 'transparent';
  }
  return canvas;
}

module.exports = { WIDTH, HEIGHT, drawPodium };
