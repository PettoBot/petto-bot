const { createCanvas } = require('@napi-rs/canvas');
const { loadImageFromLink } = require('./safeImage');

const SIZE = 32;

/** The color most of an image's pixels share, as a number, favoring vivid colors over grays. Null when it cannot be read. */
async function dominantColor(link) {
  const image = link ? await loadImageFromLink(link) : null;
  return image ? dominantColorOf(image) : null;
}

/** The same for an image (or canvas) already loaded. Null when every pixel is near black, near white or transparent. */
function dominantColorOf(image) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    if (light < 0.08 || light > 0.95) continue; // near black or near white says little about the picture
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 };
    bucket.weight += 0.25 + saturation; // vivid pixels count for more than gray ones
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  if (!best) return null;
  return (Math.round(best.r / best.n) << 16) | (Math.round(best.g / best.n) << 8) | Math.round(best.b / best.n);
}

module.exports = { dominantColor, dominantColorOf };
