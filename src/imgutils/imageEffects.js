// i18n-ignore-file: draws pictures; the only words drawn are a color code
// The effects of !image: each one takes a decoded image and gives back the new picture as PNG (JPEG for the ones whose point is
// the JPEG look). Pictures are first fitted inside MAX_SIDE pixels so no effect works on more than about four million pixels.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('./cardFonts');
const { dominantColorOf } = require('../utils/dominantColor');

const MAX_SIDE = 2048;

/** The size of a picture fitted inside `max` pixels on its longer side, never enlarged. */
function fitSize(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A canvas with the image drawn on it at its fitted size, with an optional canvas filter. */
function base(image, filter = null) {
  const { width, height } = fitSize(image.width, image.height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (filter) ctx.filter = filter;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

/** The image on a plain background, for JPEG (which has no transparency). */
function flatten(source, color = '#ffffff') {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/**
 * Every effect: `amount` says what its number means (null when it takes none) with its range and default; `draw(image, amount)`
 * returns a canvas, and `format` is the file it is saved as.
 */
const EFFECTS = {
  invert: { draw: (image) => base(image, 'invert(1)') },
  grayscale: { draw: (image) => base(image, 'grayscale(1)') },
  sepia: { draw: (image) => base(image, 'sepia(1) contrast(1.05)') },
  blur: {
    amount: { min: 1, max: 50, fallback: 8 },
    draw: (image, amount) => {
      const { width, height } = fitSize(image.width, image.height);
      // The number means the same blur on a small avatar and on a large photo: it is measured on a 512 pixel picture.
      const radius = Math.max(0.5, (amount * Math.max(width, height)) / 512);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.filter = `blur(${radius.toFixed(1)}px)`;
      ctx.drawImage(image, 0, 0, width, height);
      return canvas;
    },
  },
  pixelate: {
    amount: { min: 2, max: 100, fallback: 12 },
    draw: (image, amount) => {
      const { width, height } = fitSize(image.width, image.height);
      const block = Math.max(2, Math.round((amount * Math.max(width, height)) / 512));
      const small = createCanvas(Math.max(1, Math.ceil(width / block)), Math.max(1, Math.ceil(height / block)));
      const sctx = small.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(image, 0, 0, small.width, small.height);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width * block, small.height * block);
      return canvas;
    },
  },
  rotate: {
    amount: { min: -360, max: 360, fallback: 90 },
    draw: (image, amount) => {
      const { width, height } = fitSize(image.width, image.height);
      const angle = (amount * Math.PI) / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      // Right angles give exact sizes; other angles get the box that holds the whole turned picture.
      const round = (value) => Math.max(1, Math.round(value - 1e-6));
      const outWidth = round(width * cos + height * sin);
      const outHeight = round(width * sin + height * cos);
      const canvas = createCanvas(outWidth, outHeight);
      const ctx = canvas.getContext('2d');
      ctx.translate(outWidth / 2, outHeight / 2);
      ctx.rotate(angle);
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
      return canvas;
    },
  },
  flip: {
    draw: (image) => {
      const { width, height } = fitSize(image.width, image.height);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.translate(0, height);
      ctx.scale(1, -1);
      ctx.drawImage(image, 0, 0, width, height);
      return canvas;
    },
  },
  mirror: {
    draw: (image) => {
      const { width, height } = fitSize(image.width, image.height);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0, width, height);
      return canvas;
    },
  },
  circle: {
    draw: (image) => {
      const { width, height } = fitSize(image.width, image.height);
      const side = Math.min(width, height);
      const canvas = createCanvas(side, side);
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const scale = side / Math.min(image.width, image.height);
      ctx.drawImage(image, (side - image.width * scale) / 2, (side - image.height * scale) / 2, image.width * scale, image.height * scale);
      return canvas;
    },
  },
  deepfry: {
    format: 'jpeg',
    quality: 12,
    draw: (image) => {
      // Smaller first: the low quality JPEG then shows its blocks, which is the whole point.
      const { width, height } = fitSize(image.width, image.height, 768);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.filter = 'saturate(4) contrast(2.2) brightness(1.15)';
      ctx.drawImage(image, 0, 0, width, height);
      ctx.filter = 'none';
      // A warm, burnt cast...
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(255, 90, 0, 0.45)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
      // ...and grain, from a fixed sequence so the same picture fries the same way.
      const data = ctx.getImageData(0, 0, width, height);
      let seed = 1234567;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const noise = ((seed >> 16) % 61) - 30;
        data.data[i] += noise;
        data.data[i + 1] += noise;
        data.data[i + 2] += noise;
      }
      ctx.putImageData(data, 0, 0);
      return canvas;
    },
  },
  compress: {
    format: 'jpeg',
    amount: { min: 1, max: 100, fallback: 5 },
    draw: (image) => flatten(base(image)),
  },
};

const EFFECT_NAMES = Object.keys(EFFECTS);

/** The number an effect uses: the one given, kept inside its range, or its default. Null for an effect that takes none. */
function effectAmount(name, value) {
  const range = EFFECTS[name]?.amount;
  if (!range) return null;
  return Math.round(clampNumber(value, range.min, range.max, range.fallback));
}

/** Applies an effect: `{ buffer, format, width, height }`, the format being `png` or `jpeg`. */
async function applyEffect(name, image, value) {
  const effect = EFFECTS[name];
  if (!effect) throw new Error(`Unknown effect: ${name}`);
  const amount = effectAmount(name, value);
  const canvas = effect.draw(image, amount);
  const format = effect.format ?? 'png';
  const quality = name === 'compress' ? amount : effect.quality ?? 80;
  const buffer = format === 'jpeg' ? await flatten(canvas).encode('jpeg', quality) : await canvas.encode('png');
  return { buffer, format, width: canvas.width, height: canvas.height };
}

/** The average color of an image, for a picture with no vivid color (all gray, black or white). */
function averageColor(image) {
  const canvas = createCanvas(16, 16);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, 16, 16);
  const { data } = ctx.getImageData(0, 0, 16, 16);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  }
  if (!n) return 0;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** The main color of an image as a number: its dominant vivid color, or its average when it has none. */
function mainColor(image) {
  return dominantColorOf(image) ?? averageColor(image);
}

const hexOf = (color) => `#${color.toString(16).padStart(6, '0').toUpperCase()}`;

/** A picture of the color: the image in a rounded square next to a swatch of its main color with the code written on it. */
async function renderSwatch(image, color) {
  registerCardFonts();
  const W = 900;
  const H = 360;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const ink = luminance > 0.6 ? '#111111' : '#ffffff';
  ctx.fillStyle = hexOf(color);
  ctx.fillRect(0, 0, W, H);

  // The picture, as a rounded square with a soft shadow.
  const side = 260;
  const x = 50;
  const y = (H - side) / 2;
  const rounded = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, side, side, 28);
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = hexOf(color);
  rounded();
  ctx.fill();
  ctx.restore();
  ctx.save();
  rounded();
  ctx.clip();
  const crop = Math.min(image.width, image.height);
  ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, x, y, side, side);
  ctx.restore();

  const textX = x + side + 50;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  ctx.font = canvasFont('Montserrat', 800, 84);
  ctx.fillText(hexOf(color), textX, H / 2 + 6);
  ctx.globalAlpha = 0.75;
  ctx.font = canvasFont('Montserrat', 400, 32);
  ctx.fillText(`rgb(${r}, ${g}, ${b})`, textX, H / 2 + 60);
  ctx.globalAlpha = 1;
  return canvas.encode('png');
}

module.exports = { EFFECTS, EFFECT_NAMES, MAX_SIDE, fitSize, effectAmount, applyEffect, mainColor, renderSwatch, hexOf };
