// Cleans the pictures of an appeal page before they are stored (see src/web/appealImageRoutes.js).
const { createCanvas } = require('@napi-rs/canvas');
const { decode } = require('./safeImage');

// `proof` is a picture a member attaches to an answer: only re-drawn and scaled down, nothing is put behind it.
const MAX_SIDE = { banner: 2048, embed: 2048, icon: 512, proof: 2600 };
const FLATTEN = new Set(['banner', 'embed']);
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Re-draws an upload as a PNG so only pixels are kept (nothing hidden in the file is stored) and scales it down to `maxSide`.
 * A banner or a link-preview picture that has transparent parts is put on a plain background that contrasts with what is visible,
 * because a transparent picture with dark art looked black on the dark pages; a picture that draws as all black is refused
 * instead of stored. The icon and the pictures members attach keep their transparency.
 */
async function prepareImage(buffer, kind) {
  const image = await decode(buffer);
  const maxSide = MAX_SIDE[kind] ?? 2048;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  let canvas = createCanvas(width, height);
  let ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  const data = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(data.length / 4 / 40000)) * 4; // about 40,000 samples are enough
  let hasAlpha = false; let visible = 0; let lightSum = 0; let brightest = 0;
  for (let i = 0; i < data.length; i += step) {
    const a = data[i + 3];
    if (a < 250) hasAlpha = true;
    if (a > 16) { visible += 1; const l = luminance(data[i], data[i + 1], data[i + 2]); lightSum += l; if (l > brightest) brightest = l; }
  }
  if (!visible) throw new Error('empty picture'); // i18n-ignore: internal error, the route answers with a code
  if (FLATTEN.has(kind) && !hasAlpha && brightest < 6) throw new Error('unreadable picture'); // i18n-ignore: internal error, the route answers with a code. All black: it did not decode
  if (FLATTEN.has(kind) && hasAlpha) {
    canvas = createCanvas(width, height);
    ctx = canvas.getContext('2d');
    ctx.fillStyle = lightSum / visible < 110 ? '#ececf1' : '#202126';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
  }
  return { bytes: canvas.toBuffer('image/png'), width, height };
}

module.exports = { prepareImage, MAX_SIDE };
