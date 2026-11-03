// i18n-ignore-file: draws shapes only, there is no text in the picture
// The progress bar of /rank as a small flat picture, like the plain bar Petto always had: a slim rounded pill, a fill on a track, no gloss and no
// shadows. It has three themes with the same pill: normal (blue-grey on white, nothing else), Halloween (orange on deep purple, with flat Halloween
// shapes around it: a cobweb, a spider, bats, pumpkins and a ghost) and Christmas (candy-cane red on white, with a string of lights wrapped around it). The picture is 640x56 for every theme, so
// the space above and below the pill is there for the decoration and the layout never changes. It knows nothing about Discord: `utils/rankBar.js`
// picks the theme and caches the finished files.
const { createCanvas } = require('@napi-rs/canvas');

const WIDTH = 640;
const HEIGHT = 56;
const HEX = /^#[0-9a-f]{6}$/i;
const THEMES = ['normal', 'halloween', 'christmas'];

// Each theme: the track and the fill for messages and for voice.
const LOOK = {
  normal: { track: '#ffffff', outline: '#d5dbe3', fill: '#6485a7', voice: '#2fb5a3' },
  halloween: { track: '#2b1646', fill: '#ff8c1a', voice: '#8ad13f' },
  christmas: { track: '#f3f6fa', outline: '#cfd8e3', fill: '#d8283a', voice: '#1f9d55' },
};
const BAT = '#5b3591';
const SPIDER = '#7a52b8';
const WIRE = '#0b4a2a';
const BULBS = ['#ff4d5a', '#ffd23f', '#3ddc84', '#4db8ff'];

/** The fill color of a theme for messages or voice. */
function themeColor(theme, voice = false) {
  const look = LOOK[theme] ?? LOOK.normal;
  return voice ? look.voice : look.fill;
}

/** A flat bat with its wings open, `w` wide, centered on (cx, cy), tilted by `turn` radians. */
function bat(ctx, cx, cy, w, turn = 0) {
  const half = [[0, -0.34], [0.1, -0.56], [0.2, -0.32], [0.55, -0.5], [1, -0.62], [0.92, -0.08], [0.74, 0.02], [0.62, 0.28], [0.46, 0.02], [0.3, 0.3], [0.12, 0.08], [0, 0.42]];
  const points = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(turn); ctx.scale(w / 2, w / 2);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = BAT; ctx.fill();
  ctx.restore();
}

const NIGHT = '#1a0b2e';
/** A cobweb in the top-left corner: threads from the corner and two curved rows between them. */
function cobweb(ctx) {
  ctx.save();
  ctx.strokeStyle = '#a58fd8'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  const angles = [0.05, 0.4, 0.78, 1.15, 1.52];
  for (const a of angles) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 48, Math.sin(a) * 48); ctx.stroke(); }
  for (const r of [16, 30, 44]) {
    ctx.beginPath();
    angles.forEach((a, i) => { const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) ctx.quadraticCurveTo(Math.cos((angles[i - 1] + a) / 2) * r * 0.88, Math.sin((angles[i - 1] + a) / 2) * r * 0.88, x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
  ctx.restore();
}
/** A small spider on a thread: `top` is where the thread starts, the body hangs at (cx, cy). */
function spider(ctx, cx, top, cy) {
  ctx.save();
  ctx.strokeStyle = '#a58fd8'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.strokeStyle = SPIDER; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const side of [-1, 1]) for (const [dy, reach] of [[-4, 11], [-1, 13], [2, 13], [5, 10]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + side * reach * 0.6, cy + dy - 5); ctx.lineTo(cx + side * reach, cy + dy + 3); ctx.stroke();
  }
  ctx.fillStyle = SPIDER;
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - 6.5, 3.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(cx - 1.5, cy - 7, 0.9, 0, Math.PI * 2); ctx.arc(cx + 1.5, cy - 7, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
/** A flat jack-o'-lantern `w` wide whose bottom is at `bottom`: ribs, a stem, a carved face and a dark edge so it shows on the orange fill too. */
function pumpkin(ctx, cx, bottom, w) {
  const ry = w * 0.4, cy = bottom - ry;
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = NIGHT; ctx.lineJoin = 'round';
  ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.roundRect(cx - 2.2, cy - ry - 5, 4.4, 7, 1.5); ctx.fill();
  for (const [dx, rx] of [[-w * 0.24, w * 0.3], [w * 0.24, w * 0.3], [0, w * 0.32]]) { ctx.beginPath(); ctx.ellipse(cx + dx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = '#ff6a00'; ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = NIGHT; // two triangle eyes and a crooked mouth
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + side * w * 0.2, cy - ry * 0.55); ctx.lineTo(cx + side * w * 0.08, cy - ry * 0.05); ctx.lineTo(cx + side * w * 0.3, cy - ry * 0.05); ctx.closePath(); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(cx - w * 0.28, cy + ry * 0.2); ctx.lineTo(cx - w * 0.14, cy + ry * 0.6); ctx.lineTo(cx - w * 0.04, cy + ry * 0.3); ctx.lineTo(cx + w * 0.06, cy + ry * 0.6); ctx.lineTo(cx + w * 0.16, cy + ry * 0.3); ctx.lineTo(cx + w * 0.28, cy + ry * 0.2); ctx.lineTo(cx + w * 0.2, cy + ry * 0.8); ctx.lineTo(cx - w * 0.2, cy + ry * 0.8); ctx.closePath(); ctx.fill();
  ctx.restore();
}
/** A small ghost with a wavy hem, `w` wide, whose top is at `top`. */
function ghost(ctx, cx, top, w) {
  const h = w * 1.15, l = cx - w / 2, r = cx + w / 2, b = top + h;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(l, b); ctx.lineTo(l, top + w / 2); ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0); ctx.lineTo(r, b);
  const wave = w / 6;
  for (let i = 0; i < 3; i++) { ctx.quadraticCurveTo(r - wave * (2 * i + 0.5), b - wave * 1.6, r - wave * (2 * i + 1), b); ctx.quadraticCurveTo(r - wave * (2 * i + 1.5), b + wave * 0.4, r - wave * (2 * i + 2), b); }
  ctx.closePath();
  ctx.fillStyle = '#f4f0ff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = NIGHT; ctx.stroke();
  ctx.fillStyle = NIGHT; ctx.beginPath(); ctx.ellipse(cx - w * 0.2, top + w * 0.5, w * 0.08, w * 0.12, 0, 0, Math.PI * 2); ctx.ellipse(cx + w * 0.2, top + w * 0.5, w * 0.08, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, top + w * 0.75, w * 0.07, w * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
/** A small four-pointed sparkle. */
function sparkle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.quadraticCurveTo(cx, cy, cx + r, cy); ctx.quadraticCurveTo(cx, cy, cx, cy + r); ctx.quadraticCurveTo(cx, cy, cx - r, cy); ctx.quadraticCurveTo(cx, cy, cx, cy - r); ctx.fill();
}

/** Christmas lights: a wire that waves along the pill with a round bulb at each bend. The half waves that go "under" it are fainter. */
function wire(ctx, middle) {
  const amp = 16, step = 52;
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = WIRE;
  for (let k = 0; 26 + (k + 1) * step <= WIDTH; k++) {
    ctx.globalAlpha = k % 2 === 0 ? 1 : 0.4;
    const x0 = 26 + k * step;
    const sign = k % 2 === 0 ? 1 : -1; // from a bend below the pill to a bend above it, and back
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = x0 + (step * i) / 16;
      const y = middle + sign * amp * Math.cos((Math.PI * i) / 16);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function bulbs(ctx, middle) {
  const amp = 16, step = 52;
  for (let k = 0; 26 + k * step < WIDTH - 8; k++) {
    const x = 26 + k * step;
    const below = k % 2 === 0;
    const y = middle + (below ? amp + 4.5 : -amp - 4.5);
    const color = BULBS[k % BULBS.length];
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 12);
    glow.addColorStop(0, `${color}66`); glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WIRE; ctx.beginPath(); ctx.roundRect(x - 2.4, below ? y - 8 : y + 4, 4.8, 4.5, 1); ctx.fill(); // the little socket, toward the wire
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x - 1.6, y - 1.6, 1.5, 0, Math.PI * 2); ctx.fill();
  }
}

/** The bar as a canvas of 640x56 with a transparent background. `percent` is 0 to 100, `color` the fill as a `#rrggbb` hex. */
function drawProgressBar(percent, color, theme = 'normal') {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const look = LOOK[theme] ?? LOOK.normal;
  const fillColor = HEX.test(String(color)) ? color : look.fill;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  // Halloween leaves the right end of the picture to the bats, so the pill is a little shorter there.
  const h = 28, x = 2, w = WIDTH - 4, y = (HEIGHT - h) / 2, middle = HEIGHT / 2; // the pill: 28 px high, round at both ends

  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fillStyle = look.track; ctx.fill();
  if (look.outline) { ctx.lineWidth = 1.5; ctx.strokeStyle = look.outline; ctx.stroke(); } // a light track gets a thin edge so it shows on a light theme too
  if (pct > 0) {
    const fw = Math.max(h, Math.round(w * (pct / 100)));
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, fw, h, h / 2); ctx.clip();
    ctx.fillStyle = fillColor; ctx.fillRect(x, y, fw, h);
    if (theme === 'christmas') { // white diagonal stripes, like a candy cane
      ctx.fillStyle = '#ffffff';
      for (let sx = x - h; sx < x + fw + h; sx += 36) {
        ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.lineTo(sx + 14, y + h); ctx.lineTo(sx + 14 + h, y); ctx.lineTo(sx + h, y); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  if (theme === 'christmas') { wire(ctx, middle); bulbs(ctx, middle); }
  if (theme === 'halloween') { // flat shapes around the pill: a web, a spider, two bats, two pumpkins on its lower edge, a ghost and a few sparkles
    sparkle(ctx, 96, 46, 4.5, '#ffd23f'); sparkle(ctx, 300, 49, 3.5, '#ffffff'); sparkle(ctx, 452, 8, 4, '#ffd23f'); sparkle(ctx, 520, 47, 3, '#ffffff');
    bat(ctx, 150, 12, 38, -0.1); bat(ctx, 388, 13, 34, 0.12);
    spider(ctx, 262, 0, 12);
    pumpkin(ctx, 470, 55, 36); pumpkin(ctx, 556, 55, 28);
    ghost(ctx, 610, 0, 28);
    cobweb(ctx);
  }
  return canvas;
}

module.exports = { WIDTH, HEIGHT, HEX, THEMES, themeColor, drawProgressBar };
