// Draws the pictures that go behind the default rank cards (src/assets/backgrounds): soft glows, silky waves and a few sparkles.
// It is deterministic, so running it again gives the same files. Run it with `node scripts/make-rank-backgrounds.js`.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, Path2D } = require('@napi-rs/canvas');

const WIDTH = 1024;
const HEIGHT = 320;

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

const rgba = (hex, alpha) => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

function paint(name, palette, seed) {
  const random = seeded(seed);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  base.addColorStop(0, palette.base[0]);
  base.addColorStop(1, palette.base[1]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Big soft glows that blend into each other.
  ctx.globalCompositeOperation = 'lighter';
  for (const glow of palette.glows) {
    const x = glow.x * WIDTH;
    const y = glow.y * HEIGHT;
    const radius = glow.r * WIDTH;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(glow.color, glow.alpha));
    gradient.addColorStop(0.45, rgba(glow.color, glow.alpha * 0.35));
    gradient.addColorStop(1, rgba(glow.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Silky waves: long curves filled with a thin gradient.
  ctx.globalCompositeOperation = 'screen';
  for (let wave = 0; wave < 3; wave += 1) {
    const top = HEIGHT * (0.18 + wave * 0.3);
    const lean = (random() - 0.5) * 140;
    const path2d = new Path2D();
    path2d.moveTo(-20, top + lean);
    path2d.bezierCurveTo(WIDTH * 0.25, top - 90 - lean, WIDTH * 0.6, top + 110 + lean, WIDTH + 20, top - lean * 0.6);
    path2d.lineTo(WIDTH + 20, top + 46);
    path2d.bezierCurveTo(WIDTH * 0.6, top + 150 + lean, WIDTH * 0.25, top - 40 - lean, -20, top + 52 + lean);
    path2d.closePath();
    const fill = ctx.createLinearGradient(0, top, WIDTH, top);
    fill.addColorStop(0, rgba(palette.waves[wave % palette.waves.length], 0));
    fill.addColorStop(0.35, rgba(palette.waves[wave % palette.waves.length], 0.11));
    fill.addColorStop(0.75, rgba(palette.waves[(wave + 1) % palette.waves.length], 0.09));
    fill.addColorStop(1, rgba(palette.waves[(wave + 1) % palette.waves.length], 0));
    ctx.fillStyle = fill;
    ctx.fill(path2d);
  }

  // Sparkles: small dots, and a few four-point stars.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 120; i += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const size = 0.5 + random() * 1.7;
    ctx.fillStyle = rgba(palette.sparkle, 0.12 + random() * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 9; i += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const arm = 7 + random() * 13;
    ctx.fillStyle = rgba(palette.sparkle, 0.55);
    ctx.beginPath();
    ctx.moveTo(x, y - arm); ctx.quadraticCurveTo(x, y, x + arm, y); ctx.quadraticCurveTo(x, y, x, y + arm);
    ctx.quadraticCurveTo(x, y, x - arm, y); ctx.quadraticCurveTo(x, y, x, y - arm);
    ctx.fill();
  }

  // A vignette so the edges are calm and the card reads well on top.
  ctx.globalCompositeOperation = 'source-over';
  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.45, WIDTH / 2, HEIGHT / 2, WIDTH * 0.62);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(8, 5, 14, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const out = path.join(__dirname, '../src/assets/backgrounds', `${name}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`${name}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

paint('rank-default', {
  base: ['#0f0a17', '#1a0e24'],
  glows: [
    { x: 0.08, y: 0.1, r: 0.5, color: '#ff8a5c', alpha: 0.85 },
    { x: 0.55, y: 1.05, r: 0.55, color: '#ff4f9a', alpha: 0.7 },
    { x: 0.97, y: 0.12, r: 0.5, color: '#7c4dff', alpha: 0.85 },
    { x: 0.36, y: 0.3, r: 0.22, color: '#ffd1a1', alpha: 0.2 },
  ],
  waves: ['#ffb199', '#ff7eb3', '#a88bff'],
  sparkle: '#ffe9d6',
}, 20261012);

paint('rank-voice', {
  base: ['#07101a', '#0b1a2c'],
  glows: [
    { x: 0.08, y: 0.12, r: 0.5, color: '#14d6b8', alpha: 0.85 },
    { x: 0.58, y: 1.05, r: 0.55, color: '#1aa7f0', alpha: 0.7 },
    { x: 0.97, y: 0.12, r: 0.5, color: '#5b5ff0', alpha: 0.85 },
    { x: 0.36, y: 0.3, r: 0.22, color: '#bffcf0', alpha: 0.18 },
  ],
  waves: ['#5eead4', '#7dd3fc', '#a5b4fc'],
  sparkle: '#e0fbff',
}, 20261013);
