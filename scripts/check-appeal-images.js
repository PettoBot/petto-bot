// The pictures of an appeal page: a transparent picture is put on a background that shows it, an icon keeps its transparency,
// and a picture that draws as all black is refused instead of stored.
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { prepareImage } = require('../src/utils/appealImage');

const make = (fill, { transparent = false, size = 300 } = {}) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!transparent) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size); }
  ctx.fillStyle = fill;
  ctx.fillRect(size / 4, size / 4, size / 2, size / 2);
  return canvas.toBuffer('image/png');
};
async function pixel(png, x, y) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data];
}

(async () => {
  // Dark art on a transparent picture: the banner gets a light background (before, it looked black on the dark page).
  const dark = await prepareImage(make('#101015', { transparent: true }), 'banner');
  assert.deepEqual(await pixel(dark.bytes, 5, 5), [236, 236, 241, 255], 'light background behind dark art');
  // Light art: a dark background.
  const light = await prepareImage(make('#f5f5f5', { transparent: true }), 'embed');
  assert.deepEqual(await pixel(light.bytes, 5, 5), [32, 33, 38, 255], 'dark background behind light art');
  // The icon keeps its transparency.
  const icon = await prepareImage(make('#101015', { transparent: true }), 'icon');
  assert.equal((await pixel(icon.bytes, 5, 5))[3], 0, 'the icon stays transparent');
  // An opaque picture is not touched.
  const photo = await prepareImage(make('#ff3333'), 'banner');
  assert.deepEqual(await pixel(photo.bytes, 150, 150), [255, 51, 51, 255]);
  assert.deepEqual(await pixel(photo.bytes, 5, 5), [128, 128, 128, 255]);
  // Big pictures are scaled down.
  const big = await prepareImage(make('#33aaff', { size: 4000 }), 'icon');
  assert.equal(Math.max(big.width, big.height), 512);
  // All black, and an empty picture, are refused.
  const black = createCanvas(200, 200); const bctx = black.getContext('2d'); bctx.fillStyle = '#000'; bctx.fillRect(0, 0, 200, 200);
  await assert.rejects(prepareImage(black.toBuffer('image/png'), 'banner'), /unreadable/);
  await assert.rejects(prepareImage(createCanvas(50, 50).toBuffer('image/png'), 'banner'), /empty/);
  console.log('Checked the pictures of the appeal page: transparent ones, icons, big ones and black ones.');
})().catch((err) => { console.error(err); process.exit(1); });
