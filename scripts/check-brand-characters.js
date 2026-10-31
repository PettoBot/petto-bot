// Checks the nine brand characters (scripts/make-brand-characters.js): each one is drawn alone on a transparent canvas, with fully
// transparent corners and a clear margin all around, nothing cut at the edge, something actually drawn, and the same size as the others.
const assert = require('node:assert/strict');
const { renderCharacter, renderSheet, opaqueBox, characters } = require('./make-brand-characters');

// A small scale is enough to check the shapes; the margin is the clear border (pixels) the pictures must keep.
const SCALE = 1;
const MARGIN = 8;
// How far from the middle height of the nine a character may be: they are different animals, so their heights differ, but not by much.
const HEIGHT_TOLERANCE = 0.3;
const IDS = ['pipo', 'luna', 'chispa', 'nube', 'bambu', 'lili', 'miel', 'copo', 'bellota'];

assert.deepEqual(characters.map((character) => character.id), IDS, 'the nine characters, in order');

const heights = [];
const rendered = [];
for (const character of characters) {
  const { canvas, box } = renderCharacter(character, { scale: SCALE, margin: MARGIN });
  rendered.push({ character, canvas, box });
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const alpha = (x, y) => data[(y * width + x) * 4 + 3];
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) assert.equal(alpha(x, y), 0, `${character.id}: the corner (${x}, ${y}) is not transparent`);
  const found = opaqueBox(canvas);
  assert.ok(found && found.w > 0 && found.h > 0, `${character.id}: nothing is drawn`);
  assert.ok(found.x >= MARGIN && found.y >= MARGIN && found.x + found.w <= width - MARGIN && found.y + found.h <= height - MARGIN, `${character.id}: the drawing is closer than ${MARGIN}px to the edge`);
  assert.ok(found.w > 100 && found.h > 100, `${character.id}: the drawing is too small (${found.w}x${found.h})`);
  // Something solid, not just a faint shadow: a good part of the box is opaque.
  let solid = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 255) solid += 1;
  assert.ok(solid > found.w * found.h * 0.25, `${character.id}: too little is drawn`);
  heights.push({ id: character.id, h: found.h });
}

const sorted = heights.map((item) => item.h).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
for (const { id, h } of heights) assert.ok(Math.abs(h - median) <= median * HEIGHT_TOLERANCE, `${id}: its height (${h}) is not close to the others (median ${median})`);

// The contact sheet draws.
const sheet = renderSheet(rendered);
assert.ok(sheet.width > 0 && sheet.height > 0);

console.log('Brand characters OK');
