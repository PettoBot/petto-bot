// The drawing kit behind Petto's card designs (scripts/designs). Every design is drawn from code with these helpers, in a
// logical canvas of 1024 by 500 that is rendered at 1.25x, so the artwork is original, reproducible (a seeded random generator
// is the only source of chance) and weighs nothing in the repository but its code and the small WebP files it makes.
const { createCanvas, Path2D } = require('@napi-rs/canvas');

const W = 1024;
const H = 500;
const SCALE = 1.25;

// ---------- chance ----------
function rng(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

// ---------- colour ----------
function parse(hex) { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
const toHex = (r, g, b) => `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
function mix(a, b, t) { const p = parse(a); const q = parse(b); return toHex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t); }
const lighten = (c, t) => mix(c, '#ffffff', t);
const darken = (c, t) => mix(c, '#000000', t);
function rgba(hex, alpha) { const [r, g, b] = parse(hex); return `rgba(${r},${g},${b},${alpha})`; }
/** A colour from hue (0 to 360), saturation and lightness (0 to 100). */
function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
function luminance(hex) {
  const lin = parse(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---------- gradients ----------
function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(Array.isArray(s) ? s[0] : i / (stops.length - 1), Array.isArray(s) ? s[1] : s));
  return g;
}
function rad(ctx, x, y, r, stops, x0 = x, y0 = y, r0 = 0) {
  const g = ctx.createRadialGradient(x0, y0, r0, x, y, r);
  stops.forEach((s, i) => g.addColorStop(Array.isArray(s) ? s[0] : i / (stops.length - 1), Array.isArray(s) ? s[1] : s));
  return g;
}

// ---------- the canvas ----------
function start() {
  const canvas = createCanvas(Math.round(W * SCALE), Math.round(H * SCALE));
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  return { canvas, ctx };
}

/** The whole picture in one gradient, `angle` in degrees (0 is top to bottom). */
function sky(ctx, stops, angle = 0) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a) * W / 2; const dy = Math.cos(a) * H / 2;
  ctx.fillStyle = lin(ctx, W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy, stops);
  ctx.fillRect(0, 0, W, H);
}

/** A soft round light. */
function glow(ctx, x, y, r, color, alpha = 0.5, mode = 'source-over') {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.fillStyle = rad(ctx, x, y, r, [[0, rgba(color, alpha)], [0.45, rgba(color, alpha * 0.4)], [1, rgba(color, 0)]]);
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ---------- paths ----------
/** A closed smooth curve through points (Catmull-Rom turned into Beziers). */
function smooth(points, closed = true, tension = 0.5) {
  const path = new Path2D();
  const n = points.length;
  const at = (i) => points[(i + n) % n];
  path.moveTo(points[0][0], points[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const p0 = closed ? at(i - 1) : points[Math.max(i - 1, 0)];
    const p1 = at(i);
    const p2 = closed ? at(i + 1) : points[i + 1];
    const p3 = closed ? at(i + 2) : points[Math.min(i + 2, n - 1)];
    const t = tension / 3 * 2;
    path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t / 2, p1[1] + (p2[1] - p0[1]) * t / 2, p2[0] - (p3[0] - p1[0]) * t / 2, p2[1] - (p3[1] - p1[1]) * t / 2, p2[0], p2[1]);
  }
  if (closed) path.closePath();
  return path;
}

/** A rounded rectangle path. */
function rrect(x, y, w, h, r) {
  const p = new Path2D();
  const k = Math.min(r, w / 2, h / 2);
  p.moveTo(x + k, y); p.arcTo(x + w, y, x + w, y + h, k); p.arcTo(x + w, y + h, x, y + h, k); p.arcTo(x, y + h, x, y, k); p.arcTo(x, y, x + w, y, k); p.closePath();
  return p;
}

function ellipse(cx, cy, rx, ry, rot = 0) {
  const p = new Path2D();
  p.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2);
  return p;
}

/** A leaf with a pointed tip, from its base (x, y) to its tip, `w` wide. */
function leafPath(x, y, tipX, tipY, w) {
  const dx = tipX - x; const dy = tipY - y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  const p = new Path2D();
  p.moveTo(x, y);
  p.bezierCurveTo(x + dx * 0.25 + nx * w, y + dy * 0.25 + ny * w, x + dx * 0.75 + nx * w * 0.7, y + dy * 0.75 + ny * w * 0.7, tipX, tipY);
  p.bezierCurveTo(x + dx * 0.75 - nx * w * 0.7, y + dy * 0.75 - ny * w * 0.7, x + dx * 0.25 - nx * w, y + dy * 0.25 - ny * w, x, y);
  p.closePath();
  return p;
}

/** A polygon with rounded corners (an ear, a nose, a leaf tip). */
function roundedPoly(points, radius) {
  const p = new Path2D();
  const n = points.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[n - 1], points[0]);
  p.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i += 1) { const v = points[i]; const next = points[(i + 1) % n]; p.arcTo(v[0], v[1], next[0], next[1], radius); }
  p.closePath();
  return p;
}

function star4(x, y, r, pinch = 0.22) {
  const p = new Path2D();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const d = i % 2 === 0 ? r : r * pinch;
    const px = x + Math.cos(a) * d; const py = y + Math.sin(a) * d;
    if (i === 0) p.moveTo(px, py); else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

function heartPath(x, y, s) {
  const p = new Path2D();
  p.moveTo(x, y + s * 0.35);
  p.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.85, x, y - s * 0.4);
  p.bezierCurveTo(x + s * 0.45, y - s * 0.85, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
  p.closePath();
  return p;
}

// ---------- shading ----------
/** A round thing with a light from the top left: lit side, its own colour, shaded rim. */
function puff(ctx, path, cx, cy, r, color, { light = 0.32, dark = 0.34 } = {}) {
  ctx.fillStyle = rad(ctx, cx, cy, r * 1.25, [[0, lighten(color, light)], [0.5, color], [1, darken(color, dark)]], cx - r * 0.32, cy - r * 0.38, r * 0.05);
  ctx.fill(path);
}

/** A flat shape with a soft gradient from one colour to another along a direction. */
function ramp(ctx, path, x0, y0, x1, y1, stops) {
  ctx.fillStyle = lin(ctx, x0, y0, x1, y1, stops);
  ctx.fill(path);
}

/** A glossy spot of light. */
function gloss(ctx, x, y, rx, ry, rot = -0.6, alpha = 0.55) {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A soft shadow on the ground. */
function groundShadow(ctx, x, y, rx, ry, alpha = 0.28, color = '#000000') {
  ctx.save();
  ctx.fillStyle = rad(ctx, x, y, rx, [[0, rgba(color, alpha)], [0.6, rgba(color, alpha * 0.45)], [1, rgba(color, 0)]]);
  ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
  ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
  ctx.restore();
}

/** A drop shadow behind whatever `draw` paints. */
function withShadow(ctx, draw, { color = 'rgba(0,0,0,0.3)', blur = 18, x = 0, y = 8 } = {}) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = blur * SCALE; ctx.shadowOffsetX = x * SCALE; ctx.shadowOffsetY = y * SCALE;
  draw();
  ctx.restore();
}

// ---------- faces ----------
/** A kawaii face centered at (x, y), `s` is half the width between the cheeks. */
function face(ctx, x, y, s, { eye = '#2a1830', blush = '#ff8fa3', mouth = 'smile', gap = 0.62, eyeSize = 0.2, blushAlpha = 0.6, lashes = false } = {}) {
  const ex = s * gap;
  const er = s * eyeSize;
  for (const side of [-1, 1]) {
    const cx = x + side * ex;
    ctx.fillStyle = rad(ctx, cx, y, er * 1.2, [[0, '#4a3358'], [1, eye]], cx - er * 0.2, y - er * 0.3, 0);
    ctx.beginPath(); ctx.ellipse(cx, y, er, er * 1.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx - er * 0.32, y - er * 0.38, er * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(cx + er * 0.34, y + er * 0.36, er * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (lashes) { ctx.strokeStyle = eye; ctx.lineWidth = er * 0.28; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx + side * er * 0.9, y - er * 0.7); ctx.lineTo(cx + side * er * 1.5, y - er * 1.05); ctx.stroke(); }
    // The cheeks.
    ctx.fillStyle = rad(ctx, cx + side * s * 0.55, y + s * 0.28, s * 0.34, [[0, rgba(blush, blushAlpha)], [1, rgba(blush, 0)]]);
    ctx.beginPath(); ctx.ellipse(cx + side * s * 0.55, y + s * 0.28, s * 0.34, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (mouth === null) return;
  ctx.strokeStyle = eye; ctx.lineWidth = Math.max(1.6, s * 0.075); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const my = y + s * 0.3;
  ctx.beginPath();
  if (mouth === 'smile') { ctx.moveTo(x - s * 0.16, my); ctx.quadraticCurveTo(x, my + s * 0.2, x + s * 0.16, my); } else if (mouth === 'cat') { ctx.moveTo(x - s * 0.24, my); ctx.quadraticCurveTo(x - s * 0.12, my + s * 0.2, x, my); ctx.quadraticCurveTo(x + s * 0.12, my + s * 0.2, x + s * 0.24, my); } else if (mouth === 'o') { ctx.ellipse(x, my + s * 0.08, s * 0.07, s * 0.09, 0, 0, Math.PI * 2); } else { ctx.moveTo(x - s * 0.1, my); ctx.lineTo(x + s * 0.1, my); }
  ctx.stroke();
}

// ---------- scenery ----------
function stars(ctx, rand, n, { x0 = 0, y0 = 0, x1 = W, y1 = H, color = '#ffffff', min = 0.6, max = 2.2, sparkle = 0.12, alpha = 1 } = {}) {
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const x = rand.range(x0, x1); const y = rand.range(y0, y1); const r = rand.range(min, max);
    ctx.globalAlpha = alpha * rand.range(0.3, 1);
    ctx.fillStyle = color;
    if (rand.next() < sparkle) ctx.fill(star4(x, y, r * 4.2));
    else { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

/** Layers of soft hills, each lighter or darker than the one behind it. `layers` is a list of { y, amp, color, freq, seed }. */
function ridges(ctx, layers) {
  for (const layer of layers) {
    const rand = rng(layer.seed ?? 1);
    const phase = rand.range(0, 6.28); const phase2 = rand.range(0, 6.28);
    const path = new Path2D();
    path.moveTo(-10, H + 10);
    for (let x = -10; x <= W + 10; x += 8) {
      const y = layer.y + Math.sin(x * layer.freq + phase) * layer.amp + Math.sin(x * layer.freq * 2.3 + phase2) * layer.amp * 0.35;
      path.lineTo(x, y);
    }
    path.lineTo(W + 10, H + 10); path.closePath();
    ctx.fillStyle = Array.isArray(layer.color) ? lin(ctx, 0, layer.y - layer.amp, 0, H, layer.color) : layer.color;
    ctx.globalAlpha = layer.alpha ?? 1;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }
}

/** A fluffy cloud made of circles, centered at (x, y), `s` is its width. */
function cloud(ctx, x, y, s, color = '#ffffff', alpha = 1, shade = null) {
  const path = new Path2D();
  const bumps = [[-0.32, 0.05, 0.2], [-0.12, -0.1, 0.27], [0.14, -0.04, 0.24], [0.34, 0.06, 0.18], [0, 0.1, 0.3]];
  for (const [bx, by, br] of bumps) { path.moveTo(x + bx * s + br * s, y + by * s); path.arc(x + bx * s, y + by * s, br * s, 0, Math.PI * 2); }
  path.rect(x - 0.34 * s, y + 0.08 * s, 0.68 * s, 0.14 * s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = shade ? lin(ctx, x, y - 0.3 * s, x, y + 0.25 * s, [color, shade]) : color;
  ctx.fill(path);
  ctx.restore();
}

/** Small dots in a staggered grid, for a quiet pattern. */
function dotGrid(ctx, { x0 = 0, y0 = 0, x1 = W, y1 = H, step = 28, r = 1.6, color = '#ffffff', alpha = 0.08 } = {}) {
  ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha;
  let row = 0;
  for (let y = y0; y <= y1; y += step * 0.866, row += 1) {
    for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

/** Soft bokeh circles. */
function bokeh(ctx, rand, n, colors, { x0 = 0, y0 = 0, x1 = W, y1 = H, min = 6, max = 30, alpha = 0.18 } = {}) {
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const x = rand.range(x0, x1); const y = rand.range(y0, y1); const r = rand.range(min, max);
    ctx.fillStyle = rad(ctx, x, y, r, [[0, rgba(rand.pick(colors), alpha * 1.2)], [0.75, rgba(rand.pick(colors), alpha)], [1, rgba(rand.pick(colors), 0)]]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Big soft translucent discs that overlap, for a layered, modern background. */
function discs(ctx, rand, n, colors, { x0 = 0, y0 = 0, x1 = W, y1 = H, min = 40, max = 160, alpha = 0.1, rim = 0.07 } = {}) {
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const x = rand.range(x0, x1); const y = rand.range(y0, y1); const r = rand.range(min, max);
    const c = rand.pick(colors);
    ctx.fillStyle = rad(ctx, x, y, r, [[0, rgba(c, alpha * 0.6)], [1, rgba(c, alpha)]], x - r * 0.3, y - r * 0.3, 0);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (rim) { ctx.strokeStyle = rgba(lighten(c, 0.5), rim); ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.restore();
}

/** Wide soft diagonal bands of light. */
function bands(ctx, rand, n, color, { alpha = 0.07, width = 70, angle = -0.35 } = {}) {
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(angle);
  for (let i = 0; i < n; i += 1) {
    const x = -W + (i + rand.range(0.1, 0.9)) * (2 * W / n);
    const w = width * rand.range(0.5, 1.6);
    ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [rgba(color, 0), rgba(color, alpha), rgba(color, 0)]);
    ctx.fillRect(x, -H * 1.5, w, H * 3);
  }
  ctx.restore();
}

/** A crescent moon centered at (x, y) with radius r, `bite` moves the dark disc that cuts it. */
function crescent(ctx, x, y, r, stops, bite = 0.42) {
  const size = Math.ceil(r * 2.6 * SCALE);
  const layer = createCanvas(size, size);
  const lc = layer.getContext('2d');
  lc.scale(SCALE, SCALE);
  const c = r * 1.3;
  lc.fillStyle = lin(lc, c - r, c - r, c + r, c + r, stops);
  lc.beginPath(); lc.arc(c, c, r, 0, Math.PI * 2); lc.fill();
  lc.globalCompositeOperation = 'destination-out';
  lc.beginPath(); lc.arc(c + r * bite * 1.2, c - r * bite * 0.5, r * 0.86, 0, Math.PI * 2); lc.fill();
  ctx.drawImage(layer, x - c, y - c, r * 2.6, r * 2.6);
}

// ---------- finishing ----------
/**
 * The calm area for the text: a soft darker oval over the left and middle of the picture, in the colour of the design (never
 * a flat black), so any name stays readable and the artwork sits on the right.
 */
function calm(ctx, color, { cx = 430, cy = 255, rx = 560, ry = 330, alpha = 0.34 } = {}) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
  ctx.fillStyle = rad(ctx, cx, cy, rx, [[0, rgba(color, alpha)], [0.25, rgba(color, alpha * 0.92)], [0.5, rgba(color, alpha * 0.66)], [0.75, rgba(color, alpha * 0.25)], [0.9, rgba(color, alpha * 0.06)], [1, rgba(color, 0)]]);
  ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
  ctx.restore();
}

/**
 * A band of the design's own dark colour along the top and the bottom edge, stronger on the left, where the title and the lines of a
 * centered card are drawn. It is what keeps the first and last line readable over a bright sky or ground.
 */
function edges(ctx, color, { top = 0.5, bottom = 0.62, topH = 120, bottomH = 220 } = {}) {
  const size = Math.round(W * SCALE);
  const layer = createCanvas(size, Math.round(H * SCALE));
  const lc = layer.getContext('2d');
  lc.scale(SCALE, SCALE);
  lc.fillStyle = lin(lc, 0, 0, 0, topH, [rgba(color, top), rgba(color, top * 0.7), rgba(color, 0)]); lc.fillRect(0, 0, W, topH);
  lc.fillStyle = lin(lc, 0, H - bottomH, 0, H, [rgba(color, 0), rgba(color, bottom * 0.7), rgba(color, bottom)]); lc.fillRect(0, H - bottomH, W, bottomH);
  lc.globalCompositeOperation = 'destination-in';
  lc.fillStyle = lin(lc, 0, 0, W, 0, [[0, 'rgba(0,0,0,1)'], [0.62, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,0.3)']]); lc.fillRect(0, 0, W, H);
  ctx.drawImage(layer, 0, 0, W, H);
}

function vignette(ctx, color = '#000000', alpha = 0.3) {
  ctx.save();
  ctx.fillStyle = rad(ctx, W / 2, H / 2, Math.hypot(W, H) / 2, [[0.45, rgba(color, 0)], [1, rgba(color, alpha)]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Fine film grain that keeps gradients from banding and gives the picture a printed feel. */
function grain(canvas, amount = 7, seed = 7) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const rand = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand.next() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

module.exports = {
  W, H, SCALE, rng, parse, toHex, mix, lighten, darken, rgba, hsl, luminance, contrast, lin, rad, start, sky, glow, smooth, rrect, ellipse, leafPath,
  crescent, star4, roundedPoly, heartPath, discs, bands, puff, ramp, gloss, groundShadow, withShadow, face, stars, ridges, cloud, dotGrid, bokeh, calm, edges, vignette, grain, Path2D,
};
