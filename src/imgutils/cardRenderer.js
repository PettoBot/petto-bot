// Draws an image card (see src/utils/cardSchema.js) to a PNG. It knows nothing about Discord or the database: the
// caller passes the functions that turn text variables into values and pictures into images.
const { createCanvas: napiCreateCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('./cardFonts');

const MAX_TEXT_LINES = 12;

/**
 * deps:
 *  - resolveText(text): the text with its variables filled in, such as {user.display_name}
 *  - loadSource(src):   an image for an https link, an `asset:` id or a variable, or null when it cannot be loaded
 *  - avatar(kind):      the image of the member (`user`) or of the server (`server`), or null
 *  - createCanvas:      only for tests
 */
async function renderCard(card, deps = {}) {
  registerCardFonts();
  const createCanvas = deps.createCanvas ?? napiCreateCanvas;
  const resolveText = deps.resolveText ?? (async (value) => value);
  const loadSource = deps.loadSource ?? (async () => null);
  const avatar = deps.avatar ?? (async () => null);

  const canvas = createCanvas(card.width, card.height);
  const ctx = canvas.getContext('2d');
  await drawBackground(ctx, card, resolveText, loadSource);
  for (const layer of card.layers) {
    ctx.save();
    try {
      ctx.globalAlpha = layer.opacity;
      ctx.translate(layer.x, layer.y);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.type === 'shape') drawShape(ctx, layer);
      else if (layer.type === 'image') await drawImage(ctx, layer, resolveText, loadSource);
      else if (layer.type === 'avatar') drawAvatar(ctx, layer, await avatar(layer.source));
      else if (layer.type === 'bar') await drawBar(ctx, layer, resolveText);
      else if (layer.type === 'text') await drawText(ctx, layer, resolveText);
    } finally {
      ctx.restore();
    }
  }
  return canvas.toBuffer('image/png');
}

function setShadow(ctx, shadow) {
  if (!shadow) return;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.x;
  ctx.shadowOffsetY = shadow.y;
}

function clearShadow(ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function roundedPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Where an image of `iw` by `ih` goes inside a box, for each way of fitting it. */
function fitRect(iw, ih, bx, by, bw, bh, fit) {
  if (fit === 'stretch') return { x: bx, y: by, w: bw, h: bh };
  const scale = fit === 'contain' ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
}

async function drawBackground(ctx, card, resolveText, loadSource) {
  const { background, width, height } = card;
  ctx.fillStyle = background.color;
  ctx.fillRect(0, 0, width, height);
  if (background.gradient) {
    const angle = (background.gradient.angle * Math.PI) / 180;
    const dx = Math.sin(angle) * width / 2;
    const dy = -Math.cos(angle) * height / 2;
    const gradient = ctx.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
    gradient.addColorStop(0, background.gradient.from);
    gradient.addColorStop(1, background.gradient.to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (background.image) {
    const image = await loadSource(await resolveText(background.image.src));
    if (image) {
      const box = fitRect(image.width, image.height, 0, 0, width, height, background.image.fit);
      ctx.save();
      if (background.image.blur > 0) ctx.filter = `blur(${background.image.blur}px)`;
      ctx.drawImage(image, box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
  if (background.overlay) {
    ctx.save();
    ctx.globalAlpha = background.overlay.opacity;
    ctx.fillStyle = background.overlay.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function drawShape(ctx, layer) {
  setShadow(ctx, layer.shadow);
  ctx.fillStyle = layer.fill;
  if (layer.shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundedPath(ctx, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.radius);
  }
  ctx.fill();
  clearShadow(ctx);
  if (layer.stroke) {
    ctx.strokeStyle = layer.stroke.color;
    ctx.lineWidth = layer.stroke.width;
    ctx.stroke();
  }
}

async function drawImage(ctx, layer, resolveText, loadSource) {
  if (!layer.src) return;
  const image = await loadSource(await resolveText(layer.src));
  if (!image) return;
  setShadow(ctx, layer.shadow);
  if (layer.shadow) {
    // The shadow is cast by a filled shape of the same outline, because a clipped image casts none.
    roundedPath(ctx, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.radius);
    ctx.fillStyle = '#000000';
    ctx.fill();
    clearShadow(ctx);
  }
  ctx.save();
  roundedPath(ctx, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.radius);
  ctx.clip();
  const box = fitRect(image.width, image.height, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.fit);
  ctx.drawImage(image, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** A progress bar: a track and a fill as wide as `value` percent of it. `value` is a number or a variable that gives one. */
async function drawBar(ctx, layer, resolveText) {
  const parsed = parseFloat(String(await resolveText(layer.value ?? '')).replace(',', '.'));
  const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  const left = -layer.w / 2;
  const top = -layer.h / 2;
  setShadow(ctx, layer.shadow);
  ctx.save();
  ctx.globalAlpha *= layer.trackOpacity;
  ctx.fillStyle = layer.track;
  roundedPath(ctx, left, top, layer.w, layer.h, layer.radius);
  ctx.fill();
  ctx.restore();
  clearShadow(ctx);
  const filled = (layer.w * percent) / 100;
  if (filled <= 0) return;
  ctx.save();
  // The fill is clipped to the track, so a short fill keeps the round end of the track instead of a squashed one.
  roundedPath(ctx, left, top, layer.w, layer.h, layer.radius);
  ctx.clip();
  if (layer.fill2) {
    const gradient = ctx.createLinearGradient(left, 0, left + layer.w, 0);
    gradient.addColorStop(0, layer.fill);
    gradient.addColorStop(1, layer.fill2);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = layer.fill;
  }
  roundedPath(ctx, left, top, filled, layer.h, Math.min(layer.radius, filled / 2));
  ctx.fill();
  ctx.restore();
}

function avatarPath(ctx, layer) {
  const half = layer.size / 2;
  if (layer.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, half, 0, Math.PI * 2);
  } else {
    roundedPath(ctx, -half, -half, layer.size, layer.size, layer.shape === 'rounded' ? layer.size * 0.22 : 0);
  }
}

function drawAvatar(ctx, layer, image) {
  if (layer.shadow) {
    setShadow(ctx, layer.shadow);
    avatarPath(ctx, layer);
    ctx.fillStyle = '#000000';
    ctx.fill();
    clearShadow(ctx);
  }
  ctx.save();
  avatarPath(ctx, layer);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, -layer.size / 2, -layer.size / 2, layer.size, layer.size);
  } else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(-layer.size / 2, -layer.size / 2, layer.size, layer.size);
  }
  ctx.restore();
  if (layer.border) {
    ctx.save();
    avatarPath(ctx, layer);
    ctx.strokeStyle = layer.border.color;
    ctx.lineWidth = layer.border.width * 2;
    ctx.save();
    // Only the half of the line that falls outside the avatar is kept, so the border grows outward.
    ctx.beginPath();
    ctx.rect(-layer.size, -layer.size, layer.size * 2, layer.size * 2);
    avatarPath(ctx, layer);
    ctx.clip('evenodd');
    avatarPath(ctx, layer);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
}

/** Breaks a text into lines that fit `maxWidth`. A single word longer than the width stays on its line. */
function wrapLines(ctx, value, maxWidth) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
    if (!maxWidth) { lines.push(paragraph); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(attempt).width > maxWidth) { lines.push(line); line = word; } else { line = attempt; }
    }
    lines.push(line);
  }
  return lines.slice(0, MAX_TEXT_LINES);
}

async function drawText(ctx, layer, resolveText) {
  let value = await resolveText(layer.text);
  if (layer.upper) value = value.toUpperCase();
  if (!value) return;
  ctx.font = canvasFont(layer.font, layer.weight, layer.size);
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.spacing}px`;
  const lines = wrapLines(ctx, value.replace(/\r/g, ''), layer.w);
  const lineHeight = layer.size * layer.lineHeight;
  const top = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    if (layer.stroke) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width * 2;
      ctx.strokeText(line, 0, y);
    }
    setShadow(ctx, layer.shadow);
    ctx.fillStyle = layer.color;
    ctx.fillText(line, 0, y);
    clearShadow(ctx);
  });
}

module.exports = { renderCard, fitRect, wrapLines };
