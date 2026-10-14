// The dominant color favors the vivid color of a picture over a gray background and ignores near black or white.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.join(__dirname, '..');
const safe = require.resolve(path.join(root, 'src/utils/safeImage.js'));
const images = new Map();
require.cache[safe] = { id: safe, filename: safe, loaded: true, exports: { loadImageFromLink: async (l) => images.get(l) ?? null } };
const { dominantColor } = require(path.join(root, 'src/utils/dominantColor.js'));

function picture(paint) { const c = createCanvas(64, 64); paint(c.getContext('2d')); return c; }
(async () => {
  images.set('red', picture((x) => { x.fillStyle = '#333'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#e03030'; x.fillRect(0, 0, 40, 64); }));
  const red = await dominantColor('red');
  assert.ok(((red >> 16) & 255) > 200 && ((red >> 8) & 255) < 90, 'vivid red wins over gray');
  images.set('white', picture((x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); }));
  assert.equal(await dominantColor('white'), null);
  assert.equal(await dominantColor('missing'), null);
  assert.equal(await dominantColor(null), null);
  console.log('dominant color OK');
})();
