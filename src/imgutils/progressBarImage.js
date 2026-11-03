// i18n-ignore-file: draws shapes only, there is no text in the picture
// The progress bar of /rank as a small picture: a slim rounded pill with a near-black inset track and a soft gradient fill with a small
// highlight, drawn with the canvas (no emoji). It knows nothing about Discord: `utils/rankBar.js` caches the finished files.
const { createCanvas } = require('@napi-rs/canvas');

const WIDTH = 640;
const HEIGHT = 40;
const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
/** `hex` moved toward white (amount above 0) or toward black (below 0), as a canvas color. */
function shade(hex, amount, alpha = 1) {
  const [r, g, b] = rgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * k);
  return `rgba(${mix(r)},${mix(g)},${mix(b)},${alpha})`;
}

function pill(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
}
function vertical(ctx, y, h, stops) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + h);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

/** The bar as a canvas of 640x40 with a transparent background. `percent` is 0 to 100, `color` a `#rrggbb` hex. */
function drawProgressBar(percent, color) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // The track: near black, with a soft drop shadow under it, a shade at the top that makes it look sunk, and a lip of light at the bottom.
  const tx = 2, ty = 7, tw = WIDTH - 4, th = 26;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
  pill(ctx, tx, ty, tw, th); ctx.fillStyle = '#0d0e11'; ctx.fill();
  ctx.restore();
  pill(ctx, tx, ty, tw, th);
  ctx.fillStyle = vertical(ctx, ty, th, [[0, '#08090b'], [0.55, '#14151a'], [1, '#202228']]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = vertical(ctx, ty, 11, [[0, 'rgba(0,0,0,0.65)'], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(tx, ty, tw, 11);
  ctx.restore();
  pill(ctx, tx + 0.5, ty + 0.5, tw - 1, th - 1);
  ctx.lineWidth = 1;
  ctx.strokeStyle = vertical(ctx, ty, th, [[0, 'rgba(255,255,255,0.03)'], [1, 'rgba(255,255,255,0.12)']]);
  ctx.stroke();

  if (pct > 0) {
    const inset = 3;
    const fx = tx + inset, fy = ty + inset, fh = th - inset * 2;
    const fw = Math.max(fh, Math.round((tw - inset * 2) * (pct / 100)));
    // A soft glow of the fill color around it, then the fill itself: lighter on top, deeper at the bottom.
    ctx.save();
    ctx.shadowColor = shade(color, 0, 0.55); ctx.shadowBlur = 9;
    pill(ctx, fx, fy, fw, fh); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    pill(ctx, fx, fy, fw, fh);
    ctx.fillStyle = vertical(ctx, fy, fh, [[0, shade(color, 0.3)], [0.5, shade(color, -0.02)], [1, shade(color, -0.34)]]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // A little shade at the bottom edge and a bright rim at the end of the fill.
    ctx.fillStyle = vertical(ctx, fy + fh - 6, 6, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.22)']]);
    ctx.fillRect(fx, fy + fh - 6, fw, 6);
    const rim = ctx.createLinearGradient(fx + fw - 14, 0, fx + fw, 0);
    rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(255,255,255,0.22)');
    ctx.fillStyle = rim; ctx.fillRect(fx + fw - 14, fy, 14, fh);
    ctx.restore();
    // The specular highlight: a thin glossy stripe along the upper part.
    const hl = Math.max(4, Math.round(fh * 0.34));
    const margin = Math.min(7, fw / 4);
    pill(ctx, fx + margin, fy + 2, fw - margin * 2, hl);
    ctx.fillStyle = vertical(ctx, fy + 2, hl, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0.06)']]);
    ctx.fill();
    pill(ctx, fx + 0.5, fy + 0.5, fw - 1, fh - 1);
    ctx.lineWidth = 1; ctx.strokeStyle = shade(color, -0.45, 0.55); ctx.stroke();
  }
  return canvas;
}

module.exports = { WIDTH, HEIGHT, HEX, drawProgressBar, shade };
