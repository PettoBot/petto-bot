// The nature family: skies, seas and seasons, each with a bright focus on the right and a calm area on the left for the text.
const k = require('./kit');
const { Path2D } = k;

function snowflake(ctx, x, y, r, alpha = 0.8) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = Math.max(1, r * 0.12); ctx.lineCap = 'round';
  for (let i = 0; i < 6; i += 1) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r); ctx.moveTo(0, -r * 0.55); ctx.lineTo(-r * 0.28, -r * 0.8); ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.28, -r * 0.8); ctx.stroke(); }
  ctx.restore();
}

/** A pine with snow or a tint, base at (x, y), `h` tall. */
function pine(ctx, x, y, h, color, snow = null) {
  const tiers = 4;
  ctx.fillStyle = k.darken(color, 0.4); ctx.fillRect(x - h * 0.03, y - h * 0.12, h * 0.06, h * 0.14);
  for (let i = 0; i < tiers; i += 1) {
    const top = y - h + (i * h * 0.22); const w = h * (0.2 + i * 0.09); const bottom = top + h * 0.34;
    ctx.fillStyle = k.lin(ctx, x - w, top, x + w, bottom, [k.lighten(color, 0.08), color, k.darken(color, 0.2)]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - w, bottom); ctx.quadraticCurveTo(x, bottom + h * 0.04, x + w, bottom); ctx.closePath(); ctx.fill();
    if (snow) { ctx.fillStyle = snow; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - w * 0.62, top + (bottom - top) * 0.6); ctx.quadraticCurveTo(x - w * 0.2, top + (bottom - top) * 0.5, x, top + (bottom - top) * 0.62); ctx.quadraticCurveTo(x + w * 0.2, top + (bottom - top) * 0.5, x + w * 0.62, top + (bottom - top) * 0.6); ctx.closePath(); ctx.fill(); }
  }
}

// ---------------------------------------------------------------- night
function night(ctx, rand) {
  k.sky(ctx, [[0, '#080b26'], [0.55, '#18246a'], [1, '#3a4cae']], 100);
  k.glow(ctx, 860, 140, 340, '#ffe9a8', 0.4, 'screen');
  k.stars(ctx, rand, 90, { y1: 360, color: '#fff6d6', sparkle: 0.16, alpha: 0.9 });
  k.crescent(ctx, 860, 130, 76, ['#fff6cf', '#ffe08a'], 0.46);
  // A shooting star.
  ctx.save(); ctx.strokeStyle = k.lin(ctx, 700, 70, 560, 130, ['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)']); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(560, 134); ctx.lineTo(704, 70); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fill(k.star4(706, 69, 9)); ctx.restore();
  k.calm(ctx, '#050722', { alpha: 0.4 });
  k.ridges(ctx, [{ y: 372, amp: 26, freq: 0.0048, color: '#1b2766', seed: 2 }, { y: 420, amp: 22, freq: 0.0062, color: '#10184c', seed: 5 }, { y: 466, amp: 12, freq: 0.01, color: '#0a1038', seed: 8 }]);
  for (const [x, h] of [[640, 90], [690, 120], [740, 80], [980, 110], [1010, 80], [60, 100], [110, 70]]) pine(ctx, x, 470, h, '#0b1a3e');
  // The tent and its fire.
  ctx.save(); ctx.translate(850, 440);
  k.glow(ctx, 70, -20, 100, '#ffb050', 0.55, 'screen'); k.glow(ctx, 0, -30, 140, '#ffd080', 0.25, 'screen');
  const tent = new Path2D(); tent.moveTo(-88, 28); tent.lineTo(0, -104); tent.lineTo(88, 28); tent.closePath();
  k.withShadow(ctx, () => { ctx.fillStyle = '#b8452a'; ctx.fill(tent); }, { color: 'rgba(0,0,20,0.5)', blur: 16, y: 8 });
  ctx.fillStyle = k.lin(ctx, -88, -104, 88, 28, ['#ff9a5a', '#e0603a', '#b0402a']); ctx.fill(tent);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(k.roundedPoly([[-20, -78], [0, -104], [88, 28], [40, 28]], 4));
  const door = new Path2D(); door.moveTo(-28, 28); door.lineTo(0, -52); door.lineTo(28, 28); door.closePath();
  ctx.fillStyle = k.lin(ctx, 0, -52, 0, 28, ['#ffe9a0', '#ffb44a']); ctx.fill(door);
  ctx.strokeStyle = '#7a2a1a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -104); ctx.lineTo(0, -120); ctx.moveTo(-88, 28); ctx.lineTo(-100, 34); ctx.moveTo(88, 28); ctx.lineTo(100, 34); ctx.stroke();
  // The campfire.
  ctx.fillStyle = '#4a2a1a'; ctx.save(); ctx.translate(84, 28); ctx.rotate(0.3); ctx.fillRect(-18, -4, 36, 8); ctx.rotate(-0.6); ctx.fillRect(-18, -4, 36, 8); ctx.restore();
  for (const [dx, h, c] of [[0, 46, '#ff7a2a'], [-9, 30, '#ffa53a'], [10, 32, '#ffa53a'], [0, 26, '#ffe27a']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(84 + dx - 11, 24); ctx.quadraticCurveTo(84 + dx - 14, 24 - h * 0.6, 84 + dx, 24 - h); ctx.quadraticCurveTo(84 + dx + 14, 24 - h * 0.6, 84 + dx + 11, 24); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  for (let i = 0; i < 14; i += 1) k.glow(ctx, rand.range(500, 1000), rand.range(250, 450), rand.range(5, 10), '#ffe9a0', 0.8, 'screen');
}

// ---------------------------------------------------------------- aurora
function aurora(ctx, rand) {
  k.sky(ctx, [[0, '#03071c'], [0.55, '#081f40'], [1, '#12445a']], 100);
  k.stars(ctx, rand, 110, { y1: 380, color: '#e8fbff', sparkle: 0.12, alpha: 0.85 });
  const curtain = (pts, c1, c2, alpha) => {
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.filter = 'blur(10px)';
    const path = new Path2D(); path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) path.quadraticCurveTo(pts[i][0], pts[i][1], pts[i][2], pts[i][3]);
    const back = pts.slice().reverse(); void back;
    ctx.strokeStyle = k.lin(ctx, 0, 0, 0, 330, [k.rgba(c1, 0), k.rgba(c1, alpha), k.rgba(c2, alpha * 0.8), k.rgba(c2, 0)]); ctx.lineWidth = 120; ctx.lineCap = 'round'; ctx.stroke(path);
    ctx.restore();
  };
  curtain([[-40, 190], [200, 80, 420, 170], [600, 250, 800, 120], [900, 60, 1100, 110]], '#58ffb0', '#6fe0ff', 0.42);
  curtain([[-40, 250], [220, 150, 440, 240], [640, 320, 840, 190], [940, 130, 1100, 190]], '#7fe8ff', '#a47cff', 0.34);
  // Soft vertical rays under the curtains.
  ctx.save(); ctx.globalCompositeOperation = 'screen'; for (let i = 0; i < 70; i += 1) { const x = rand.range(300, 1024); const y = 120 + Math.sin(x * 0.006) * 70 + rand.range(0, 80); ctx.fillStyle = k.lin(ctx, 0, y, 0, y + rand.range(80, 180), ['rgba(110,255,200,0.1)', 'rgba(110,255,200,0)']); ctx.fillRect(x, y, rand.range(2, 6), 200); } ctx.restore();
  k.calm(ctx, '#030a1c', { alpha: 0.4 });
  // Snowy mountains and pines.
  const mountain = (pts, c1, c2) => { ctx.fillStyle = k.lin(ctx, 0, 300, 0, 500, [c1, c2]); ctx.beginPath(); ctx.moveTo(pts[0][0], 520); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.lineTo(pts[pts.length - 1][0], 520); ctx.closePath(); ctx.fill(); };
  mountain([[560, 400], [700, 290], [770, 340], [880, 250], [1000, 330], [1060, 300], [1060, 520]], '#1a4a66', '#0c2a40');
  ctx.fillStyle = 'rgba(220,245,255,0.5)'; ctx.fill(k.roundedPoly([[880, 250], [850, 292], [880, 284], [900, 300], [920, 282], [910, 262]], 3)); ctx.fill(k.roundedPoly([[700, 290], [678, 320], [700, 314], [720, 326], [724, 304]], 3));
  mountain([[0, 450], [90, 400], [180, 440], [280, 410], [400, 450], [520, 430], [680, 460], [860, 420], [1060, 450], [1060, 520]], '#0e2f48', '#06182a');
  ctx.fillStyle = 'rgba(210,240,255,0.14)'; ctx.fillRect(0, 462, 1024, 40);
  for (const [x, h] of [[720, 120], [770, 90], [820, 130], [960, 110], [1000, 80], [60, 90], [120, 70]]) pine(ctx, x, 480, h, '#0a2a3a', 'rgba(225,245,255,0.7)');
}

// ---------------------------------------------------------------- ocean
function ocean(ctx, rand) {
  k.sky(ctx, [[0, '#0b2e66'], [0.45, '#2a78c0'], [0.62, '#8fd0e8']], 100);
  const sea = k.lin(ctx, 0, 300, 0, 500, ['#1393b8', '#0a5a8a', '#063a66']);
  // Sun and its glow.
  k.glow(ctx, 860, 250, 340, '#fff0b0', 0.55, 'screen');
  ctx.fillStyle = k.rad(ctx, 860, 250, 70, [[0, '#ffffff'], [0.7, '#fff3c0'], [1, '#ffe38a']]); ctx.beginPath(); ctx.arc(860, 250, 62, 0, Math.PI * 2); ctx.fill();
  k.cloud(ctx, 640, 120, 190, '#ffffff', 0.5, '#cfe8ff'); k.cloud(ctx, 960, 90, 150, '#ffffff', 0.45, '#cfe8ff'); k.cloud(ctx, 260, 160, 230, '#ffffff', 0.18);
  ctx.fillStyle = sea; ctx.fillRect(0, 300, 1024, 220);
  // The sun's path on the water.
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = k.lin(ctx, 0, 300, 0, 500, ['rgba(255,240,170,0.55)', 'rgba(255,240,170,0)']); ctx.beginPath(); ctx.moveTo(800, 300); ctx.lineTo(920, 300); ctx.lineTo(1000, 500); ctx.lineTo(720, 500); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 40; i += 1) { const y = rand.range(304, 480); const spread = 40 + (y - 300) * 0.55; ctx.fillRect(860 + rand.range(-spread, spread), y, rand.range(8, 26), 2); } ctx.restore();
  // Waves: crests drawn as bands.
  for (let i = 0; i < 6; i += 1) {
    const y = 318 + i * 34; const amp = 4 + i * 2.2;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + i * 0.012})`; ctx.beginPath(); ctx.moveTo(0, y + 20);
    for (let x = 0; x <= 1024; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.016 + i * 1.3) * amp);
    ctx.lineTo(1024, y + 28); ctx.lineTo(0, y + 28); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.22 + i * 0.03})`; ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x <= 1024; x += 8) { const yy = y + Math.sin(x * 0.016 + i * 1.3) * amp; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); } ctx.stroke();
  }
  k.calm(ctx, '#031a40', { alpha: 0.5 });
  // The little boat.
  ctx.save(); ctx.translate(780, 330);
  k.groundShadow(ctx, 0, 30, 70, 8, 0.3, '#03162e');
  ctx.fillStyle = '#ffffff'; ctx.fill(new k.Path2D('M -4 -92 L -4 -4 L -64 -4 Z')); ctx.fillStyle = '#ffd7de'; ctx.fill(new k.Path2D('M 6 -78 L 6 -4 L 52 -4 Z'));
  ctx.strokeStyle = '#6a4a3a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -98); ctx.lineTo(0, 6); ctx.stroke();
  const hull = new Path2D(); hull.moveTo(-60, 2); hull.lineTo(60, 2); hull.quadraticCurveTo(46, 32, 24, 32); hull.lineTo(-30, 32); hull.quadraticCurveTo(-52, 30, -60, 2); hull.closePath();
  ctx.fillStyle = k.lin(ctx, 0, 0, 0, 34, ['#ff7a6a', '#d84a4a']); ctx.fill(hull);
  ctx.fillStyle = '#ffd04a'; ctx.fillRect(-52, 10, 100, 4);
  ctx.fillStyle = '#ff5a5a'; ctx.fill(new k.Path2D('M 0 -98 L 22 -92 L 0 -86 Z'));
  ctx.restore();
  // Bubbles of foam.
  k.bokeh(ctx, rand, 10, ['#ffffff'], { y0: 330, y1: 500, min: 3, max: 9, alpha: 0.2 });
}

// ---------------------------------------------------------------- forest
function forest(ctx, rand) {
  k.sky(ctx, [[0, '#051a22'], [0.5, '#0e4a42'], [1, '#6ab08a']], 100);
  k.glow(ctx, 880, 120, 400, '#fff2b0', 0.55, 'screen');
  ctx.fillStyle = k.rad(ctx, 880, 120, 60, [[0, '#fffbe0'], [1, '#ffe9a0']]); ctx.beginPath(); ctx.arc(880, 120, 52, 0, Math.PI * 2); ctx.fill();
  // God rays.
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i += 1) { const a = 0.5 + i * 0.085; const len = 620; const w = rand.range(26, 70); ctx.fillStyle = k.lin(ctx, 880, 120, 880 - Math.cos(a) * len, 120 + Math.sin(a) * len, ['rgba(255,244,190,0.2)', 'rgba(255,244,190,0)']); ctx.beginPath(); ctx.moveTo(880, 120); ctx.lineTo(880 - Math.cos(a) * len - w, 120 + Math.sin(a) * len); ctx.lineTo(880 - Math.cos(a) * len + w, 120 + Math.sin(a) * len); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  const row = (y, h, color, n, seed, alpha) => { const r = k.rng(seed); ctx.globalAlpha = alpha; for (let i = 0; i < n; i += 1) pine(ctx, (i + r.range(0.1, 0.9)) * (1060 / n), y + r.range(-10, 10), h * r.range(0.7, 1.25), color); ctx.globalAlpha = 1; };
  row(330, 160, '#3c8a68', 12, 3, 0.55);
  // Mist between the layers.
  ctx.fillStyle = k.lin(ctx, 0, 270, 0, 400, ['rgba(200,255,230,0)', 'rgba(200,255,230,0.18)', 'rgba(200,255,230,0)']); ctx.fillRect(0, 270, 1024, 140);
  row(410, 220, '#1f6a50', 10, 6, 0.85);
  ctx.fillStyle = k.lin(ctx, 0, 350, 0, 460, ['rgba(180,240,210,0)', 'rgba(180,240,210,0.14)', 'rgba(180,240,210,0)']); ctx.fillRect(0, 350, 1024, 110);
  k.calm(ctx, '#031512', { alpha: 0.42 });
  row(500, 300, '#0c3a2c', 8, 9, 1);
  row(520, 360, '#05241c', 6, 12, 1);
  for (let i = 0; i < 24; i += 1) k.glow(ctx, rand.range(30, 1000), rand.range(60, 440), rand.range(6, 12), '#f4ffb0', 0.85, 'screen');
}

// ---------------------------------------------------------------- desert
function desert(ctx, rand) {
  k.sky(ctx, [[0, '#150a38'], [0.4, '#6a2272'], [0.7, '#ff7a5a'], [1, '#ffc060']], 100);
  k.stars(ctx, rand, 60, { y1: 200, color: '#fff0f8', sparkle: 0.2, alpha: 0.85 });
  k.glow(ctx, 820, 330, 380, '#ffdc8a', 0.55, 'screen');
  ctx.fillStyle = k.rad(ctx, 820, 330, 110, [[0, '#fffbe0'], [1, '#ffd37a']], 800, 300, 10); ctx.beginPath(); ctx.arc(820, 330, 104, 0, Math.PI * 2); ctx.fill();
  k.ridges(ctx, [{ y: 372, amp: 18, freq: 0.006, color: '#b8486a', seed: 1, alpha: 0.9 }, { y: 410, amp: 24, freq: 0.0045, color: '#8a2e62', seed: 4 }, { y: 452, amp: 20, freq: 0.0058, color: '#5a1c54', seed: 7 }, { y: 486, amp: 8, freq: 0.01, color: '#3a1040', seed: 9 }]);
  k.calm(ctx, '#1a0830', { alpha: 0.48 });
  // A cactus with a flower.
  ctx.save(); ctx.translate(904, 440);
  k.groundShadow(ctx, 0, 40, 70, 9, 0.35, '#1a0830');
  const trunk = k.rrect(-30, -150, 60, 190, 30); const armL = new Path2D(); armL.moveTo(-30, -20); armL.lineTo(-60, -20); armL.quadraticCurveTo(-76, -20, -76, -36); armL.lineTo(-76, -88); armL.arc(-60, -88, 16, Math.PI, 0); armL.lineTo(-44, -44); armL.lineTo(-30, -44); armL.closePath();
  const armR = new Path2D(); armR.moveTo(30, -50); armR.lineTo(58, -50); armR.quadraticCurveTo(74, -50, 74, -66); armR.lineTo(74, -112); armR.arc(58, -112, 16, 0, Math.PI, true); armR.lineTo(42, -76); armR.lineTo(30, -76); armR.closePath();
  k.withShadow(ctx, () => { ctx.fillStyle = '#3a8a5a'; ctx.fill(trunk); ctx.fill(armL); ctx.fill(armR); }, { color: 'rgba(20,0,30,0.4)', blur: 16, y: 8 });
  for (const path of [armL, armR, trunk]) { ctx.fillStyle = k.lin(ctx, -40, -150, 40, 40, ['#7de0a6', '#44b27a', '#2e8a5a']); ctx.fill(path); }
  ctx.strokeStyle = 'rgba(20,90,60,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-10, -140); ctx.lineTo(-10, 30); ctx.moveTo(12, -140); ctx.lineTo(12, 30); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.8; for (const [x, y] of [[-20, -110], [20, -90], [-18, -50], [22, -20], [-68, -60], [66, -90]]) { ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke(); }
  k.face(ctx, 0, -92, 28, { eye: '#10321f', blush: '#ff9ab0', mouth: 'smile', gap: 0.7 });
  // The flower on top.
  ctx.translate(0, -152); for (let i = 0; i < 6; i += 1) { ctx.save(); ctx.rotate((i / 6) * Math.PI * 2); ctx.fillStyle = k.lin(ctx, 0, 0, 0, -22, ['#ff6fa0', '#ffc2d8']); ctx.beginPath(); ctx.ellipse(0, -12, 8, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Birds.
  ctx.strokeStyle = 'rgba(40,10,50,0.75)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; for (const [x, y, s] of [[700, 150, 1], [740, 120, 0.8], [770, 160, 0.7]]) { ctx.beginPath(); ctx.moveTo(x - 14 * s, y); ctx.quadraticCurveTo(x - 7 * s, y - 9 * s, x, y); ctx.quadraticCurveTo(x + 7 * s, y - 9 * s, x + 14 * s, y); ctx.stroke(); }
}

// ---------------------------------------------------------------- galaxy
function galaxy(ctx, rand) {
  k.sky(ctx, [[0, '#04020f'], [0.5, '#12072e'], [1, '#2a0f52']], 110);
  for (const [x, y, r, c, a] of [[860, 200, 340, '#ff4fa8', 0.34], [700, 340, 300, '#7a4aff', 0.4], [980, 360, 260, '#3ad0ff', 0.3], [520, 110, 240, '#9a3aff', 0.22], [400, 380, 200, '#ff4fa8', 0.12]]) k.glow(ctx, x, y, r, c, a, 'screen');
  // Dust lanes made of tiny stars.
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 700; i += 1) { const t = rand.range(0, 1); const x = 200 + t * 820 + rand.range(-70, 70); const y = 360 - t * 200 + Math.sin(t * 6) * 50 + rand.range(-60, 60); ctx.fillStyle = k.rgba(rand.pick(['#ffd0f0', '#bfe8ff', '#e0c8ff']), rand.range(0.2, 0.9)); ctx.beginPath(); ctx.arc(x, y, rand.range(0.5, 1.4), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  k.stars(ctx, rand, 140, { color: '#ffffff', sparkle: 0.1, alpha: 0.9 });
  k.stars(ctx, rand, 14, { color: '#fff0ff', sparkle: 1, min: 1, max: 2.4, alpha: 0.95 });
  k.calm(ctx, '#05020f', { alpha: 0.46 });
  // A ringed planet with a face.
  ctx.save(); ctx.translate(862, 252); ctx.rotate(-0.38);
  k.groundShadow(ctx, 0, 134, 120, 10, 0.18, '#000');
  const ring = (front) => { ctx.save(); ctx.beginPath(); if (front) ctx.rect(-200, 0, 400, 200); else ctx.rect(-200, -200, 400, 200); ctx.clip(); ctx.strokeStyle = k.lin(ctx, -150, 0, 150, 0, ['#ffd6f0', '#ff9ad0', '#9a7aff']); ctx.lineWidth = 16; ctx.beginPath(); ctx.ellipse(0, 0, 150, 40, 0, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 164, 46, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
  ring(false);
  const planet = k.ellipse(0, 0, 84, 84);
  k.withShadow(ctx, () => { ctx.fillStyle = '#c04a90'; ctx.fill(planet); }, { color: 'rgba(255,120,200,0.45)', blur: 26, y: 0 });
  k.puff(ctx, planet, 0, 0, 96, '#ff8ac8', { light: 0.3, dark: 0.5 });
  ctx.save(); ctx.clip(planet); ctx.fillStyle = 'rgba(255,255,255,0.14)'; for (const [y, h] of [[-40, 14], [-4, 22], [38, 12]]) ctx.fillRect(-90, y, 180, h); ctx.fillStyle = 'rgba(120,30,110,0.25)'; ctx.fill(k.ellipse(36, 40, 26, 14)); ctx.restore();
  k.gloss(ctx, -34, -40, 14, 24, 0.5, 0.35);
  k.face(ctx, -2, 6, 34, { eye: '#2a0a40', blush: '#ffd0f0', mouth: 'smile', blushAlpha: 0.55 });
  ring(true);
  ctx.restore();
  // Little moons.
  for (const [x, y, r, c] of [[740, 140, 14, '#9ad8ff'], [986, 380, 20, '#ffd08a'], [720, 400, 10, '#c0a8ff']]) { k.puff(ctx, k.ellipse(x, y, r, r), x, y, r * 1.1, c, { light: 0.3, dark: 0.45 }); }
}

// ---------------------------------------------------------------- autumn
function maple(ctx, size, c1, c2, rot = 0) {
  ctx.save(); ctx.rotate(rot);
  const lobes = [[0, 1, 0.36], [-0.78, 0.82, 0.3], [0.78, 0.82, 0.3], [-1.5, 0.58, 0.24], [1.5, 0.58, 0.24]];
  for (const [a, l, w] of lobes) {
    ctx.save(); ctx.rotate(a); ctx.fillStyle = k.lin(ctx, 0, 0, 0, -size * l, [c2, c1]); ctx.fill(lobePath(size * l, size * w));
    ctx.strokeStyle = k.rgba(k.darken(c2, 0.3), 0.55); ctx.lineWidth = Math.max(1, size * 0.02); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -size * l * 0.85); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, size * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = k.darken(c2, 0.3); ctx.lineWidth = Math.max(2, size * 0.05); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, size * 0.42); ctx.stroke();
  ctx.restore();
}
function lobePath(len, w) {
  const p = new Path2D();
  p.moveTo(0, 0); p.bezierCurveTo(-w * 1.1, -len * 0.2, -w * 1.3, -len * 0.55, -w * 0.55, -len * 0.62); p.lineTo(-w * 0.3, -len * 0.8); p.lineTo(0, -len); p.lineTo(w * 0.3, -len * 0.8); p.lineTo(w * 0.55, -len * 0.62);
  p.bezierCurveTo(w * 1.3, -len * 0.55, w * 1.1, -len * 0.2, 0, 0); p.closePath();
  return p;
}
function autumn(ctx, rand) {
  k.sky(ctx, [[0, '#240b0a'], [0.5, '#7a2410'], [1, '#d97a24']], 104);
  k.glow(ctx, 860, 240, 380, '#ffc36a', 0.5, 'screen');
  k.discs(ctx, rand, 10, ['#ffd08a', '#ff9a5a'], { min: 20, max: 90, alpha: 0.07 });
  k.calm(ctx, '#1c0806', { alpha: 0.5 });
  const palette = [['#ff7a2a', '#c2380f'], ['#ffb02a', '#d9701a'], ['#e8452a', '#9a2210'], ['#ffd24a', '#e8901a']];
  for (let i = 0; i < 32; i += 1) { ctx.save(); ctx.translate(rand.range(0, 1024), rand.range(0, 500)); ctx.globalAlpha = rand.range(0.25, 0.75); const [a, b] = rand.pick(palette); maple(ctx, rand.range(14, 30), a, b, rand.range(0, 6.28)); ctx.restore(); }
  ctx.globalAlpha = 1;
  // A pile of leaves along the ground.
  ctx.fillStyle = 'rgba(30,8,4,0.5)'; ctx.fillRect(0, 474, 1024, 40);
  ctx.save(); ctx.translate(866, 250); ctx.rotate(0.18);
  k.groundShadow(ctx, 0, 150, 130, 14, 0.3, '#1c0806');
  k.withShadow(ctx, () => maple(ctx, 150, '#ff7a2a', '#c2380f'), { color: 'rgba(30,5,0,0.5)', blur: 20, y: 12 });
  maple(ctx, 150, '#ff8a30', '#c2380f');
  k.face(ctx, 0, -26, 40, { eye: '#3a0e00', blush: '#ffd0a0', mouth: 'smile', blushAlpha: 0.5 });
  ctx.restore();
  ctx.save(); ctx.translate(724, 140); maple(ctx, 36, '#ffc24a', '#d9701a', -0.5); ctx.restore(); ctx.save(); ctx.translate(986, 410); maple(ctx, 44, '#ff5a2a', '#9a2210', 0.6); ctx.restore();
}

// ---------------------------------------------------------------- snow
function snow(ctx, rand) {
  k.sky(ctx, [[0, '#0a1440'], [0.5, '#263c8a'], [1, '#7aa0dc']], 100);
  k.glow(ctx, 860, 250, 360, '#dff0ff', 0.4, 'screen');
  k.stars(ctx, rand, 50, { y1: 260, color: '#f0f8ff', sparkle: 0.2, alpha: 0.8 });
  k.ridges(ctx, [{ y: 388, amp: 20, freq: 0.0055, color: '#b9d2f2', seed: 2, alpha: 0.9 }, { y: 428, amp: 18, freq: 0.0075, color: '#dcebfc', seed: 5 }, { y: 470, amp: 10, freq: 0.01, color: '#f4f9ff', seed: 8 }]);
  for (const [x, h, y] of [[640, 130, 420], [700, 100, 440], [980, 120, 430], [1020, 90, 445], [40, 110, 430], [100, 80, 445]]) pine(ctx, x, y, h, '#1f5a6a', '#ffffff');
  k.calm(ctx, '#08123a', { alpha: 0.42 });
  for (let i = 0; i < 46; i += 1) { const x = rand.range(0, 1024); const y = rand.range(0, 480); if (rand.next() < 0.3) snowflake(ctx, x, y, rand.range(5, 12), rand.range(0.4, 0.9)); else { ctx.fillStyle = `rgba(255,255,255,${rand.range(0.4, 0.9)})`; ctx.beginPath(); ctx.arc(x, y, rand.range(1.2, 3.2), 0, Math.PI * 2); ctx.fill(); } }
  // The snowman.
  ctx.save(); ctx.translate(866, 428);
  k.groundShadow(ctx, 0, 18, 100, 12, 0.3, '#0a1440');
  const ball = (cx, cy, r) => { const p = k.ellipse(cx, cy, r, r); k.withShadow(ctx, () => { ctx.fillStyle = '#cfe0f8'; ctx.fill(p); }, { color: 'rgba(10,20,70,0.4)', blur: 14, y: 8 }); ctx.fillStyle = k.rad(ctx, cx, cy, r * 1.2, [[0, '#ffffff'], [0.6, '#eaf3ff'], [1, '#a8c0ea']], cx - r * 0.3, cy - r * 0.35, 2); ctx.fill(p); };
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-60, -50); ctx.lineTo(-112, -88); ctx.moveTo(-96, -78); ctx.lineTo(-104, -108); ctx.moveTo(62, -50); ctx.lineTo(112, -84); ctx.stroke();
  ball(0, -34, 72); ball(0, -140, 56);
  ctx.fillStyle = '#4a4e66'; for (const y of [-60, -34, -8]) { ctx.beginPath(); ctx.arc(0, y, 5, 0, Math.PI * 2); ctx.fill(); }
  // The scarf.
  ctx.fillStyle = k.lin(ctx, 0, -100, 0, -70, ['#ff6a7a', '#d8344c']); ctx.fill(k.rrect(-58, -100, 116, 22, 11)); ctx.fill(k.rrect(14, -90, 24, 54, 8));
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (const x of [-40, -16, 8, 32]) ctx.fillRect(x, -98, 6, 18);
  k.face(ctx, 0, -144, 38, { eye: '#1a2048', blush: '#ffa0b8', mouth: null, gap: 0.62 });
  ctx.fillStyle = '#ff9a3a'; ctx.fill(k.roundedPoly([[0, -138], [34, -130], [0, -122]], 3));
  // The hat.
  ctx.fillStyle = '#2a2f55'; ctx.fill(k.rrect(-40, -202, 80, 12, 6)); ctx.fill(k.rrect(-27, -240, 54, 42, 6)); ctx.fillStyle = '#d8344c'; ctx.fillRect(-27, -212, 54, 8);
  ctx.restore();
}

// ---------------------------------------------------------------- sunset
function sunset(ctx, rand) {
  k.sky(ctx, [[0, '#1c0a40'], [0.35, '#7a1f74'], [0.6, '#ff5e6a'], [0.78, '#ffb35a']], 100);
  k.stars(ctx, rand, 40, { y1: 140, color: '#ffe8f4', sparkle: 0.2, alpha: 0.8 });
  k.glow(ctx, 840, 330, 400, '#ffd080', 0.55, 'screen');
  ctx.fillStyle = k.rad(ctx, 840, 330, 100, [[0, '#fffbe0'], [1, '#ffd27a']], 820, 300, 10); ctx.beginPath(); ctx.arc(840, 330, 94, 0, Math.PI * 2); ctx.fill();
  // Cloud streaks.
  for (const [x, y, w, a] of [[560, 150, 340, 0.3], [820, 210, 300, 0.26], [300, 250, 380, 0.16], [700, 270, 260, 0.2], [980, 120, 220, 0.28]]) { ctx.fillStyle = k.lin(ctx, x - w / 2, y, x + w / 2, y, ['rgba(255,190,160,0)', `rgba(255,190,200,${a})`, 'rgba(255,190,160,0)']); ctx.beginPath(); ctx.ellipse(x, y, w / 2, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + 30, y + 14, w / 3, 7, 0, 0, Math.PI * 2); ctx.fill(); }
  // The sea with the reflection.
  ctx.fillStyle = k.lin(ctx, 0, 352, 0, 500, ['#c2406a', '#6a1f6a', '#2a0f4a']); ctx.fillRect(0, 352, 1024, 150);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = k.lin(ctx, 0, 352, 0, 500, ['rgba(255,230,150,0.6)', 'rgba(255,200,120,0)']); ctx.beginPath(); ctx.moveTo(780, 352); ctx.lineTo(900, 352); ctx.lineTo(980, 500); ctx.lineTo(700, 500); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,190,0.8)'; for (let i = 0; i < 46; i += 1) { const y = rand.range(356, 490); const spread = 50 + (y - 352) * 0.5; ctx.fillRect(840 + rand.range(-spread, spread), y, rand.range(10, 30), 2); } ctx.restore();
  ctx.strokeStyle = 'rgba(255,200,200,0.2)'; ctx.lineWidth = 2; for (let i = 0; i < 6; i += 1) { ctx.beginPath(); const y = 366 + i * 24; for (let x = 0; x <= 1024; x += 8) { const yy = y + Math.sin(x * 0.02 + i) * 3; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); } ctx.stroke(); }
  k.calm(ctx, '#1a0834', { alpha: 0.5 });
  ctx.strokeStyle = 'rgba(40,8,50,0.8)'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; for (const [x, y, s] of [[690, 230, 1.1], [734, 200, 0.9], [770, 238, 0.8], [940, 180, 1]]) { ctx.beginPath(); ctx.moveTo(x - 15 * s, y); ctx.quadraticCurveTo(x - 7 * s, y - 10 * s, x, y); ctx.quadraticCurveTo(x + 7 * s, y - 10 * s, x + 15 * s, y); ctx.stroke(); }
  // A small island with a palm.
  ctx.fillStyle = '#240a3a'; ctx.beginPath(); ctx.ellipse(980, 356, 90, 14, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#240a3a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(990, 350); ctx.quadraticCurveTo(978, 318, 992, 290); ctx.stroke(); for (const a of [-2.6, -2.0, -1.2, -0.5, 0.2]) { ctx.beginPath(); ctx.moveTo(992, 290); ctx.quadraticCurveTo(992 + Math.cos(a) * 20, 290 + Math.sin(a) * 14 - 6, 992 + Math.cos(a) * 34, 290 + Math.sin(a) * 26 + 8); ctx.stroke(); }
}

// ---------------------------------------------------------------- clouds
function clouds(ctx, rand) {
  k.sky(ctx, [[0, '#1e2a74'], [0.5, '#5a58b8'], [1, '#e89cc0']], 100);
  k.glow(ctx, 860, 250, 380, '#ffe6f4', 0.45, 'screen');
  k.stars(ctx, rand, 50, { y1: 220, color: '#fff4fb', sparkle: 0.25, alpha: 0.75 });
  // A rainbow behind the big cloud.
  ctx.save(); ctx.lineCap = 'butt';
  ['#ff7a8a', '#ffb06a', '#ffe27a', '#7ae0a0', '#6ac0ff', '#a08aff'].forEach((c, i) => { ctx.strokeStyle = k.rgba(c, 0.55); ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(860, 380, 190 - i * 14, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke(); });
  ctx.restore();
  k.cloud(ctx, 300, 410, 320, '#ffe6f2', 0.28, '#d8a8e0'); k.cloud(ctx, 560, 440, 360, '#fff0f8', 0.4, '#e0b0e8'); k.cloud(ctx, 120, 380, 260, '#fff0f8', 0.25, '#d8a8e0');
  k.calm(ctx, '#1a1860', { alpha: 0.46 });
  k.cloud(ctx, 700, 130, 160, '#fff6fb', 0.5, '#ecc8f0'); k.cloud(ctx, 990, 90, 120, '#fff6fb', 0.5, '#ecc8f0');
  // The big cloud with a face.
  ctx.save(); ctx.translate(866, 330);
  k.groundShadow(ctx, 0, 70, 150, 16, 0.2, '#2a1a6a');
  const body = new Path2D();
  for (const [bx, by, br] of [[-92, 20, 56], [-44, -22, 74], [30, -42, 82], [94, 6, 62], [0, 30, 72]]) { body.moveTo(bx + br, by); body.arc(bx, by, br, 0, Math.PI * 2); }
  body.rect(-96, 20, 192, 56);
  k.withShadow(ctx, () => { ctx.fillStyle = '#e8b8e8'; ctx.fill(body); }, { color: 'rgba(40,20,110,0.4)', blur: 22, y: 12 });
  ctx.fillStyle = k.lin(ctx, 0, -110, 0, 80, ['#ffffff', '#ffeefa', '#f0c8ee']); ctx.fill(body);
  k.gloss(ctx, -56, -52, 28, 14, -0.5, 0.5);
  k.face(ctx, 0, 14, 46, { eye: '#3a2060', blush: '#ffa0c0', mouth: 'smile', blushAlpha: 0.6 });
  ctx.restore();
  for (const [x, y, s] of [[700, 300, 12], [1000, 260, 9], [730, 90, 8]]) { ctx.fillStyle = 'rgba(255,230,245,0.9)'; ctx.fill(k.star4(x, y, s * 1.6)); }
}

module.exports = [
  { id: 'nature-night', family: 'nature', color: '#18246a', textColor: '#ffffff', accent: '#ffe9a0', seed: 61, paint: night },
  { id: 'nature-aurora', family: 'nature', color: '#081f40', textColor: '#ffffff', accent: '#9bffd8', seed: 62, paint: aurora },
  { id: 'nature-ocean', family: 'nature', color: '#0a5a8a', textColor: '#ffffff', accent: '#fff0b0', seed: 63, paint: ocean },
  { id: 'nature-forest', family: 'nature', color: '#0e4a42', textColor: '#ffffff', accent: '#e8ffb0', seed: 64, paint: forest },
  { id: 'nature-desert', family: 'nature', color: '#6a2272', textColor: '#ffffff', accent: '#ffd6a0', seed: 65, paint: desert },
  { id: 'nature-galaxy', family: 'nature', color: '#12072e', textColor: '#ffffff', accent: '#ffb8e8', seed: 66, paint: galaxy },
  { id: 'nature-autumn', family: 'nature', color: '#7a2410', textColor: '#ffffff', accent: '#ffd68a', seed: 67, paint: autumn },
  { id: 'nature-snow', family: 'nature', color: '#263c8a', textColor: '#ffffff', accent: '#d6ecff', seed: 68, paint: snow },
  { id: 'nature-sunset', family: 'nature', color: '#7a1f74', textColor: '#ffffff', accent: '#ffd8a0', seed: 69, paint: sunset },
  { id: 'nature-clouds', family: 'nature', color: '#5a58b8', textColor: '#ffffff', accent: '#ffe0f4', seed: 70, paint: clouds },
];
