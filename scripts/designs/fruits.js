// The fruit family: a deep, juicy field with one big kawaii fruit on the right, leaves and seeds around it.
const k = require('./kit');

/** A spade-shaped leaf with a vein, from (x, y) toward a tip. */
function bigLeaf(ctx, x, y, tipX, tipY, w, c1, c2) {
  const path = k.leafPath(x, y, tipX, tipY, w);
  ctx.fillStyle = k.lin(ctx, x, y, tipX, tipY, [c1, c2]);
  ctx.fill(path);
  ctx.strokeStyle = k.rgba(k.lighten(c1, 0.35), 0.5); ctx.lineWidth = Math.max(1, w * 0.06); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (tipX - x) * 0.85, y + (tipY - y) * 0.85); ctx.stroke();
}

/** The leafy cap of a strawberry, centered at (x, y), `s` is its half width. */
function calyx(ctx, x, y, s, { dark = '#23804a', light = '#86df7a' } = {}) {
  const leaves = [[-1.0, 0.22, 0.34], [-0.62, 0.52, 0.34], [0.62, 0.52, 0.34], [1.0, 0.22, 0.34], [0, 0.62, 0.3]];
  for (const [dx, dy, w] of leaves) bigLeaf(ctx, x, y - s * 0.05, x + dx * s, y + dy * s, s * w, light, dark);
  for (const [dx, dy, w] of [[-0.34, 0.3, 0.28], [0.34, 0.3, 0.28]]) bigLeaf(ctx, x, y - s * 0.08, x + dx * s, y + dy * s + s * 0.12, s * w, k.lighten(light, 0.1), k.darken(dark, 0.1));
  ctx.fillStyle = k.lin(ctx, x, y - s * 0.3, x, y + s * 0.1, [light, dark]);
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.02, s * 0.2, s * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = k.darken(dark, 0.12); ctx.lineWidth = s * 0.13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y - s * 0.05); ctx.quadraticCurveTo(x + s * 0.04, y - s * 0.4, x + s * 0.22, y - s * 0.52); ctx.stroke();
}

/** A strawberry at (0, 0), `s` is 1 for the big one. */
function berryShape() {
  return k.smooth([[0, -92], [-68, -112], [-124, -72], [-134, -8], [-112, 56], [-62, 112], [0, 144], [62, 112], [112, 56], [134, -8], [124, -72], [68, -112]]);
}
function berry(ctx, rand, { face = true, base = '#ff3d66', seedColor = ['#fff2b8', '#ffc766'] } = {}) {
  const body = berryShape();
  k.withShadow(ctx, () => { ctx.fillStyle = k.darken(base, 0.2); ctx.fill(body); }, { color: 'rgba(40,0,15,0.4)', blur: 20, y: 10 });
  k.puff(ctx, body, 0, 0, 150, base, { light: 0.3, dark: 0.42 });
  ctx.save(); ctx.clip(body);
  let row = 0;
  for (let y = -80; y < 150; y += 29, row += 1) {
    for (let x = -130 + (row % 2) * 17; x < 140; x += 34) {
      ctx.save(); ctx.translate(x + rand.range(-1.2, 1.2), y); ctx.rotate(x / 380);
      ctx.fillStyle = 'rgba(110,0,30,0.32)'; ctx.beginPath(); ctx.ellipse(1.6, 2.6, 4.2, 6.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = k.lin(ctx, 0, -7, 0, 7, seedColor); ctx.beginPath(); ctx.ellipse(0, 0, 4, 6.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  k.gloss(ctx, -70, -46, 16, 38, 0.5, 0.45); k.gloss(ctx, -48, -86, 6, 6, 0, 0.7);
  if (face) k.face(ctx, 0, 20, 44, { eye: '#3a0a1c', blush: '#ffb6c8', mouth: 'smile' });
  calyx(ctx, 0, -98, 84);
}

function strawberry(ctx, rand) {
  k.sky(ctx, [[0, '#3a0920'], [0.5, '#7d1340'], [1, '#c7305f']], 100);
  k.glow(ctx, 860, 260, 360, '#ff9db8', 0.5, 'screen');
  k.discs(ctx, rand, 14, ['#ff9db8', '#ffc2d1', '#ff6f91'], { min: 30, max: 120, alpha: 0.12, rim: 0.14 });
  k.dotGrid(ctx, { step: 30, r: 2, color: '#ffd6e0', alpha: 0.09 });
  k.bands(ctx, rand, 5, '#ffc2d1', { alpha: 0.06 });
  k.calm(ctx, '#3a0920', { alpha: 0.5 });
  k.stars(ctx, rand, 20, { x0: 30, x1: 780, color: '#ffe3ea', sparkle: 0.3, alpha: 0.65 });

  // Two small berries tumbling behind the big one.
  ctx.save(); ctx.translate(712, 372); ctx.rotate(-0.5); ctx.scale(0.3, 0.3); berry(ctx, rand, { face: false, base: '#ff5a7d' }); ctx.restore();
  ctx.save(); ctx.translate(985, 108); ctx.rotate(0.55); ctx.scale(0.26, 0.26); berry(ctx, rand, { face: false, base: '#ff7a96' }); ctx.restore();
  ctx.save(); ctx.translate(858, 268); ctx.rotate(0.1);
  k.groundShadow(ctx, 6, 158, 120, 20, 0.3, '#220512');
  berry(ctx, rand);
  ctx.restore();

  ctx.save(); ctx.translate(716, 118);
  for (let i = 0; i < 5; i += 1) { ctx.rotate(Math.PI * 2 / 5); ctx.fillStyle = k.lin(ctx, 0, 0, 0, -26, ['#ffe9ef', '#ffffff']); ctx.beginPath(); ctx.ellipse(0, -15, 10, 15, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (const [x, y, s, a] of [[982, 330, 13, 0.9], [940, 440, 10, 0.8], [770, 60, 9, 0.7], [1000, 210, 8, 0.7]]) { ctx.fillStyle = k.rgba('#ffc2d1', a); ctx.fill(k.heartPath(x, y, s)); }
}


// ---------------------------------------------------------------- peach
function peach(ctx, rand) {
  k.sky(ctx, [[0, '#3d1226'], [0.5, '#7e2a40'], [1, '#d4676a']], 104);
  k.glow(ctx, 860, 250, 360, '#ffc9a8', 0.5, 'screen');
  k.discs(ctx, rand, 14, ['#ffd6bf', '#ffb59a', '#ffe8d6'], { min: 26, max: 110, alpha: 0.1 });
  k.dotGrid(ctx, { step: 30, r: 2, color: '#ffe3d2', alpha: 0.08 });
  k.bands(ctx, rand, 5, '#ffd6bf', { alpha: 0.06 });
  k.calm(ctx, '#3d1226', { alpha: 0.5 });
  // Blossoms and leaves in the air.
  for (let i = 0; i < 16; i += 1) { ctx.save(); ctx.translate(rand.range(560, 1000), rand.range(20, 480)); ctx.rotate(rand.range(0, 6.28)); ctx.globalAlpha = rand.range(0.3, 0.7); ctx.fillStyle = rand.pick(['#ffd6e4', '#ffffff', '#ffb8cf']); ctx.beginPath(); ctx.ellipse(0, 0, 7, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(866, 266); ctx.rotate(-0.08);
  k.groundShadow(ctx, 6, 140, 124, 18, 0.32, '#2a0a18');
  const body = k.smooth([[0, -92], [-64, -102], [-114, -54], [-124, 10], [-98, 76], [-44, 114], [0, 120], [44, 114], [98, 76], [124, 10], [114, -54], [64, -102]]);
  k.withShadow(ctx, () => { ctx.fillStyle = '#e86a74'; ctx.fill(body); }, { color: 'rgba(60,10,25,0.4)', blur: 22, y: 12 });
  k.ramp(ctx, body, -90, -100, 100, 120, ['#ffe2b8', '#ffb08f', '#f26a7c']);
  ctx.save(); ctx.clip(body);
  ctx.fillStyle = k.rad(ctx, 70, 30, 120, [[0, 'rgba(255,90,120,0.55)'], [1, 'rgba(255,90,120,0)']]); ctx.fillRect(-140, -140, 280, 280);
  ctx.strokeStyle = 'rgba(190,60,80,0.45)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(4, -96); ctx.bezierCurveTo(34, -40, 26, 40, -4, 114); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,225,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, -92); ctx.bezierCurveTo(22, -40, 14, 40, -14, 112); ctx.stroke();
  ctx.restore();
  k.gloss(ctx, -70, -48, 16, 34, 0.5, 0.45); k.gloss(ctx, -48, -80, 6, 6, 0, 0.7);
  k.face(ctx, -6, 24, 46, { eye: '#4a1424', blush: '#ff7d92', mouth: 'smile', blushAlpha: 0.55 });
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(2, -92); ctx.quadraticCurveTo(0, -112, 10, -124); ctx.stroke();
  bigLeaf(ctx, 6, -108, 108, -150, 30, '#a6ec7c', '#2f9a52'); bigLeaf(ctx, 4, -106, -74, -138, 26, '#8fe27a', '#2a8a4c');
  ctx.restore();
  for (const [x, y, s, a] of [[712, 130, 12, 0.85], [992, 380, 10, 0.8], [770, 436, 9, 0.7]]) { ctx.fillStyle = k.rgba('#ffd0dc', a); ctx.fill(k.heartPath(x, y, s)); }
}

// ---------------------------------------------------------------- lemon
function lemon(ctx, rand) {
  k.sky(ctx, [[0, '#142a0c'], [0.5, '#2f5a16'], [1, '#6a9a1c']], 104);
  k.glow(ctx, 860, 250, 360, '#fff29a', 0.5, 'screen');
  for (const [x, y, tx, ty, w] of [[1010, 520, 760, 380, 60], [1040, 440, 900, 90, 54], [630, 520, 700, 330, 40], [980, 20, 840, 200, 44]]) k.ramp(ctx, k.leafPath(x, y, tx, ty, w), x, y, tx, ty, [k.rgba('#8fd24a', 0.28), k.rgba('#2f6a1c', 0.3)]);
  k.discs(ctx, rand, 12, ['#fff6a8', '#e8f77a'], { min: 20, max: 90, alpha: 0.08 });
  k.dotGrid(ctx, { step: 28, r: 1.8, color: '#fffbd0', alpha: 0.07 });
  k.calm(ctx, '#10240a', { alpha: 0.52 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#fffbd0', sparkle: 0.3, alpha: 0.6 });
  // The slice behind.
  ctx.save(); ctx.translate(800, 306);
  const rind = k.ellipse(0, 0, 92, 92);
  k.withShadow(ctx, () => { ctx.fillStyle = '#f2c21a'; ctx.fill(rind); }, { color: 'rgba(20,30,0,0.4)', blur: 18, y: 10 });
  k.ramp(ctx, rind, -80, -80, 80, 80, ['#ffe66d', '#f2b81a']);
  ctx.fillStyle = '#fff7d6'; ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 9; i += 1) { ctx.save(); ctx.rotate((i / 9) * Math.PI * 2); ctx.fillStyle = k.lin(ctx, 0, -10, 0, -72, ['#ffec7a', '#ffe14a']); ctx.fill(k.smooth([[0, -9], [-17, -34], [-14, -66], [0, -72], [14, -66], [17, -34]])); ctx.restore(); }
  ctx.fillStyle = '#fff7d6'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // The whole lemon in front.
  ctx.save(); ctx.translate(884, 262); ctx.rotate(-0.38);
  const body = new k.Path2D(); body.ellipse(0, 0, 128, 84, 0, 0, Math.PI * 2);
  const nubs = new k.Path2D(); nubs.ellipse(-134, 0, 26, 16, 0, 0, Math.PI * 2); nubs.ellipse(134, 0, 26, 16, 0, 0, Math.PI * 2);
  k.withShadow(ctx, () => { ctx.fillStyle = '#e8b216'; ctx.fill(body); ctx.fill(nubs); }, { color: 'rgba(20,30,0,0.4)', blur: 22, y: 12 });
  const skin = k.lin(ctx, -100, -80, 120, 90, ['#fff08a', '#ffd93a', '#e8aa12']);
  ctx.fillStyle = skin; ctx.fill(nubs); ctx.fill(body);
  ctx.save(); ctx.clip(body); ctx.fillStyle = k.rad(ctx, 70, 40, 140, [[0, 'rgba(210,140,0,0.35)'], [1, 'rgba(210,140,0,0)']]); ctx.fillRect(-140, -90, 280, 180); ctx.fillStyle = 'rgba(190,130,0,0.22)'; for (let i = 0; i < 90; i += 1) { ctx.beginPath(); ctx.arc(rand.range(-128, 128), rand.range(-84, 84), rand.range(0.8, 1.8), 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  k.gloss(ctx, -60, -42, 30, 12, -0.25, 0.5);
  ctx.rotate(0.38);
  k.face(ctx, 0, 6, 46, { eye: '#4a3000', blush: '#ff9a5a', mouth: 'smile' });
  ctx.restore();
  ctx.save(); ctx.translate(960, 170); ctx.rotate(-0.5); bigLeaf(ctx, 0, 0, 62, -6, 20, '#a2e65a', '#3f9a2a'); ctx.restore();
}

// ---------------------------------------------------------------- watermelon
function watermelon(ctx, rand) {
  k.sky(ctx, [[0, '#04283a'], [0.5, '#0a5a78'], [1, '#1b98a8']], 104);
  k.glow(ctx, 860, 270, 360, '#ffd6dc', 0.42, 'screen');
  k.discs(ctx, rand, 14, ['#c9fff0', '#9ee8e0'], { min: 20, max: 100, alpha: 0.09 });
  k.dotGrid(ctx, { step: 30, r: 2, color: '#d9fff6', alpha: 0.07 });
  k.bands(ctx, rand, 5, '#d9fff6', { alpha: 0.05 });
  k.calm(ctx, '#03212f', { alpha: 0.52 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#e6fffb', sparkle: 0.3, alpha: 0.6 });
  ctx.save(); ctx.translate(862, 252); ctx.rotate(-0.1);
  k.groundShadow(ctx, 0, 158, 150, 16, 0.3, '#02121a');
  const half = new k.Path2D(); half.moveTo(-142, -30); half.lineTo(142, -30); half.arc(0, -30, 142, 0, Math.PI, false); half.closePath();
  k.withShadow(ctx, () => { ctx.fillStyle = '#1f8a45'; ctx.fill(half); }, { color: 'rgba(0,25,35,0.45)', blur: 22, y: 12 });
  k.ramp(ctx, half, 0, -30, 0, 112, ['#3dbd62', '#1f8a45', '#146a34']);
  ctx.strokeStyle = 'rgba(10,80,40,0.35)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; for (const x of [-100, -52, 0, 52, 100]) { ctx.beginPath(); ctx.moveTo(x, 100); ctx.quadraticCurveTo(x * 1.12, 40, x * 1.24, -20); ctx.stroke(); }
  const rindIn = new k.Path2D(); rindIn.moveTo(-122, -30); rindIn.lineTo(122, -30); rindIn.arc(0, -30, 122, 0, Math.PI, false); rindIn.closePath();
  ctx.fillStyle = '#f4ffe6'; ctx.fill(rindIn);
  const flesh = new k.Path2D(); flesh.moveTo(-108, -30); flesh.lineTo(108, -30); flesh.arc(0, -30, 108, 0, Math.PI, false); flesh.closePath();
  k.ramp(ctx, flesh, 0, -30, 0, 80, ['#ff7d8e', '#ff4d6a', '#f02c54']);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill(k.ellipse(-50, -14, 34, 10));
  // Seeds.
  ctx.fillStyle = '#2b1a24'; for (const [x, y, r] of [[-78, 10, 0.3], [-52, 46, 0.2], [-10, 66, 0], [44, 54, -0.2], [78, 18, -0.3], [-34, 14, 0.1], [40, 22, -0.1], [10, 40, 0]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.beginPath(); ctx.ellipse(0, 0, 4.6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(-1.4, -2.4, 1.2, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#2b1a24'; ctx.restore(); }
  k.face(ctx, 0, 12, 44, { eye: '#3a0a1c', blush: '#ffc2cf', mouth: 'smile' });
  ctx.restore();
  // Little slices of lime-green leaves.
  for (const [x, y, a] of [[720, 120, 0.6], [996, 420, -0.4]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); bigLeaf(ctx, 0, 0, 46, 0, 12, '#8fe07a', '#2f9a52'); ctx.restore(); }
}

// ---------------------------------------------------------------- cherry
function cherry(ctx, rand) {
  k.sky(ctx, [[0, '#0c1438'], [0.5, '#1d2f78'], [1, '#4a68c6']], 106);
  k.glow(ctx, 860, 230, 340, '#ffd0e0', 0.36, 'screen');
  // White polka dots, big and small.
  ctx.save(); ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.07; for (let y = 20; y < 520; y += 70) for (let x = (y / 70) % 2 ? 40 : 0; x < 1040; x += 80) { ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  k.discs(ctx, rand, 8, ['#b8c8ff', '#ffd0e0'], { min: 20, max: 80, alpha: 0.07 });
  k.calm(ctx, '#0a1030', { alpha: 0.5 });
  k.stars(ctx, rand, 24, { x0: 30, x1: 760, color: '#e8eeff', sparkle: 0.3, alpha: 0.65 });
  ctx.save(); ctx.translate(864, 266);
  k.groundShadow(ctx, 0, 156, 140, 18, 0.34, '#050a22');
  // The stems meet at the top.
  ctx.strokeStyle = '#4e8a32'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-40, 8); ctx.bezierCurveTo(-30, -70, 10, -112, 36, -130); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(56, 34); ctx.bezierCurveTo(56, -60, 44, -110, 36, -130); ctx.stroke();
  ctx.strokeStyle = '#7ec24a'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-40, 8); ctx.bezierCurveTo(-30, -70, 10, -112, 36, -130); ctx.stroke();
  bigLeaf(ctx, 36, -130, 120, -164, 30, '#9be86a', '#2f9a52'); bigLeaf(ctx, 36, -130, -34, -170, 24, '#7bd85c', '#287f46');
  for (const [x, y, r] of [[-40, 76, 78], [56, 96, 70]]) {
    const body = k.ellipse(x, y, r, r * 0.96);
    k.withShadow(ctx, () => { ctx.fillStyle = '#9e0f2a'; ctx.fill(body); }, { color: 'rgba(5,8,30,0.5)', blur: 20, y: 12 });
    k.puff(ctx, body, x, y, r * 1.1, '#ff2a52', { light: 0.28, dark: 0.5 });
    ctx.fillStyle = 'rgba(80,0,16,0.35)'; ctx.beginPath(); ctx.ellipse(x + 2, y - r * 0.82, r * 0.22, r * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    k.gloss(ctx, x - r * 0.42, y - r * 0.36, r * 0.2, r * 0.38, 0.5, 0.5); k.gloss(ctx, x - r * 0.18, y - r * 0.7, r * 0.08, r * 0.08, 0, 0.7);
  }
  k.face(ctx, -40, 82, 34, { eye: '#3a0a1c', blush: '#ffb0c0', mouth: 'smile' });
  k.face(ctx, 56, 102, 30, { eye: '#3a0a1c', blush: '#ffb0c0', mouth: 'smile' });
  ctx.restore();
  for (const [x, y, s, a] of [[720, 120, 11, 0.85], [992, 150, 9, 0.8], [740, 420, 9, 0.7]]) { ctx.fillStyle = k.rgba('#ffc2d6', a); ctx.fill(k.heartPath(x, y, s)); }
}

// ---------------------------------------------------------------- orange
function orange(ctx, rand) {
  k.sky(ctx, [[0, '#1d0b38'], [0.5, '#4a1f78'], [1, '#8d3fa8']], 106);
  k.glow(ctx, 860, 250, 360, '#ffb86a', 0.45, 'screen');
  k.discs(ctx, rand, 12, ['#ffd0a0', '#e8b0ff'], { min: 20, max: 100, alpha: 0.08 });
  k.dotGrid(ctx, { step: 32, r: 2, color: '#ffe0c0', alpha: 0.07 });
  k.bands(ctx, rand, 5, '#ffd0ff', { alpha: 0.05 });
  k.calm(ctx, '#170830', { alpha: 0.5 });
  k.stars(ctx, rand, 24, { x0: 30, x1: 760, color: '#ffe8d0', sparkle: 0.3, alpha: 0.65 });
  // The slice.
  ctx.save(); ctx.translate(782, 332);
  const slice = k.ellipse(0, 0, 86, 86);
  k.withShadow(ctx, () => { ctx.fillStyle = '#f08a1a'; ctx.fill(slice); }, { color: 'rgba(25,5,40,0.45)', blur: 18, y: 10 });
  k.ramp(ctx, slice, -80, -80, 80, 80, ['#ffb23c', '#f07a12']);
  ctx.fillStyle = '#fff1d6'; ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 10; i += 1) { ctx.save(); ctx.rotate((i / 10) * Math.PI * 2); ctx.fillStyle = k.lin(ctx, 0, -8, 0, -68, ['#ffc94a', '#ff9a1f']); ctx.fill(k.smooth([[0, -8], [-14, -30], [-12, -60], [0, -66], [12, -60], [14, -30]])); ctx.restore(); }
  ctx.fillStyle = '#fff1d6'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(872, 252);
  k.groundShadow(ctx, 0, 134, 120, 16, 0.3, '#10051f');
  const body = k.ellipse(0, 0, 116, 110);
  k.withShadow(ctx, () => { ctx.fillStyle = '#e8741a'; ctx.fill(body); }, { color: 'rgba(25,5,40,0.45)', blur: 22, y: 12 });
  k.puff(ctx, body, 0, 0, 130, '#ff9a22', { light: 0.32, dark: 0.34 });
  ctx.save(); ctx.clip(body); ctx.fillStyle = 'rgba(180,70,0,0.22)'; for (let i = 0; i < 160; i += 1) { ctx.beginPath(); ctx.arc(rand.range(-116, 116), rand.range(-110, 110), rand.range(0.8, 1.7), 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  k.gloss(ctx, -52, -54, 20, 34, 0.6, 0.45);
  k.face(ctx, 0, 14, 48, { eye: '#4a1c00', blush: '#ff7a5a', mouth: 'smile' });
  ctx.strokeStyle = '#6a4a1a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -106); ctx.lineTo(4, -122); ctx.stroke();
  bigLeaf(ctx, 4, -112, 86, -150, 28, '#a6ec7c', '#2f9a52'); bigLeaf(ctx, 2, -112, -60, -144, 22, '#8fe27a', '#2a8a4c');
  ctx.restore();
}

// ---------------------------------------------------------------- blueberry
function blueberry(ctx, rand) {
  k.sky(ctx, [[0, '#0b2418'], [0.5, '#17472c'], [1, '#2f7a46']], 104);
  k.glow(ctx, 860, 250, 360, '#cde8ff', 0.36, 'screen');
  for (const [x, y, tx, ty, w] of [[1010, 520, 760, 380, 60], [1040, 440, 900, 90, 54], [630, 520, 700, 330, 40]]) k.ramp(ctx, k.leafPath(x, y, tx, ty, w), x, y, tx, ty, [k.rgba('#7ad07a', 0.26), k.rgba('#1f5a30', 0.3)]);
  k.discs(ctx, rand, 12, ['#cde8ff', '#a8d8b8'], { min: 20, max: 90, alpha: 0.07 });
  k.dotGrid(ctx, { step: 30, r: 1.8, color: '#e0f2e8', alpha: 0.06 });
  k.calm(ctx, '#08180f', { alpha: 0.52 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#e8f4ff', sparkle: 0.3, alpha: 0.6 });
  const berry = (x, y, r, big) => {
    const body = k.ellipse(x, y, r, r * 0.96);
    k.withShadow(ctx, () => { ctx.fillStyle = '#2a2f8f'; ctx.fill(body); }, { color: 'rgba(5,15,10,0.5)', blur: 18, y: 10 });
    k.puff(ctx, body, x, y, r * 1.2, '#5663e0', { light: 0.2, dark: 0.5 });
    ctx.fillStyle = k.rad(ctx, x, y, r, [[0.55, 'rgba(190,200,255,0)'], [1, 'rgba(190,200,255,0.4)']]); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // The crown: a small five-point star.
    ctx.save(); ctx.translate(x + r * 0.08, y - r * 0.5); ctx.fillStyle = '#1b1f66'; ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const a = Math.PI * i / 5 - Math.PI / 2; const d = i % 2 ? r * 0.1 : r * 0.26; ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d * 0.7); } ctx.closePath(); ctx.fill(); ctx.restore();
    k.gloss(ctx, x - r * 0.4, y - r * 0.12, r * 0.12, r * 0.26, 0.5, 0.45);
    if (big) k.face(ctx, x, y + r * 0.3, r * 0.52, { eye: '#0e1140', blush: '#ff9fbf', mouth: 'smile' });
  };
  ctx.save();
  k.groundShadow(ctx, 866, 400, 150, 16, 0.3, '#040e08');
  berry(800, 330, 52, false); berry(940, 330, 54, false); berry(954, 190, 40, false); berry(764, 196, 36, false);
  berry(868, 264, 92, true); berry(870, 404, 46, false);
  bigLeaf(ctx, 868, 170, 960, 90, 26, '#9be86a', '#2f9a52'); bigLeaf(ctx, 868, 170, 780, 100, 24, '#7bd85c', '#287f46');
  ctx.restore();
}

// ---------------------------------------------------------------- pineapple
function pineapple(ctx, rand) {
  k.sky(ctx, [[0, '#032f3a'], [0.5, '#067a82'], [1, '#12b3a8']], 104);
  k.glow(ctx, 860, 240, 360, '#fff2b0', 0.42, 'screen');
  for (const [x, y, tx, ty, w] of [[10, 520, 200, 200, 44], [40, 440, 120, 80, 40], [640, 520, 720, 360, 38]]) k.ramp(ctx, k.leafPath(x, y, tx, ty, w), x, y, tx, ty, [k.rgba('#7ae8b0', 0.24), k.rgba('#0a6a60', 0.28)]);
  k.discs(ctx, rand, 12, ['#d0fff0', '#a0f0d8'], { min: 20, max: 90, alpha: 0.08 });
  k.dotGrid(ctx, { step: 30, r: 2, color: '#e0fff6', alpha: 0.07 });
  k.calm(ctx, '#032830', { alpha: 0.52 });
  k.stars(ctx, rand, 22, { x0: 30, x1: 760, color: '#f0fffa', sparkle: 0.3, alpha: 0.6 });
  ctx.save(); ctx.translate(866, 296); ctx.rotate(0.06);
  k.groundShadow(ctx, 0, 132, 100, 14, 0.3, '#02161a');
  // The crown first, behind the fruit.
  const fan = [[-80, -148, 20], [-48, -176, 24], [-16, -190, 26], [18, -190, 26], [50, -176, 24], [82, -148, 20], [0, -170, 24]];
  for (const [dx, dy, w] of fan) bigLeaf(ctx, dx * 0.15, -102, dx, dy, w, '#8de06a', '#2a9a4c');
  for (const [dx, dy, w] of [[-34, -178, 20], [34, -178, 20]]) bigLeaf(ctx, dx * 0.2, -104, dx, dy, w, '#b5f27c', '#3aa85a');
  const body = k.smooth([[0, -112], [58, -104], [86, -50], [88, 20], [64, 84], [0, 112], [-64, 84], [-88, 20], [-86, -50], [-58, -104]]);
  k.withShadow(ctx, () => { ctx.fillStyle = '#e8a812'; ctx.fill(body); }, { color: 'rgba(0,25,30,0.45)', blur: 22, y: 12 });
  k.puff(ctx, body, 0, 0, 140, '#ffcb3a', { light: 0.3, dark: 0.36 });
  ctx.save(); ctx.clip(body); ctx.strokeStyle = 'rgba(160,90,0,0.38)'; ctx.lineWidth = 3;
  for (let i = -8; i <= 8; i += 1) { ctx.beginPath(); ctx.moveTo(i * 30 - 130, -130); ctx.lineTo(i * 30 + 130, 130); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * 30 + 130, -130); ctx.lineTo(i * 30 - 130, 130); ctx.stroke(); }
  ctx.fillStyle = 'rgba(130,70,0,0.35)'; for (let r = -4; r <= 4; r += 1) for (let c = -4; c <= 4; c += 1) { const x = c * 42 + (r % 2 ? 21 : 0); const y = r * 21 + 6; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  k.gloss(ctx, -50, -52, 12, 38, 0.3, 0.4);
  ctx.save(); ctx.fillStyle = 'rgba(255,200,60,0.78)'; ctx.fill(k.ellipse(0, 18, 56, 36)); ctx.restore();
  k.face(ctx, 0, 14, 44, { eye: '#4a2e00', blush: '#ff9a5a', mouth: 'smile' });
  ctx.restore();
}

module.exports = [
  { id: 'fruit-strawberry', family: 'fruits', color: '#7d1340', textColor: '#ffffff', accent: '#ffd0dc', seed: 11, paint: strawberry },
  { id: 'fruit-peach', family: 'fruits', color: '#7e2a40', textColor: '#ffffff', accent: '#ffd9c4', seed: 12, paint: peach },
  { id: 'fruit-lemon', family: 'fruits', color: '#2f5a16', textColor: '#ffffff', accent: '#fff29a', seed: 13, paint: lemon },
  { id: 'fruit-watermelon', family: 'fruits', color: '#0a5a78', textColor: '#ffffff', accent: '#ffc2cf', seed: 14, paint: watermelon },
  { id: 'fruit-cherry', family: 'fruits', color: '#1d2f78', textColor: '#ffffff', accent: '#ffc2d6', seed: 15, paint: cherry },
  { id: 'fruit-orange', family: 'fruits', color: '#4a1f78', textColor: '#ffffff', accent: '#ffd29a', seed: 16, paint: orange },
  { id: 'fruit-blueberry', family: 'fruits', color: '#17472c', textColor: '#ffffff', accent: '#cfd8ff', seed: 17, paint: blueberry },
  { id: 'fruit-pineapple', family: 'fruits', color: '#067a82', textColor: '#ffffff', accent: '#fff2a0', seed: 18, paint: pineapple },
];
Object.assign(module.exports, { bigLeaf, calyx });
