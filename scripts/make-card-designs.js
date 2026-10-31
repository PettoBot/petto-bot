// Draws the card designs that come with Petto: node scripts/make-card-designs.js [id ...]
// Every design is code in scripts/designs (the artwork is original), drawn with a seeded random generator, so running this again gives
// the same pictures. It writes src/assets/backgrounds/<id>.webp, the small gallery picture in thumbs/<id>.webp and designs.json.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const kit = require('./designs/kit');
const designs = require('./designs');

const OUT = path.join(__dirname, '..', 'src', 'assets', 'backgrounds');
const THUMBS = path.join(OUT, 'thumbs');
const QUALITY = 82;
const THUMB_WIDTH = 320;
// How dark the tinted panel behind the text is when a design is chosen.
const PANEL_OPACITY = 0.62;

function draw(design) {
  const { canvas, ctx } = kit.start();
  const rand = kit.rng(design.seed);
  design.paint(ctx, rand);
  kit.edges(ctx, kit.darken(design.color, 0.7), design.edges);
  kit.vignette(ctx, design.color, 0.34);
  kit.grain(canvas, 6, design.seed);
  return canvas;
}

// The two pictures made before the gallery, kept as they are (PNG): the default rank cards.
const CLASSIC = [
  { id: 'rank-default', family: 'classic', file: 'rank-default.webp', color: '#120c1a', textColor: '#ffffff', accent: '#ffb199', panel: '#120c1a', ratio: 3.2 },
  { id: 'rank-voice', family: 'classic', file: 'rank-voice.webp', color: '#0c1a26', textColor: '#ffffff', accent: '#5eead4', panel: '#0c1a26', ratio: 3.2 },
];

function writeThumb(source, id, width, height) {
  const thumb = createCanvas(THUMB_WIDTH, Math.round(THUMB_WIDTH * height / width));
  const tctx = thumb.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  const small = thumb.toBuffer('image/webp', 78);
  fs.writeFileSync(path.join(THUMBS, `${id}.webp`), small);
  return small.length;
}

async function main() {
  const only = process.argv.slice(2);
  fs.mkdirSync(THUMBS, { recursive: true });
  const seen = new Set();
  for (const design of designs) {
    if (seen.has(design.id)) throw new Error(`Two designs are called ${design.id}`);
    seen.add(design.id);
    if (only.length && !only.includes(design.id)) continue;
    const canvas = draw(design);
    const full = canvas.toBuffer('image/webp', QUALITY);
    fs.writeFileSync(path.join(OUT, `${design.id}.webp`), full);
    const small = writeThumb(canvas, design.id, canvas.width, canvas.height);
    console.log(`${design.id.padEnd(24)} ${(full.length / 1024).toFixed(1).padStart(6)} KB   thumb ${(small / 1024).toFixed(1)} KB`);
  }
  // The classic pictures only need their gallery picture.
  for (const item of CLASSIC) {
    if (only.length && !only.includes(item.id)) continue;
    const image = await loadImage(path.join(OUT, item.file));
    writeThumb(image, item.id, image.width, image.height);
  }
  // The list the bot and the dashboard read: where each design is, its colors and its size on disk.
  const entries = [...CLASSIC.map((item) => ({ ...item })), ...designs.map((design) => ({
    id: design.id, family: design.family, file: `${design.id}.webp`, color: design.color, textColor: design.textColor, accent: design.accent,
    panel: kit.darken(design.color, 0.62), panelOpacity: PANEL_OPACITY, ratio: kit.W / kit.H,
  }))];
  for (const entry of entries) {
    entry.bytes = fs.statSync(path.join(OUT, entry.file)).size;
    entry.thumbBytes = fs.statSync(path.join(THUMBS, `${entry.id}.webp`)).size;
  }
  fs.writeFileSync(path.join(OUT, 'designs.json'), `${JSON.stringify(entries, null, 1)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { draw, QUALITY, THUMB_WIDTH };
