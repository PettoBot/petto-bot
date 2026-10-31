// The animal family: a quiet scene on the left for the text and a round, friendly animal on the right.
const k = require('./kit');
const { Path2D } = k;

const EYE = '#2a1830';

/** Runs `draw` with the origin moved to (x, y), turned and scaled. */
function at(ctx, x, y, draw, { rot = 0, scale = 1 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale); draw(); ctx.restore();
}

function fillPuff(ctx, path, cx, cy, r, color, opts) { k.puff(ctx, path, cx, cy, r, color, opts); }

function circle(cx, cy, r) { return k.ellipse(cx, cy, r, r); }

/** Whiskers: `count` thin lines out of each side of the muzzle. */
function whiskers(ctx, x, y, length, color = 'rgba(255,255,255,0.75)') {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const side of [-1, 1]) for (const dy of [-8, 2, 12]) {
    ctx.beginPath(); ctx.moveTo(x + side * 34, y + dy * 0.6); ctx.quadraticCurveTo(x + side * (34 + length * 0.6), y + dy * 1.2 - 4, x + side * (34 + length), y + dy * 1.9); ctx.stroke();
  }
}

/** A small tuft of grass or reeds. */
function reeds(ctx, rand, x, y, n, h, color) {
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < n; i += 1) {
    const bx = x + rand.range(-26, 26); const lean = rand.range(-24, 24); const hh = h * rand.range(0.6, 1.1);
    ctx.lineWidth = rand.range(2.5, 4.5);
    ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx + lean * 0.3, y - hh * 0.55, bx + lean, y - hh); ctx.stroke();
  }
}

// ---------------------------------------------------------------- duck
function duck(ctx, rand) {
  k.sky(ctx, [[0, '#062f3d'], [0.5, '#0d6270'], [1, '#27a3a0']], 105);
  k.glow(ctx, 850, 230, 340, '#e8fff6', 0.4, 'screen');
  k.discs(ctx, rand, 10, ['#bff4f0', '#8ee6e0'], { min: 24, max: 90, alpha: 0.1 });
  k.dotGrid(ctx, { step: 32, r: 1.8, color: '#d9fffb', alpha: 0.06 });
  k.calm(ctx, '#052a36', { alpha: 0.5 });
  // Ripples around the duck.
  ctx.strokeStyle = '#d8fffa'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) { ctx.globalAlpha = 0.34 - i * 0.05; ctx.beginPath(); ctx.ellipse(850, 398, 120 + i * 44, 20 + i * 8, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // Lily pads and reeds.
  for (const [x, y, r] of [[640, 440, 30], [980, 455, 34], [720, 470, 22], [60, 460, 36]]) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.34); ctx.fillStyle = k.lin(ctx, 0, -r, 0, r, ['#5bd18a', '#23915a']);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, 0.2, Math.PI * 2 - 0.2); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  reeds(ctx, rand, 40, 500, 7, 190, '#176d52'); reeds(ctx, rand, 1000, 500, 5, 150, '#176d52');
  k.stars(ctx, rand, 16, { y1: 250, color: '#e6fffb', sparkle: 0.3, alpha: 0.5 });

  at(ctx, 852, 262, () => {
    k.groundShadow(ctx, 0, 138, 128, 18, 0.3, '#02212b');
    // Body, wing and tail.
    const body = k.ellipse(0, 62, 112, 78);
    k.withShadow(ctx, () => { ctx.fillStyle = '#e8a91c'; ctx.fill(body); }, { color: 'rgba(0,30,40,0.4)', blur: 20, y: 10 });
    fillPuff(ctx, body, 0, 62, 118, '#ffd43b');
    ctx.fillStyle = '#ffd43b'; ctx.fill(k.smooth([[100, 40], [140, 18], [132, 62], [104, 80]]));
    ctx.fillStyle = k.lin(ctx, -80, 40, -20, 100, ['#ffe27a', '#f2b522']); ctx.fill(k.ellipse(-50, 70, 46, 30, 0.35));
    ctx.strokeStyle = 'rgba(190,120,0,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const [x, y] of [[-62, 66], [-44, 74], [-26, 82]]) { ctx.beginPath(); ctx.arc(x, y, 12, 3.4, 5.4); ctx.stroke(); }
    // Head, tuft, beak.
    const head = circle(0, -22, 84);
    fillPuff(ctx, head, 0, -22, 90, '#ffd43b');
    ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    for (const [dx, a] of [[-10, -0.5], [0, 0], [10, 0.5]]) { ctx.beginPath(); ctx.moveTo(dx * 0.4, -102); ctx.quadraticCurveTo(dx * 1.2 + a * 10, -128, dx * 2.4 + 6, -132); ctx.stroke(); }
    k.gloss(ctx, -44, -64, 20, 11, -0.7, 0.4);
    const beak = k.ellipse(0, 18, 38, 19);
    fillPuff(ctx, beak, 0, 18, 40, '#ff9a3c', { light: 0.28, dark: 0.22 });
    ctx.strokeStyle = 'rgba(150,60,0,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-28, 21); ctx.quadraticCurveTo(0, 30, 28, 21); ctx.stroke();
    k.face(ctx, 0, -14, 56, { eye: EYE, blush: '#ff8a65', mouth: null, gap: 0.72 });
  });
  for (const [x, y, r] of [[720, 120, 9], [985, 140, 6], [1000, 250, 5], [700, 300, 7]]) { ctx.strokeStyle = 'rgba(230,255,252,0.7)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
}

// ---------------------------------------------------------------- cat
function cat(ctx, rand) {
  k.sky(ctx, [[0, '#120f33'], [0.55, '#1d2a5e'], [1, '#2c6a86']], 110);
  // A big warm moon behind the cat.
  k.glow(ctx, 868, 215, 300, '#ffd9a0', 0.5, 'screen');
  ctx.fillStyle = k.rad(ctx, 868, 215, 150, [[0, '#fff1d0'], [0.8, '#ffd9a0'], [1, '#f7be78']], 840, 190, 10); ctx.beginPath(); ctx.arc(868, 215, 150, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(214,150,80,0.22)'; for (const [x, y, r] of [[815, 170, 22], [905, 260, 28], [920, 160, 14], [826, 262, 12]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  k.stars(ctx, rand, 46, { x1: 760, y1: 330, color: '#fff4d6', sparkle: 0.22, alpha: 0.85 });
  k.calm(ctx, '#0b0a26', { alpha: 0.4 });
  // Roofs.
  ctx.fillStyle = '#0d1330';
  const roofs = new Path2D(); roofs.moveTo(0, 500); roofs.lineTo(0, 420); roofs.lineTo(60, 400); roofs.lineTo(60, 360); roofs.lineTo(130, 360); roofs.lineTo(130, 410); roofs.lineTo(210, 430); roofs.lineTo(210, 380); roofs.lineTo(300, 380); roofs.lineTo(300, 440); roofs.lineTo(380, 450); roofs.lineTo(380, 500); roofs.closePath(); ctx.fill(roofs);
  ctx.fillStyle = '#ffd36e'; for (const [x, y] of [[84, 376], [236, 398], [262, 398]]) ctx.fillRect(x, y, 12, 14);

  at(ctx, 868, 262, () => {
    const orange = '#ff9a3d'; const cream = '#fff0d2';
    k.groundShadow(ctx, 0, 140, 120, 16, 0.4, '#000');
    // Tail curling at the side.
    ctx.strokeStyle = orange; ctx.lineWidth = 34; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(78, 118); ctx.bezierCurveTo(160, 128, 170, 40, 124, 22); ctx.stroke();
    ctx.strokeStyle = '#c9651a'; ctx.lineWidth = 8; ctx.setLineDash([10, 18]); ctx.beginPath(); ctx.moveTo(110, 124); ctx.bezierCurveTo(158, 112, 160, 56, 126, 32); ctx.stroke(); ctx.setLineDash([]);
    // Body.
    const body = k.ellipse(0, 110, 86, 62); fillPuff(ctx, body, 0, 110, 96, orange);
    ctx.fillStyle = cream; ctx.fill(k.ellipse(0, 126, 40, 40));
    // Ears.
    for (const side of [-1, 1]) {
      const ear = k.roundedPoly([[side * 88, -22], [side * 76, -112], [side * 14, -74]], 16);
      fillPuff(ctx, ear, side * 60, -80, 70, orange);
      ctx.fillStyle = '#ff9fb0'; ctx.fill(k.roundedPoly([[side * 74, -38], [side * 68, -92], [side * 34, -70]], 9));
    }
    const head = k.ellipse(0, 0, 98, 84); fillPuff(ctx, head, 0, 0, 108, orange);
    // The stripes on the forehead and a lighter muzzle.
    ctx.strokeStyle = '#d9731f'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    for (const [x, a] of [[-24, -0.18], [0, 0], [24, 0.18]]) { ctx.beginPath(); ctx.moveTo(x, -80); ctx.lineTo(x + a * 30, -52); ctx.stroke(); }
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 96, -6); ctx.lineTo(side * 74, -2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(side * 94, 14); ctx.lineTo(side * 72, 14); ctx.stroke(); }
    ctx.fillStyle = cream; ctx.fill(k.ellipse(-22, 34, 30, 24)); ctx.fill(k.ellipse(22, 34, 30, 24));
    k.gloss(ctx, -52, -44, 18, 10, -0.6, 0.3);
    k.face(ctx, 0, 0, 56, { eye: EYE, blush: '#ff8fa3', mouth: null, gap: 0.78, eyeSize: 0.2 });
    ctx.fillStyle = '#ff7f95'; ctx.fill(k.roundedPoly([[-9, 18], [9, 18], [0, 29]], 3));
    ctx.strokeStyle = EYE; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, 29); ctx.lineTo(0, 35); ctx.moveTo(-14, 42); ctx.quadraticCurveTo(-7, 47, 0, 35); ctx.quadraticCurveTo(7, 47, 14, 42); ctx.stroke();
    whiskers(ctx, 0, 38, 52, 'rgba(255,255,255,0.8)');
  });
}

// ---------------------------------------------------------------- fox
function fox(ctx, rand) {
  k.sky(ctx, [[0, '#0b2a26'], [0.5, '#17504a'], [1, '#3f8c63']], 105);
  k.glow(ctx, 860, 250, 330, '#ffc27a', 0.4, 'screen');
  // Fir trees in the distance.
  const fir = (x, y, h, c) => { ctx.fillStyle = c; for (let i = 0; i < 4; i += 1) { const w = h * (0.22 + i * 0.1); const top = y - h + i * h * 0.22; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - w, top + h * 0.32); ctx.lineTo(x + w, top + h * 0.32); ctx.closePath(); ctx.fill(); } ctx.fillRect(x - 5, y - h * 0.1, 10, h * 0.12); };
  for (const [x, h] of [[40, 200], [130, 150], [220, 190], [330, 130], [440, 170]]) fir(x, 505, h, 'rgba(7,35,32,0.7)');
  for (const [x, h] of [[640, 180], [720, 130], [1000, 220], [950, 150]]) fir(x, 505, h, 'rgba(7,35,32,0.55)');
  k.discs(ctx, rand, 8, ['#9fe0b0', '#d4ffd8'], { min: 30, max: 100, alpha: 0.07 });
  k.calm(ctx, '#07211e', { alpha: 0.5 });
  // Fireflies.
  for (let i = 0; i < 22; i += 1) { const x = rand.range(30, 1000); const y = rand.range(40, 440); k.glow(ctx, x, y, rand.range(7, 14), '#ffe9a0', 0.9, 'screen'); }
  ctx.fillStyle = k.lin(ctx, 0, 462, 0, 500, ['rgba(20,80,60,0)', 'rgba(8,40,34,0.8)']); ctx.fillRect(0, 462, 1024, 40);

  at(ctx, 858, 268, () => {
    const orange = '#ff7a2a'; const white = '#fff6ea'; const dark = '#3a2418';
    k.groundShadow(ctx, 0, 134, 124, 16, 0.4, '#041412');
    // The bushy tail.
    ctx.save(); ctx.translate(96, 96); ctx.rotate(-0.5);
    const tail = k.smooth([[0, -22], [60, -34], [110, -10], [106, 30], [54, 40], [0, 22]]);
    fillPuff(ctx, tail, 50, 0, 70, orange); ctx.save(); ctx.clip(tail); ctx.fillStyle = white; ctx.fill(k.ellipse(118, 8, 38, 60)); ctx.restore(); ctx.restore();
    const body = k.ellipse(0, 108, 80, 64); fillPuff(ctx, body, 0, 108, 96, orange);
    ctx.fillStyle = white; ctx.fill(k.ellipse(0, 126, 42, 44));
    for (const side of [-1, 1]) {
      const ear = k.roundedPoly([[side * 94, -18], [side * 86, -116], [side * 18, -72]], 14);
      fillPuff(ctx, ear, side * 62, -76, 72, orange);
      ctx.save(); ctx.clip(ear); ctx.fillStyle = dark; ctx.fill(k.roundedPoly([[side * 100, -80], [side * 88, -124], [side * 58, -88]], 4)); ctx.restore();
      ctx.fillStyle = '#ffd6bd'; ctx.fill(k.roundedPoly([[side * 76, -34], [side * 72, -84], [side * 38, -64]], 8));
    }
    const head = k.smooth([[0, -78], [62, -70], [102, -22], [96, 24], [46, 60], [0, 72], [-46, 60], [-96, 24], [-102, -22], [-62, -70]]);
    fillPuff(ctx, head, 0, 0, 114, orange);
    // The white cheeks come in from the sides like a mask.
    const mask = k.smooth([[-100, 8], [-62, 4], [-28, 30], [0, 40], [28, 30], [62, 4], [100, 8], [86, 34], [64, 50], [40, 66], [0, 74], [-40, 66], [-64, 50], [-86, 34]]);
    ctx.fillStyle = white; ctx.fill(mask);
    ctx.fillStyle = 'rgba(255,170,110,0.3)'; ctx.fill(k.ellipse(0, -44, 30, 18));
    k.gloss(ctx, -50, -46, 18, 9, -0.6, 0.28);
    k.face(ctx, 0, -8, 56, { eye: EYE, blush: '#ff9a8a', mouth: null, gap: 0.76 });
    ctx.fillStyle = dark; ctx.fill(k.roundedPoly([[-11, 22], [11, 22], [0, 34]], 5));
    ctx.strokeStyle = dark; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 34); ctx.lineTo(0, 40); ctx.moveTo(-12, 46); ctx.quadraticCurveTo(-6, 50, 0, 40); ctx.quadraticCurveTo(6, 50, 12, 46); ctx.stroke();
  });
}

// ---------------------------------------------------------------- bunny
function bunny(ctx, rand) {
  k.sky(ctx, [[0, '#1c1550'], [0.5, '#4a2f86'], [1, '#a05bb0']], 108);
  k.glow(ctx, 860, 190, 340, '#ffd1ea', 0.38, 'screen');
  ctx.fillStyle = k.rad(ctx, 860, 190, 128, [[0, '#d9a8e8'], [1, '#b878c8']], 830, 160, 8); ctx.beginPath(); ctx.arc(860, 190, 128, 0, Math.PI * 2); ctx.fill();
  k.stars(ctx, rand, 44, { x1: 740, y1: 330, color: '#fff0fb', sparkle: 0.28, alpha: 0.8 });
  k.discs(ctx, rand, 8, ['#e7c6ff', '#ffc6e8'], { min: 20, max: 80, alpha: 0.08 });
  k.ridges(ctx, [{ y: 400, amp: 18, freq: 0.006, color: '#2a1d62', seed: 4, alpha: 0.9 }, { y: 440, amp: 14, freq: 0.008, color: '#1c1348', seed: 9 }]);
  k.calm(ctx, '#150f3d', { alpha: 0.46 });

  at(ctx, 856, 276, () => {
    const fur = '#fff7fd'; const shade = '#d8c7f3';
    k.groundShadow(ctx, 0, 124, 120, 16, 0.4, '#0b0626');
    // Ears.
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * 40, -64); ctx.rotate(side * 0.22);
      const ear = k.smooth([[0, 10], [-26, -40], [-18, -108], [0, -128], [18, -108], [26, -40]]);
      ramp(ctx, ear, -26, -128, 26, 10, ['#ffffff', fur, shade]);
      ctx.fillStyle = k.lin(ctx, 0, -110, 0, 0, ['#ffb3d1', '#ff8fb7']); ctx.fill(k.smooth([[0, 0], [-12, -36], [-8, -92], [0, -104], [8, -92], [12, -36]]));
      ctx.restore();
    }
    const body = k.ellipse(0, 100, 84, 64); fillPuff(ctx, body, 0, 100, 96, fur, { dark: 0.2 });
    ctx.fillStyle = fur; ctx.fill(k.ellipse(-50, 150, 24, 16)); ctx.fill(k.ellipse(50, 150, 24, 16));
    const head = k.ellipse(0, 0, 94, 80); fillPuff(ctx, head, 0, 0, 104, fur, { dark: 0.2 });
    k.gloss(ctx, -46, -44, 18, 9, -0.6, 0.45);
    k.face(ctx, 0, 6, 54, { eye: EYE, blush: '#ffa3c4', mouth: null, gap: 0.8 });
    ctx.fillStyle = '#ff8fb7'; ctx.fill(k.roundedPoly([[-8, 22], [8, 22], [0, 31]], 3));
    ctx.strokeStyle = '#7a4a86'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 31); ctx.lineTo(0, 36); ctx.moveTo(-12, 42); ctx.quadraticCurveTo(-6, 47, 0, 36); ctx.quadraticCurveTo(6, 47, 12, 42); ctx.stroke();
    // Two little teeth.
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d8c7f3'; ctx.lineWidth = 1.5; for (const dx of [-5, 5]) { const t = k.rrect(dx - 5, 42, 10, 12, 3); ctx.fill(t); ctx.stroke(t); }
  });
}
function ramp(ctx, path, x0, y0, x1, y1, stops) { k.ramp(ctx, path, x0, y0, x1, y1, stops); }

// ---------------------------------------------------------------- panda
function panda(ctx, rand) {
  k.sky(ctx, [[0, '#0f3a2a'], [0.55, '#1f6b46'], [1, '#6fb06a']], 108);
  k.glow(ctx, 850, 230, 340, '#e8ffd0', 0.4, 'screen');
  // Bamboo stalks.
  const stalk = (x, w, c1, c2, alpha) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = k.lin(ctx, x - w, 0, x + w, 0, [c2, c1, c2]); ctx.fillRect(x - w, -10, w * 2, 520);
    ctx.fillStyle = k.darken(c2, 0.25); for (let y = 40; y < 500; y += rand.range(86, 120)) ctx.fillRect(x - w - 1, y, w * 2 + 2, 5);
    ctx.globalAlpha = 1;
  };
  for (const [x, w, a] of [[34, 16, 0.55], [92, 11, 0.4], [150, 14, 0.5], [660, 10, 0.4], [716, 16, 0.55], [990, 14, 0.5]]) stalk(x, w, '#9be07a', '#3a9a52', a);
  ctx.fillStyle = 'rgba(160,230,120,0.5)'; for (let i = 0; i < 18; i += 1) { const x = rand.pick([60, 120, 690, 980]) + rand.range(-30, 30); const y = rand.range(20, 450); ctx.save(); ctx.translate(x, y); ctx.rotate(rand.range(-1.2, 1.2)); ctx.fill(k.leafPath(0, 0, 44, 0, 8)); ctx.restore(); }
  k.discs(ctx, rand, 8, ['#d8ffc0', '#a8f0a0'], { min: 20, max: 90, alpha: 0.07 });
  k.calm(ctx, '#08241a', { alpha: 0.5 });

  at(ctx, 856, 266, () => {
    const white = '#fbfbf7'; const black = '#272431';
    k.groundShadow(ctx, 0, 138, 126, 17, 0.38, '#031610');
    const body = k.ellipse(0, 106, 90, 66); fillPuff(ctx, body, 0, 106, 100, white, { dark: 0.22 });
    // Arms holding a bamboo shoot.
    for (const side of [-1, 1]) { ctx.save(); ctx.translate(side * 76, 100); ctx.rotate(side * -0.5); fillPuff(ctx, k.ellipse(0, 0, 24, 44), 0, 0, 50, black, { light: 0.12, dark: 0.3 }); ctx.restore(); }
    for (const side of [-1, 1]) fillPuff(ctx, circle(side * 78, -64, 30), side * 78, -64, 36, black, { light: 0.14, dark: 0.3 });
    const head = k.ellipse(0, 0, 100, 84); fillPuff(ctx, head, 0, 0, 108, white, { dark: 0.2 });
    // The eye patches, tilted.
    for (const side of [-1, 1]) { ctx.save(); ctx.translate(side * 40, 4); ctx.rotate(side * -0.55); fillPuff(ctx, k.ellipse(0, 0, 25, 34), 0, 0, 36, black, { light: 0.14, dark: 0.25 }); ctx.restore(); }
    k.gloss(ctx, -52, -46, 18, 9, -0.6, 0.4);
    k.face(ctx, 0, 6, 56, { eye: '#1a1722', blush: '#ff9fb0', mouth: null, gap: 0.72, eyeSize: 0.17 });
    // The eyes sit on the dark patches: lighter highlights are already drawn, add the nose and mouth.
    ctx.fillStyle = black; ctx.fill(k.roundedPoly([[-12, 26], [12, 26], [0, 38]], 6));
    ctx.strokeStyle = black; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 38); ctx.lineTo(0, 44); ctx.moveTo(-12, 50); ctx.quadraticCurveTo(-6, 55, 0, 44); ctx.quadraticCurveTo(6, 55, 12, 50); ctx.stroke();
  });
}

// ---------------------------------------------------------------- frog
function frog(ctx, rand) {
  k.sky(ctx, [[0, '#04251f'], [0.55, '#0c5a43'], [1, '#2e9a68']], 105);
  k.glow(ctx, 850, 260, 330, '#d6ffc2', 0.36, 'screen');
  k.discs(ctx, rand, 12, ['#aef0c6', '#7be0b0'], { min: 16, max: 80, alpha: 0.08 });
  k.calm(ctx, '#03201a', { alpha: 0.5 });
  for (let i = 0; i < 28; i += 1) { const x = rand.range(30, 1000); const y = rand.range(30, 430); k.glow(ctx, x, y, rand.range(7, 15), '#f4ffb0', 0.85, 'screen'); }
  reeds(ctx, rand, 30, 506, 8, 220, '#0f5a40'); reeds(ctx, rand, 1000, 506, 6, 180, '#0f5a40');
  // Water and lily pads.
  ctx.fillStyle = 'rgba(8,60,50,0.55)'; ctx.fillRect(0, 410, 1024, 100);
  ctx.strokeStyle = 'rgba(190,255,220,0.3)'; ctx.lineWidth = 2; for (let i = 0; i < 4; i += 1) { ctx.globalAlpha = 0.5 - i * 0.1; ctx.beginPath(); ctx.ellipse(858, 404, 130 + i * 40, 18 + i * 6, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;

  at(ctx, 858, 262, () => {
    const green = '#6fd55a'; const belly = '#e8ffc8';
    // The lily pad under the frog.
    ctx.save(); ctx.translate(0, 134); ctx.scale(1, 0.26); ctx.fillStyle = k.lin(ctx, 0, -170, 0, 170, ['#47c47a', '#1d8556']); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 170, 0.2, Math.PI * 2 - 0.2); ctx.closePath(); ctx.fill(); ctx.restore();
    k.groundShadow(ctx, 0, 138, 118, 14, 0.3, '#02130f');
    const body = k.ellipse(0, 88, 94, 56); fillPuff(ctx, body, 0, 88, 100, green);
    ctx.fillStyle = belly; ctx.fill(k.ellipse(0, 104, 54, 36));
    // The hind legs and feet.
    for (const side of [-1, 1]) { fillPuff(ctx, k.ellipse(side * 82, 114, 34, 22, side * 0.4), side * 82, 114, 40, green); fillPuff(ctx, k.ellipse(side * 104, 134, 30, 10, side * 0.15), side * 104, 134, 34, '#58c548'); }
    const head = k.smooth([[0, -62], [60, -66], [112, -34], [118, 14], [74, 58], [0, 72], [-74, 58], [-118, 14], [-112, -34], [-60, -66]]);
    fillPuff(ctx, head, 0, 0, 124, green);
    // The big eyes on top.
    for (const side of [-1, 1]) {
      const ex = side * 56; const ey = -62;
      fillPuff(ctx, circle(ex, ey, 36), ex, ey, 40, green);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex, ey, 25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = k.rad(ctx, ex, ey + 2, 16, [[0, '#4a3358'], [1, EYE]], ex - 3, ey - 2, 0); ctx.beginPath(); ctx.arc(ex, ey + 2, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 5, ey - 4, 5.6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(ex + 5, ey + 7, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    k.gloss(ctx, -56, -4, 22, 9, -0.2, 0.3);
    for (const side of [-1, 1]) { ctx.fillStyle = k.rad(ctx, side * 70, 30, 24, [[0, 'rgba(255,130,150,0.6)'], [1, 'rgba(255,130,150,0)']]); ctx.beginPath(); ctx.ellipse(side * 70, 30, 24, 14, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#2e8a3c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 9, 8, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#1f6a2c'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-52, 24); ctx.quadraticCurveTo(0, 62, 52, 24); ctx.stroke();
  });
}

// ---------------------------------------------------------------- bear
function bear(ctx, rand) {
  k.sky(ctx, [[0, '#3a1f10'], [0.5, '#7a4318'], [1, '#d68a2f']], 108);
  k.glow(ctx, 860, 240, 340, '#ffe09a', 0.45, 'screen');
  // A honeycomb that fades toward the text.
  ctx.save(); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.14;
  const hex = (cx, cy, r) => { ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 3 * i + Math.PI / 6; const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke(); };
  const r = 34; for (let row = -1; row < 9; row += 1) for (let col = -1; col < 18; col += 1) { const cx = col * r * 1.732 + (row % 2 ? r * 0.866 : 0); const cy = row * r * 1.5; if (cx > 420 || rand.next() < 0.0) hex(cx, cy, r); }
  ctx.restore();
  ctx.save(); ctx.fillStyle = 'rgba(255,196,80,0.2)'; for (const [cx, cy] of [[690, 70], [756, 108], [690, 146]]) { ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 3 * i + Math.PI / 6; ctx.lineTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); } ctx.closePath(); ctx.fill(); } ctx.restore();
  k.discs(ctx, rand, 8, ['#ffe0a0', '#ffc15a'], { min: 14, max: 60, alpha: 0.08 });
  k.calm(ctx, '#2b150a', { alpha: 0.5 });

  at(ctx, 856, 268, () => {
    const brown = '#a8693a'; const light = '#e8bd8a';
    k.groundShadow(ctx, 0, 138, 126, 17, 0.4, '#1f0e05');
    // The honey pot in front.
    const body = k.ellipse(0, 108, 88, 64); fillPuff(ctx, body, 0, 108, 100, brown);
    ctx.fillStyle = light; ctx.fill(k.ellipse(0, 122, 44, 42));
    for (const side of [-1, 1]) { fillPuff(ctx, circle(side * 70, -58, 33), side * 70, -58, 38, brown); ctx.fillStyle = '#7f4521'; ctx.beginPath(); ctx.arc(side * 70, -58, 18, 0, Math.PI * 2); ctx.fill(); }
    const head = k.ellipse(0, 0, 98, 84); fillPuff(ctx, head, 0, 0, 108, brown);
    ctx.fillStyle = light; ctx.fill(k.ellipse(0, 34, 44, 34));
    k.gloss(ctx, -50, -44, 18, 9, -0.6, 0.3);
    k.face(ctx, 0, -4, 56, { eye: '#2a160c', blush: '#ff9a7a', mouth: null, gap: 0.78 });
    ctx.fillStyle = '#3a2216'; ctx.fill(k.ellipse(0, 22, 14, 10));
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-4, 19, 4.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2216'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, 38); ctx.moveTo(-14, 44); ctx.quadraticCurveTo(-7, 50, 0, 38); ctx.quadraticCurveTo(7, 50, 14, 44); ctx.stroke();
    // A jar of honey held at the side.
    ctx.save(); ctx.translate(-108, 122); ctx.rotate(-0.1);
    const jar = k.rrect(-28, -34, 56, 62, 14);
    ctx.fillStyle = k.lin(ctx, -28, -34, 28, 28, ['#ffd45a', '#e89a16']); ctx.fill(jar);
    ctx.fillStyle = '#b8742a'; ctx.fill(k.rrect(-30, -42, 60, 14, 6));
    ctx.fillStyle = '#fff4d0'; ctx.fill(k.rrect(-17, -16, 34, 28, 6));
    ctx.fillStyle = '#c9811d'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('HONEY', 0, 2, 32);
    k.gloss(ctx, -17, -18, 4, 14, 0, 0.5);
    ctx.restore();
  });
}

// ---------------------------------------------------------------- penguin
function penguin(ctx, rand) {
  k.sky(ctx, [[0, '#08183a'], [0.5, '#12447a'], [1, '#3b93b8']], 108);
  // A soft aurora ribbon.
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const [c, off] of [['#6df0c8', 0], ['#7fb2ff', 40]]) { const g = k.lin(ctx, 0, 40 + off, 0, 220 + off, [k.rgba(c, 0), k.rgba(c, 0.22), k.rgba(c, 0)]); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 90 + off); ctx.bezierCurveTo(260, 20 + off, 520, 190 + off, 1024, 60 + off); ctx.lineTo(1024, 190 + off); ctx.bezierCurveTo(520, 300 + off, 260, 130 + off, 0, 220 + off); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  k.stars(ctx, rand, 50, { y1: 300, color: '#e8f7ff', sparkle: 0.25, alpha: 0.8 });
  // Snow flakes falling.
  k.stars(ctx, rand, 40, { min: 1.2, max: 3, sparkle: 0, color: '#ffffff', alpha: 0.6 });
  k.calm(ctx, '#06122e', { alpha: 0.46 });
  // The ice floe and far icebergs.
  const berg = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w * 0.2, y - h); ctx.lineTo(x + w * 0.05, y - h * 0.6); ctx.lineTo(x + w * 0.25, y - h * 0.85); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill(); };
  berg(560, 440, 190, 90, 'rgba(160,215,240,0.28)'); berg(986, 446, 150, 120, 'rgba(160,215,240,0.3)'); berg(80, 450, 200, 70, 'rgba(150,200,230,0.2)');
  ctx.fillStyle = 'rgba(10,50,90,0.7)'; ctx.fillRect(0, 446, 1024, 60);

  at(ctx, 858, 258, () => {
    const navy = '#222a4f'; const belly = '#f6fbff';
    // The floe.
    const floe = k.smooth([[-150, 150], [-80, 134], [0, 130], [90, 136], [160, 150], [90, 176], [-70, 176]]);
    k.ramp(ctx, floe, 0, 130, 0, 180, ['#ffffff', '#bfe6f7']);
    k.groundShadow(ctx, 0, 140, 110, 12, 0.3, '#041020');
    // Feet and flippers.
    ctx.fillStyle = '#ff9e3d'; for (const side of [-1, 1]) ctx.fill(k.ellipse(side * 36, 146, 28, 11, side * 0.1));
    const body = k.smooth([[0, -100], [66, -96], [102, -30], [100, 56], [74, 130], [0, 146], [-74, 130], [-100, 56], [-102, -30], [-66, -96]]);
    k.withShadow(ctx, () => { ctx.fillStyle = navy; ctx.fill(body); }, { color: 'rgba(0,10,30,0.5)', blur: 18, y: 10 });
    fillPuff(ctx, body, 0, 10, 140, '#35407a', { light: 0.1, dark: 0.45 });
    for (const side of [-1, 1]) { ctx.save(); ctx.translate(side * 96, 36); ctx.rotate(side * 0.35); fillPuff(ctx, k.ellipse(0, 0, 20, 56), 0, 0, 56, '#2a3366', { light: 0.1, dark: 0.4 }); ctx.restore(); }
    // The white belly and face mask.
    ctx.fillStyle = belly; ctx.fill(k.smooth([[0, -12], [58, -38], [78, 20], [66, 92], [0, 136], [-66, 92], [-78, 20], [-58, -38]]));
    ctx.fillStyle = k.lin(ctx, 0, -30, 0, 130, ['rgba(255,255,255,0)', 'rgba(150,200,235,0.55)']); ctx.fill(k.smooth([[0, -12], [58, -38], [78, 20], [66, 92], [0, 136], [-66, 92], [-78, 20], [-58, -38]]));
    ctx.fillStyle = belly; ctx.fill(k.ellipse(-34, -52, 34, 36)); ctx.fill(k.ellipse(34, -52, 34, 36));
    k.gloss(ctx, -60, -76, 14, 7, -0.5, 0.2);
    k.face(ctx, 0, -50, 50, { eye: '#1a1530', blush: '#ff9fb0', mouth: null, gap: 0.78, eyeSize: 0.2 });
    fillPuff(ctx, k.roundedPoly([[-20, -36], [20, -36], [0, -16]], 8), 0, -30, 26, '#ff9e3d', { light: 0.25, dark: 0.2 });
  });
}

// ---------------------------------------------------------------- hedgehog
function hedgehog(ctx, rand) {
  k.sky(ctx, [[0, '#2a2410'], [0.5, '#5c6a2e'], [1, '#a8a04a']], 108);
  k.glow(ctx, 860, 230, 340, '#fff0b0', 0.4, 'screen');
  // Leaves scattered on the ground and in the air.
  const colors = ['#d9822b', '#c2491f', '#e8b030', '#7aa83a'];
  for (let i = 0; i < 26; i += 1) { ctx.save(); ctx.translate(rand.range(0, 1024), rand.range(20, 480)); ctx.rotate(rand.range(0, 6.28)); ctx.globalAlpha = rand.range(0.25, 0.7); const c = rand.pick(colors); ctx.fillStyle = k.lin(ctx, 0, 0, 40, 0, [k.lighten(c, 0.2), c]); ctx.fill(k.leafPath(0, 0, rand.range(26, 52), 0, rand.range(8, 14))); ctx.restore(); }
  ctx.globalAlpha = 1;
  k.discs(ctx, rand, 8, ['#fff0b0', '#e8d878'], { min: 20, max: 80, alpha: 0.06 });
  k.calm(ctx, '#1d1a0a', { alpha: 0.5 });
  ctx.fillStyle = 'rgba(40,36,12,0.35)'; ctx.fillRect(0, 452, 1024, 60);
  // Mushrooms.
  for (const [x, y, s, c] of [[700, 450, 1, '#d94d3a'], [980, 458, 0.8, '#e8944a']]) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#f6ecd2'; ctx.fill(k.rrect(-8, -22, 16, 26, 6)); const cap = k.smooth([[-30, -20], [0, -50], [30, -20], [0, -12]]); k.puff(ctx, cap, 0, -28, 32, c); ctx.fillStyle = 'rgba(255,255,255,0.8)'; for (const [dx, dy] of [[-10, -28], [8, -34], [14, -24]]) { ctx.beginPath(); ctx.arc(dx, dy, 3.4, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }

  at(ctx, 856, 268, () => {
    const spine = '#6b4426'; const skin = '#f2cfa0';
    k.groundShadow(ctx, 0, 130, 130, 16, 0.4, '#120f04');
    // The spines: many small pointed strokes around the back.
    const backR = k.rng(5);
    const dome = k.smooth([[-122, 100], [-128, 20], [-92, -60], [-20, -108], [60, -100], [116, -40], [134, 40], [118, 110], [0, 130]]);
    k.withShadow(ctx, () => { ctx.fillStyle = '#4a2c16'; ctx.fill(dome); }, { color: 'rgba(20,10,0,0.45)', blur: 18, y: 10 });
    fillPuff(ctx, dome, 0, 0, 160, '#8a5a32', { light: 0.18, dark: 0.45 });
    ctx.save(); ctx.clip(dome);
    for (let i = 0; i < 360; i += 1) {
      const a = backR.range(Math.PI * 0.55, Math.PI * 2.25); const r = backR.range(30, 135);
      const x = Math.cos(a) * r * 1.05 + 10; const y = Math.sin(a) * r * 0.95 + 8;
      const len = backR.range(16, 26);
      ctx.strokeStyle = backR.next() < 0.5 ? '#c79b6b' : '#4a2c16'; ctx.globalAlpha = backR.range(0.35, 0.9); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.9); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
    // The face: a rounded snout on the left-front, to be friendly we face the viewer.
    const face = k.smooth([[0, -70], [66, -52], [96, 6], [72, 62], [0, 84], [-72, 62], [-96, 6], [-66, -52]]);
    fillPuff(ctx, face, 0, 6, 108, skin, { dark: 0.2 });
    for (const side of [-1, 1]) fillPuff(ctx, circle(side * 76, -48, 20), side * 76, -48, 24, skin, { dark: 0.2 });
    k.gloss(ctx, -44, -40, 16, 8, -0.6, 0.35);
    k.face(ctx, 0, 6, 52, { eye: '#2a160c', blush: '#ff9a7a', mouth: null, gap: 0.78 });
    ctx.fillStyle = '#3a2216'; ctx.fill(k.ellipse(0, 28, 11, 8));
    ctx.strokeStyle = '#3a2216'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 35); ctx.lineTo(0, 40); ctx.moveTo(-11, 46); ctx.quadraticCurveTo(-5, 51, 0, 40); ctx.quadraticCurveTo(5, 51, 11, 46); ctx.stroke();
    // A small apple.
    ctx.save(); ctx.translate(-98, 96); const apple = circle(0, 0, 28); k.puff(ctx, apple, 0, 0, 30, '#e63a46');
    ctx.strokeStyle = '#4a2c16'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(3, -38); ctx.stroke();
    ctx.fillStyle = '#5bb24a'; ctx.fill(k.leafPath(4, -34, 24, -42, 6)); k.gloss(ctx, -10, -10, 5, 8, 0.4, 0.55); ctx.restore();
  });
}

module.exports = [
  { id: 'animal-duck', family: 'animals', color: '#0d6270', textColor: '#ffffff', accent: '#fff2a8', seed: 21, paint: duck },
  { id: 'animal-cat', family: 'animals', color: '#1d2a5e', textColor: '#ffffff', accent: '#ffd9a0', seed: 22, paint: cat },
  { id: 'animal-fox', family: 'animals', color: '#17504a', textColor: '#ffffff', accent: '#ffcf9a', seed: 23, paint: fox },
  { id: 'animal-bunny', family: 'animals', color: '#4a2f86', textColor: '#ffffff', accent: '#ffc6e8', seed: 24, paint: bunny },
  { id: 'animal-panda', family: 'animals', color: '#1f6b46', textColor: '#ffffff', accent: '#d8ffb8', seed: 25, paint: panda },
  { id: 'animal-frog', family: 'animals', color: '#0c5a43', textColor: '#ffffff', accent: '#e6ff9a', seed: 26, paint: frog },
  { id: 'animal-bear', family: 'animals', color: '#7a4318', textColor: '#ffffff', accent: '#ffe09a', seed: 27, paint: bear },
  { id: 'animal-penguin', family: 'animals', color: '#12447a', textColor: '#ffffff', accent: '#bfe9ff', seed: 28, paint: penguin },
  { id: 'animal-hedgehog', family: 'animals', color: '#5c6a2e', textColor: '#ffffff', accent: '#ffe6a0', seed: 29, paint: hedgehog },
];
