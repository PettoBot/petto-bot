// i18n-ignore-file: draws shapes only, there is no text in the picture
// The progress bar of /rank as a small flat picture, like the plain bar Petto always had: a slim rounded pill, a fill on a track, no gloss and no
// shadows. It has three themes with the same pill: normal (blue-grey on white, nothing else), Halloween (orange on deep purple, with a few flat
// bats around it) and Christmas (candy-cane red on white, with a string of lights wrapped around it). The picture is 640x56 for every theme (Halloween's pill is shorter, to leave the right end to the bats), so
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
  const h = 28, x = 2, w = theme === 'halloween' ? 546 : WIDTH - 4, y = (HEIGHT - h) / 2, middle = HEIGHT / 2; // the pill: 28 px high, round at both ends

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
  if (theme === 'halloween') { // two bats at the right end and two flying just above the bar
    bat(ctx, 600, 32, 56, 0.1); bat(ctx, 566, 14, 30, -0.2); bat(ctx, 330, 12, 26, 0.12); bat(ctx, 120, 12, 22, -0.1);
  }
  return canvas;
}

module.exports = { WIDTH, HEIGHT, HEX, THEMES, themeColor, drawProgressBar };
