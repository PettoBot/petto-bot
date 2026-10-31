// Draws the nine characters of the Petto brand, each alone on a transparent background so they sit on any colour:
//   node scripts/make-brand-characters.js [outputDirectory]      (default: out/brand-characters, which git ignores)
// It writes pipo.png (duck), luna.png (cat), chispa.png (fox), nube.png (bunny), bambu.png (panda), lili.png (frog), miel.png (bear),
// copo.png (penguin) and bellota.png (hedgehog), and sheet.png: the nine on a light grey and on a dark background, to check the edges.
// The characters are the ones of the animal card designs (scripts/designs/animals.js, the functions ending in Character) drawn without
// the scene. Every picture has the same scale (pixels per drawing unit), so the characters keep their size next to each other, and is
// trimmed to what is drawn plus a margin. The artwork is original code: nothing is committed but the code.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const kit = require('./designs/kit');
const { characters } = require('./designs/animals');

// Pixels per drawing unit of the files (a character is about 300 units tall, so about 800 to 1000 pixels) and the clear border around it.
const SCALE = 2.75;
const MARGIN = 24;
// The room around the point the character is drawn from, in drawing units: the widest thing (a tail) is far inside it.
const REACH = 340;

const LIGHT = '#e9ebf0';
const DARK = '#15161c';

/** The box of the pixels that are not fully transparent: { x, y, w, h }, or null for an empty picture. */
function opaqueBox(canvas, threshold = 0) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * One character alone on a transparent canvas, trimmed to what is drawn plus `margin` pixels. `scale` is the pixels per drawing unit.
 * Returns { canvas, box } where box is where the drawing is inside the trimmed canvas.
 */
function renderCharacter(character, { scale = SCALE, margin = MARGIN } = {}) {
  const side = Math.ceil(REACH * 2 * scale);
  const full = createCanvas(side, side);
  const ctx = full.getContext('2d');
  ctx.translate(side / 2, side / 2);
  ctx.scale(scale, scale);
  const before = kit.view.scale;
  kit.view.scale = scale;
  try { character.draw(ctx, kit.rng(1), 0, 0); } finally { kit.view.scale = before; }
  const found = opaqueBox(full);
  if (!found) throw new Error(`${character.id} drew nothing`);
  // A drawing that reaches the edge of the room was cut: make the room bigger (REACH) instead of shipping a clipped picture.
  if (found.x === 0 || found.y === 0 || found.x + found.w === side || found.y + found.h === side) throw new Error(`${character.id} reaches the edge of its canvas: raise REACH`);
  const canvas = createCanvas(found.w + margin * 2, found.h + margin * 2);
  canvas.getContext('2d').drawImage(full, found.x, found.y, found.w, found.h, margin, margin, found.w, found.h);
  return { canvas, box: { x: margin, y: margin, w: found.w, h: found.h } };
}

/** The contact sheet: the nine on a light and on a dark background, in the same scale, with their names. */
function renderSheet(rendered) {
  const cell = 420; const gap = 24; const cols = 3; const rows = 3;
  const half = cols * cell + (cols + 1) * gap;
  const height = rows * cell + (rows + 1) * gap;
  const sheet = createCanvas(half * 2, height);
  const ctx = sheet.getContext('2d');
  const biggest = Math.max(...rendered.map((item) => Math.max(item.canvas.width, item.canvas.height)));
  const fit = Math.min(1, (cell - 44) / biggest);
  [[0, LIGHT, '#40424d'], [half, DARK, '#d6d8e2']].forEach(([x0, background, ink]) => {
    ctx.fillStyle = background; ctx.fillRect(x0, 0, half, height);
    rendered.forEach((item, i) => {
      const cx = x0 + gap + (i % cols) * (cell + gap); const cy = gap + Math.floor(i / cols) * (cell + gap);
      const w = item.canvas.width * fit; const h = item.canvas.height * fit;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(item.canvas, cx + (cell - w) / 2, cy + (cell - 28 - h) / 2, w, h);
      ctx.fillStyle = ink; ctx.font = '600 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(item.character.id, cx + cell / 2, cy + cell - 6);
    });
  });
  return sheet;
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'brand-characters'));
  fs.mkdirSync(outDir, { recursive: true });
  const rendered = characters.map((character) => ({ character, ...renderCharacter(character) }));
  for (const { character, canvas, box } of rendered) {
    fs.writeFileSync(path.join(outDir, `${character.id}.png`), canvas.toBuffer('image/png'));
    console.log(`${`${character.id}.png`.padEnd(14)} ${canvas.width}x${canvas.height}  drawing ${box.w}x${box.h}`);
  }
  fs.writeFileSync(path.join(outDir, 'sheet.png'), renderSheet(rendered).toBuffer('image/png'));
  console.log(`Written to ${outDir}`);
}

if (require.main === module) main();
module.exports = { renderCharacter, renderSheet, opaqueBox, characters, SCALE, MARGIN, REACH };
