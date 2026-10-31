// The flower family: a deep, calm field for the text and a flower in bloom on the right.
const k = require('./kit');
const { Path2D } = k;
const { bigLeaf } = require('./fruits');

/** A pointed petal from the origin along -y, `len` long and `w` wide. */
function petal(len, w) {
  const p = new Path2D();
  p.moveTo(0, 0); p.bezierCurveTo(-w, -len * 0.25, -w * 0.85, -len * 0.8, 0, -len); p.bezierCurveTo(w * 0.85, -len * 0.8, w, -len * 0.25, 0, 0); p.closePath();
  return p;
}
/** A cherry blossom petal with a notch at its tip. */
function notched(len, w) {
  const p = new Path2D();
  p.moveTo(0, 0); p.bezierCurveTo(-w * 1.1, -len * 0.3, -w * 1.35, -len * 0.92, -w * 0.28, -len); p.lineTo(0, -len * 0.9); p.lineTo(w * 0.28, -len);
  p.bezierCurveTo(w * 1.35, -len * 0.92, w * 1.1, -len * 0.3, 0, 0); p.closePath();
  return p;
}

function blossom(ctx, x, y, size, rot, { tip = '#ffffff', base = '#ff9fc0', center = '#ffd24d' } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  for (let i = 0; i < 5; i += 1) {
    ctx.save(); ctx.rotate((i / 5) * Math.PI * 2);
    ctx.fillStyle = k.lin(ctx, 0, 0, 0, -size, [base, k.mix(base, tip, 0.7), tip]);
    ctx.fill(notched(size, size * 0.42));
    ctx.strokeStyle = k.rgba(base, 0.55); ctx.lineWidth = Math.max(0.8, size * 0.025); ctx.beginPath(); ctx.moveTo(0, -size * 0.1); ctx.lineTo(0, -size * 0.6); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = k.rad(ctx, 0, 0, size * 0.26, [[0, '#ff6f9c'], [1, base]]); ctx.beginPath(); ctx.arc(0, 0, size * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff5c8d'; ctx.lineWidth = Math.max(0.8, size * 0.03); ctx.fillStyle = center;
  for (let i = 0; i < 7; i += 1) { const a = (i / 7) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * size * 0.36, Math.sin(a) * size * 0.36); ctx.stroke(); ctx.beginPath(); ctx.arc(Math.cos(a) * size * 0.36, Math.sin(a) * size * 0.36, size * 0.04, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- sakura
function sakura(ctx, rand) {
  k.sky(ctx, [[0, '#2a1240'], [0.5, '#6a2a6a'], [1, '#d4608e']], 104);
  k.glow(ctx, 820, 150, 380, '#ffd0e4', 0.45, 'screen');
  ctx.fillStyle = k.rad(ctx, 760, 130, 90, [[0, '#fff7fb'], [1, '#ffd9ea']], 740, 110, 6); ctx.beginPath(); ctx.arc(760, 130, 86, 0, Math.PI * 2); ctx.fill();
  k.discs(ctx, rand, 10, ['#ffd0e4', '#ffb0d0'], { min: 20, max: 90, alpha: 0.07 });
  k.stars(ctx, rand, 30, { x1: 640, y1: 300, color: '#ffe6f0', sparkle: 0.3, alpha: 0.7 });
  k.calm(ctx, '#2a0f3a', { alpha: 0.46 });
  // The branch coming in from the right.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const branch = (pts, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i += 1) ctx.quadraticCurveTo(pts[i][0], pts[i][1], pts[i][2], pts[i][3]); ctx.stroke(); };
  k.withShadow(ctx, () => { branch([[1060, 380], [940, 330, 860, 360], [800, 390, 740, 330], [690, 280, 636, 296]], 22, '#3a2230'); }, { color: 'rgba(20,5,30,0.4)', blur: 14, y: 8 });
  branch([[1060, 380], [940, 330, 860, 360], [800, 390, 740, 330], [690, 280, 636, 296]], 22, '#4a2c3c');
  branch([[1060, 372], [940, 322, 860, 352]], 5, 'rgba(255,180,200,0.25)');
  branch([[860, 360], [880, 290, 920, 240]], 12, '#4a2c3c'); branch([[740, 330], [750, 250, 720, 196]], 10, '#4a2c3c'); branch([[930, 336], [980, 290, 1010, 250]], 10, '#4a2c3c');
  const buds = [[920, 240, 32, 0.3], [720, 196, 30, 1], [1010, 250, 26, 2], [860, 358, 40, 0.8], [770, 328, 34, 2.4], [650, 292, 28, 0.5], [944, 322, 30, 1.7], [700, 250, 22, 0.2], [820, 300, 26, 1.1], [980, 380, 30, 0.4], [900, 290, 24, 2.8], [780, 232, 22, 1.4], [1000, 170, 30, 0.9], [940, 180, 26, 1.9]];
  for (const [x, y, s, r] of buds) { k.withShadow(ctx, () => blossom(ctx, x, y, s, r), { color: 'rgba(40,5,40,0.25)', blur: 6, y: 3 }); }
  // Falling petals.
  for (let i = 0; i < 40; i += 1) { ctx.save(); ctx.translate(rand.range(40, 1000), rand.range(10, 490)); ctx.rotate(rand.range(0, 6.28)); ctx.globalAlpha = rand.range(0.35, 0.9); const s = rand.range(7, 14); ctx.fillStyle = rand.pick(['#ffd0e4', '#ffffff', '#ffb0d0']); ctx.fill(notched(s, s * 0.45)); ctx.restore(); }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- rose
function rose(ctx, rand) {
  k.sky(ctx, [[0, '#150a2a'], [0.5, '#3b1240'], [1, '#8a2252']], 106);
  k.glow(ctx, 860, 250, 360, '#ff9ab8', 0.4, 'screen');
  k.discs(ctx, rand, 12, ['#ffb0c8', '#e8a0ff'], { min: 20, max: 90, alpha: 0.07 });
  k.dotGrid(ctx, { step: 32, r: 1.8, color: '#ffd0e0', alpha: 0.06 });
  k.stars(ctx, rand, 30, { x0: 30, x1: 760, color: '#ffe0ec', sparkle: 0.35, alpha: 0.7 });
  k.calm(ctx, '#12071f', { alpha: 0.5 });
  ctx.save(); ctx.translate(864, 236);
  // The stem and leaves.
  ctx.strokeStyle = '#2f8a4c'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 90); ctx.bezierCurveTo(-10, 170, 16, 230, 6, 290); ctx.stroke();
  bigLeaf(ctx, 0, 190, -96, 150, 30, '#7ad070', '#1f7a44'); bigLeaf(ctx, 6, 222, 96, 186, 30, '#8fe07a', '#23894c');
  ctx.fillStyle = '#2f8a4c'; for (const [x, y] of [[-3, 150], [10, 252]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y - 6); ctx.lineTo(x, y - 14); ctx.fill(); }
  const rings = [{ r: 86, n: 7, len: 78, w: 46, c: '#b3123f' }, { r: 62, n: 6, len: 68, w: 42, c: '#cf1a4d' }, { r: 40, n: 5, len: 56, w: 36, c: '#e52a5e' }, { r: 20, n: 4, len: 42, w: 30, c: '#f24a78' }];
  // Green sepals underneath.
  for (let i = 0; i < 5; i += 1) { ctx.save(); ctx.rotate((i / 5) * Math.PI * 2 + 0.3); bigLeaf(ctx, 0, 0, 0, 108, 16, '#58b45c', '#1f6a3c'); ctx.restore(); }
  k.withShadow(ctx, () => { ctx.fillStyle = '#b3123f'; ctx.beginPath(); ctx.arc(0, 0, 98, 0, Math.PI * 2); ctx.fill(); }, { color: 'rgba(15,0,25,0.5)', blur: 22, y: 12 });
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i += 1) {
      ctx.save(); ctx.rotate((i / ring.n) * Math.PI * 2 + ri * 0.55); ctx.translate(0, -ring.r * 0.35);
      const path = new Path2D(); path.ellipse(0, -ring.len * 0.3, ring.w, ring.len * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = k.rad(ctx, 0, -ring.len * 0.5, ring.len * 0.8, [[0, k.lighten(ring.c, 0.28)], [0.6, ring.c], [1, k.darken(ring.c, 0.35)]], -ring.w * 0.2, -ring.len * 0.8, 4);
      ctx.fill(path);
      ctx.strokeStyle = k.rgba(k.darken(ring.c, 0.4), 0.45); ctx.lineWidth = 2; ctx.stroke(path);
      ctx.restore();
    }
  });
  // The curl at the heart.
  ctx.strokeStyle = 'rgba(120,0,40,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); for (let a = 0; a < 9; a += 0.2) { const r = 2 + a * 2.1; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.9 - 4); } ctx.stroke();
  k.gloss(ctx, -44, -52, 14, 30, 0.7, 0.28);
  ctx.restore();
  for (let i = 0; i < 14; i += 1) { ctx.save(); ctx.translate(rand.range(560, 1000), rand.range(20, 480)); ctx.rotate(rand.range(0, 6.28)); ctx.globalAlpha = rand.range(0.3, 0.75); ctx.fillStyle = rand.pick(['#ff7a9c', '#d81b60', '#ffb0c4']); ctx.beginPath(); ctx.ellipse(0, 0, 6, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- lavender
function lavender(ctx, rand) {
  k.sky(ctx, [[0, '#1b1440'], [0.5, '#46338a'], [1, '#9a78c8']], 106);
  k.glow(ctx, 850, 170, 360, '#ffe0f2', 0.36, 'screen');
  ctx.fillStyle = k.rad(ctx, 880, 120, 70, [[0, '#fffafd'], [1, '#f0dcff']], 862, 104, 6); ctx.beginPath(); ctx.arc(880, 120, 68, 0, Math.PI * 2); ctx.fill();
  k.stars(ctx, rand, 40, { x1: 700, y1: 300, color: '#f4eaff', sparkle: 0.3, alpha: 0.8 });
  k.discs(ctx, rand, 10, ['#e0c8ff', '#f4b8ff'], { min: 20, max: 90, alpha: 0.07 });
  k.ridges(ctx, [{ y: 380, amp: 20, freq: 0.006, color: '#2e2266', seed: 3, alpha: 0.9 }]);
  k.calm(ctx, '#140d38', { alpha: 0.48 });
  // Fireflies.
  for (let i = 0; i < 18; i += 1) k.glow(ctx, rand.range(30, 1000), rand.range(160, 440), rand.range(7, 13), '#f4ffb0', 0.85, 'screen');
  // Stems with spikes of tiny flowers.
  const spike = (x, y, lean, h, c1, c2) => {
    ctx.strokeStyle = '#5aa06a'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.4, y - h * 0.5, x + lean, y - h); ctx.stroke();
    const top = [x + lean, y - h]; const n = 17;
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1); const px = x + lean * (0.55 + 0.45 * t) + Math.sin(i * 1.7) * 3; const py = y - h * (0.5 + 0.5 * t) + (1 - t) * 0;
      void px; void py; void top;
    }
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      // Position along the stem curve (quadratic bezier), buds on both sides.
      const u = 0.45 + t * 0.55; const bx = (1 - u) * (1 - u) * x + 2 * (1 - u) * u * (x + lean * 0.4) + u * u * (x + lean); const by = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * (y - h * 0.5) + u * u * (y - h);
      const size = 11 - t * 5;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(bx + side * size * 0.55, by); ctx.rotate(side * 0.5 + lean * 0.004);
        ctx.fillStyle = k.lin(ctx, 0, -size, 0, size, [c1, c2]); ctx.beginPath(); ctx.ellipse(0, 0, size * 0.5, size, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(-size * 0.15, -size * 0.3, size * 0.14, size * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  };
  ctx.save(); ctx.translate(0, 0);
  for (const [x, lean, h, c1, c2] of [[740, -30, 250, '#c9a8ff', '#8a5ad8'], [800, 24, 300, '#d6b8ff', '#9a68e8'], [860, -14, 330, '#e0c8ff', '#a678f0'], [926, 32, 290, '#c9a8ff', '#8a5ad8'], [984, -26, 240, '#d6b8ff', '#9a68e8'], [1030, 12, 280, '#c0a0f8', '#7a50d0']]) spike(x, 500, lean, h, c1, c2);
  ctx.restore();
  // Foreground leaves.
  for (const [x, a] of [[760, -0.3], [840, 0.1], [920, 0.4], [990, -0.2]]) { ctx.save(); ctx.translate(x, 500); ctx.rotate(a); ctx.fillStyle = k.lin(ctx, 0, 0, 0, -120, ['#2c6a4a', '#5aa06a']); ctx.fill(k.leafPath(0, 0, 0, -120, 10)); ctx.restore(); }
  for (let i = 0; i < 8; i += 1) { ctx.save(); ctx.translate(rand.range(660, 1000), rand.range(60, 300)); ctx.rotate(rand.range(0, 6.28)); ctx.globalAlpha = 0.7; ctx.fillStyle = '#e8d6ff'; ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- sunflower
function sunflower(ctx, rand) {
  k.sky(ctx, [[0, '#071e44'], [0.5, '#12508c'], [1, '#2f86c0']], 106);
  k.glow(ctx, 860, 240, 380, '#ffe27a', 0.45, 'screen');
  k.cloud(ctx, 220, 110, 200, '#ffffff', 0.08); k.cloud(ctx, 520, 70, 150, '#ffffff', 0.07); k.cloud(ctx, 640, 380, 220, '#ffffff', 0.07);
  k.discs(ctx, rand, 10, ['#cfe8ff', '#ffe9a0'], { min: 18, max: 80, alpha: 0.07 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#f0f8ff', sparkle: 0.3, alpha: 0.6 });
  k.calm(ctx, '#061a3a', { alpha: 0.48 });
  ctx.save(); ctx.translate(866, 250);
  ctx.strokeStyle = '#3f9a4c'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 90); ctx.bezierCurveTo(-6, 170, 12, 230, 0, 300); ctx.stroke();
  bigLeaf(ctx, 0, 200, -108, 172, 34, '#86dc6a', '#2a8a44'); bigLeaf(ctx, 4, 236, 104, 206, 32, '#9be87a', '#2f9a4c');
  const drawPetals = (n, len, w, rot, c1, c2) => { for (let i = 0; i < n; i += 1) { ctx.save(); ctx.rotate((i / n) * Math.PI * 2 + rot); ctx.fillStyle = k.lin(ctx, 0, -40, 0, -len, [c1, c2]); ctx.fill(petal(len, w)); ctx.strokeStyle = 'rgba(190,110,0,0.4)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, -len * 0.78); ctx.stroke(); ctx.restore(); } };
  k.withShadow(ctx, () => { ctx.fillStyle = '#f0a800'; ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.fill(); }, { color: 'rgba(0,15,40,0.5)', blur: 22, y: 12 });
  drawPetals(16, 128, 22, 0.1, '#e89a00', '#ffc42a');
  drawPetals(16, 118, 24, 0.1 + Math.PI / 16, '#ffb41a', '#ffe25a');
  const disc = k.ellipse(0, 0, 66, 66); k.puff(ctx, disc, 0, 0, 74, '#7a4418', { light: 0.28, dark: 0.45 });
  ctx.save(); ctx.clip(disc); ctx.fillStyle = 'rgba(255,200,120,0.28)';
  for (let i = 1; i < 120; i += 1) { const a = i * 2.39996; const r = Math.sqrt(i) * 6.1; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.8 + r * 0.012, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  k.face(ctx, 0, 6, 38, { eye: '#1f0c00', blush: '#ff9a5a', mouth: 'smile', blushAlpha: 0.5 });
  ctx.restore();
  // A little bee.
  ctx.save(); ctx.translate(716, 150); ctx.rotate(-0.3);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-4, -12, 9, 14, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(8, -12, 9, 14, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(-4, -12, 5, 24); ctx.fillRect(6, -11, 5, 22);
  ctx.beginPath(); ctx.arc(-16, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-18, -2, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- daisy
function daisy(ctx, rand) {
  k.sky(ctx, [[0, '#0c2d1c'], [0.5, '#1d6038'], [1, '#4aa05a']], 106);
  k.glow(ctx, 850, 220, 360, '#f4ffd0', 0.42, 'screen');
  k.discs(ctx, rand, 12, ['#e8ffd0', '#c8f0b0'], { min: 18, max: 90, alpha: 0.07 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#f4ffe8', sparkle: 0.3, alpha: 0.6 });
  // Grass at the bottom.
  ctx.strokeStyle = 'rgba(20,70,36,0.7)'; ctx.lineCap = 'round'; for (let i = 0; i < 90; i += 1) { const x = rand.range(0, 1024); ctx.lineWidth = rand.range(2, 4.5); ctx.beginPath(); ctx.moveTo(x, 505); ctx.quadraticCurveTo(x + rand.range(-14, 14), 470, x + rand.range(-26, 26), 505 - rand.range(30, 80)); ctx.stroke(); }
  k.calm(ctx, '#082416', { alpha: 0.5 });
  const flower = (x, y, s, rot, face) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    k.withShadow(ctx, () => { ctx.fillStyle = '#e8eef0'; ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.fill(); }, { color: 'rgba(0,20,10,0.4)', blur: 16, y: 8 });
    for (let ring = 0; ring < 2; ring += 1) for (let i = 0; i < 14; i += 1) { ctx.save(); ctx.rotate((i / 14) * Math.PI * 2 + ring * Math.PI / 14); const len = ring ? 104 : 112; ctx.fillStyle = k.lin(ctx, 0, -30, 0, -len, ['#dfe9f2', '#ffffff']); ctx.fill(petal(len, 17)); ctx.strokeStyle = 'rgba(150,180,200,0.35)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -len * 0.7); ctx.stroke(); ctx.restore(); }
    const center = k.ellipse(0, 0, 40, 40); k.puff(ctx, center, 0, 0, 44, '#ffcb2b', { light: 0.35, dark: 0.32 });
    if (face) k.face(ctx, 0, 4, 30, { eye: '#4a2e00', blush: '#ff9a6a', mouth: 'smile', blushAlpha: 0.5 }); else { ctx.fillStyle = 'rgba(190,120,0,0.4)'; for (let i = 0; i < 14; i += 1) { const a = i * 2.4; const r = Math.sqrt(i) * 8; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };
  ctx.save(); ctx.strokeStyle = '#2f8a44'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(866, 330); ctx.bezierCurveTo(860, 400, 870, 450, 862, 510); ctx.stroke(); ctx.beginPath(); ctx.moveTo(760, 392); ctx.bezierCurveTo(764, 440, 750, 480, 758, 510); ctx.stroke(); ctx.beginPath(); ctx.moveTo(970, 150); ctx.bezierCurveTo(960, 300, 990, 420, 980, 510); ctx.stroke();
  bigLeaf(ctx, 862, 440, 780, 410, 20, '#86dc6a', '#2a8a44'); bigLeaf(ctx, 866, 470, 944, 440, 20, '#86dc6a', '#2a8a44');
  ctx.restore();
  flower(976, 152, 0.5, 0.3, false); flower(756, 388, 0.44, 0.1, false); flower(868, 250, 1, 0.05, true);
  // Butterfly.
  ctx.save(); ctx.translate(712, 150); ctx.rotate(-0.3); for (const side of [-1, 1]) { ctx.fillStyle = side < 0 ? '#ffb0d0' : '#ff8fc0'; ctx.beginPath(); ctx.ellipse(side * 12, -6, 12, 18, side * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffd0e4'; ctx.beginPath(); ctx.ellipse(side * 9, 12, 8, 11, side * -0.4, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#4a2a3a'; ctx.fillRect(-1.6, -14, 3.2, 28); ctx.restore();
}

// ---------------------------------------------------------------- tulip
function tulip(ctx, rand) {
  k.sky(ctx, [[0, '#06303c'], [0.5, '#0e6670'], [1, '#2da08e']], 106);
  k.glow(ctx, 850, 220, 360, '#fff0d0', 0.4, 'screen');
  k.discs(ctx, rand, 12, ['#d0fff0', '#ffe8d0'], { min: 18, max: 90, alpha: 0.07 });
  k.dotGrid(ctx, { step: 32, r: 1.8, color: '#e0fff6', alpha: 0.06 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#f0fffa', sparkle: 0.3, alpha: 0.6 });
  k.calm(ctx, '#04242c', { alpha: 0.5 });
  const cup = (x, y, s, c1, c2, withFace) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const cupPath = new Path2D();
    cupPath.moveTo(0, 34); cupPath.bezierCurveTo(-62, 30, -70, -38, -48, -96); cupPath.quadraticCurveTo(-32, -70, -22, -62); cupPath.quadraticCurveTo(-14, -94, 0, -122);
    cupPath.quadraticCurveTo(14, -94, 22, -62); cupPath.quadraticCurveTo(32, -70, 48, -96); cupPath.bezierCurveTo(70, -38, 62, 30, 0, 34); cupPath.closePath();
    const back = new Path2D(); back.moveTo(0, 20); back.bezierCurveTo(-34, 0, -30, -80, 0, -122); back.bezierCurveTo(30, -80, 34, 0, 0, 20);
    const frontL = new Path2D(); frontL.moveTo(2, 34); frontL.bezierCurveTo(-60, 30, -70, -38, -48, -96); frontL.quadraticCurveTo(-30, -70, -20, -62); frontL.bezierCurveTo(-30, -30, -26, 6, 2, 34);
    const frontR = new Path2D(); frontR.moveTo(-2, 34); frontR.bezierCurveTo(60, 30, 70, -38, 48, -96); frontR.quadraticCurveTo(30, -70, 20, -62); frontR.bezierCurveTo(30, -30, 26, 6, -2, 34);
    k.withShadow(ctx, () => { ctx.fillStyle = c2; ctx.fill(cupPath); }, { color: 'rgba(0,25,30,0.4)', blur: 14, y: 8 });
    ctx.fillStyle = k.lin(ctx, 0, -122, 0, 34, [k.lighten(c1, 0.1), c2]); ctx.fill(cupPath);
    ctx.fillStyle = k.lin(ctx, 0, -122, 0, 20, [k.darken(c2, 0.05), k.darken(c2, 0.28)]); ctx.fill(back);
    ctx.fillStyle = k.lin(ctx, -60, -90, 10, 34, [k.lighten(c1, 0.18), c1, c2]); ctx.fill(frontL);
    ctx.fillStyle = k.lin(ctx, 60, -90, -10, 34, [c1, c2, k.darken(c2, 0.2)]); ctx.fill(frontR);
    ctx.strokeStyle = k.rgba(k.darken(c2, 0.35), 0.4); ctx.lineWidth = 2; ctx.stroke(frontL); ctx.stroke(frontR);
    k.gloss(ctx, -44, -40, 7, 24, 0.12, 0.45);
    if (withFace) k.face(ctx, 0, -18, 32, { eye: '#3a0a24', blush: '#ffd0e0', mouth: 'smile', gap: 0.74, blushAlpha: 0.5 });
    ctx.restore();
  };
  ctx.save();
  ctx.strokeStyle = '#2f9a4c'; ctx.lineWidth = 11; ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2] of [[868, 310, 862, 520], [760, 360, 770, 520], [980, 340, 970, 520]]) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 + 6, (y1 + y2) / 2, x2, y2); ctx.stroke(); }
  bigLeaf(ctx, 864, 520, 770, 330, 40, '#6ed07a', '#1f7a44'); bigLeaf(ctx, 866, 520, 972, 340, 38, '#7edc84', '#23894c'); bigLeaf(ctx, 770, 520, 700, 420, 26, '#6ed07a', '#1f7a44');
  ctx.restore();
  cup(760, 366, 0.64, '#ffd36a', '#ffa21a', false); cup(978, 350, 0.64, '#ff9ec4', '#e84a8a', false); cup(868, 322, 1, '#ff7aa6', '#d8265f', true);
  for (const [x, y, s] of [[714, 130, 10], [996, 130, 8], [706, 430, 8]]) { ctx.fillStyle = 'rgba(255,230,240,0.85)'; ctx.fill(k.heartPath(x, y, s)); }
}

// ---------------------------------------------------------------- lotus
function lotus(ctx, rand) {
  k.sky(ctx, [[0, '#17143c'], [0.5, '#3d2a78'], [1, '#c4609a']], 106);
  k.glow(ctx, 850, 200, 360, '#ffd0ec', 0.42, 'screen');
  k.stars(ctx, rand, 40, { x1: 720, y1: 280, color: '#ffeaf6', sparkle: 0.3, alpha: 0.75 });
  k.discs(ctx, rand, 10, ['#ffc0e6', '#d0b0ff'], { min: 18, max: 80, alpha: 0.07 });
  // Water.
  ctx.fillStyle = k.lin(ctx, 0, 390, 0, 500, ['rgba(40,20,90,0.2)', 'rgba(20,10,60,0.7)']); ctx.fillRect(0, 390, 1024, 110);
  k.calm(ctx, '#140d34', { alpha: 0.48 });
  ctx.strokeStyle = 'rgba(255,220,240,0.35)'; ctx.lineWidth = 2; for (let i = 0; i < 5; i += 1) { ctx.globalAlpha = 0.5 - i * 0.08; ctx.beginPath(); ctx.ellipse(866, 420, 120 + i * 46, 18 + i * 6, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  for (const [x, y, r] of [[700, 450, 52], [1000, 456, 56], [780, 480, 36], [610, 470, 40]]) { ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.28); ctx.fillStyle = k.lin(ctx, 0, -r, 0, r, ['#4ac28a', '#1c7a5a']); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, 0.2, Math.PI * 2 - 0.2); ctx.closePath(); ctx.fill(); ctx.restore(); }
  for (let i = 0; i < 20; i += 1) k.glow(ctx, rand.range(40, 1000), rand.range(120, 420), rand.range(6, 12), '#fff0b0', 0.8, 'screen');
  ctx.save(); ctx.translate(866, 372);
  k.groundShadow(ctx, 0, 40, 120, 12, 0.3, '#080428');
  const layer = (n, len, w, rot, c1, c2, y) => { for (let i = 0; i < n; i += 1) { ctx.save(); ctx.translate(0, y); ctx.rotate(((i - (n - 1) / 2) / (n - 1)) * (n > 3 ? 2.5 : 1.7) + rot); ctx.fillStyle = k.lin(ctx, 0, 0, 0, -len, [c2, c1]); ctx.fill(petal(len, w)); ctx.strokeStyle = k.rgba(k.darken(c2, 0.3), 0.4); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -len * 0.72); ctx.stroke(); ctx.restore(); } };
  k.withShadow(ctx, () => layer(9, 150, 38, 0, '#ffb0d4', '#e0508f', 0), { color: 'rgba(10,0,40,0.4)', blur: 18, y: 10 });
  layer(9, 150, 38, 0, '#ffb8d8', '#e0508f', 0);
  layer(7, 128, 36, 0, '#ffc6e0', '#ee6aa4', -4);
  layer(5, 104, 34, 0, '#ffd6e8', '#f68ab8', -8);
  layer(3, 80, 30, 0, '#ffe8f2', '#ffa8cc', -10);
  k.face(ctx, 0, -42, 34, { eye: '#4a1030', blush: '#ff8ab4', mouth: 'smile', blushAlpha: 0.5 });
  ctx.restore();
}

module.exports = [
  { id: 'flower-sakura', family: 'flowers', color: '#6a2a6a', textColor: '#ffffff', accent: '#ffd0e4', seed: 41, paint: sakura },
  { id: 'flower-rose', family: 'flowers', color: '#3b1240', textColor: '#ffffff', accent: '#ffb0c8', seed: 42, paint: rose },
  { id: 'flower-lavender', family: 'flowers', color: '#46338a', textColor: '#ffffff', accent: '#e6d4ff', seed: 43, paint: lavender },
  { id: 'flower-sunflower', family: 'flowers', color: '#12508c', textColor: '#ffffff', accent: '#ffe27a', seed: 44, paint: sunflower },
  { id: 'flower-daisy', family: 'flowers', color: '#1d6038', textColor: '#ffffff', accent: '#f4ffc8', seed: 45, paint: daisy },
  { id: 'flower-tulip', family: 'flowers', color: '#0e6670', textColor: '#ffffff', accent: '#ffc2d6', seed: 46, paint: tulip },
  { id: 'flower-lotus', family: 'flowers', color: '#3d2a78', textColor: '#ffffff', accent: '#ffc6e0', seed: 47, paint: lotus },
];
