// Draws an image card (see src/utils/cardSchema.js) to a PNG. It knows nothing about Discord or the database: the
// caller passes the functions that turn text variables into values and pictures into images.
const { createCanvas: napiCreateCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('./cardFonts');
const { encodeApng } = require('./apng');

const MAX_TEXT_LINES = 12;
// An animated card is an APNG: a message takes up to 10 MB, and a card that moves is kept well under that.
const MAX_FRAMES = 40;
const MAX_ANIMATED_BYTES = 7 * 1024 * 1024;

/**
 * deps:
 *  - resolveText(text): the text with its variables filled in, such as {user.display_name}
 *  - loadSource(src):   an image for an https link, an `asset:` id or a variable, or null when it cannot be loaded
 *  - loadFrames(src):   only when a picture may move: the frames of an animated picture as `[{ canvas, delayMs }]`, or null for a still one
 *  - avatar(kind):      the image of the member (`user`) or of the server (`server`), or null
 *  - createCanvas:      only for tests
 */
async function renderCard(card, deps = {}) {
  registerCardFonts();
  const createCanvas = deps.createCanvas ?? napiCreateCanvas;
  const resolveText = deps.resolveText ?? (async (value) => value);
  let loadSource = deps.loadSource ?? (async () => null);
  let avatar = deps.avatar ?? (async () => null);

  const motion = deps.loadFrames ? await findMotion(card, resolveText, deps.loadFrames) : null;
  if (motion) {
    // The card is drawn once for every frame, so what it loads is loaded once.
    const pictures = new Map();
    const once = (load) => async (key) => { if (!pictures.has(key)) pictures.set(key, load(key)); return pictures.get(key); };
    loadSource = once(loadSource);
    avatar = once(avatar);
  }

  /** The whole card with `frame` (a picture) in the place of the layer that moves, and where that layer was drawn. */
  const paint = async (frame = null) => {
    const canvas = createCanvas(card.width, card.height);
    const ctx = canvas.getContext('2d');
    await drawBackground(ctx, card, resolveText, loadSource);
    // The right edge of every layer that was drawn, by id, for the layers that follow one.
    const edges = new Map();
    let box = null;
    for (const layer of card.layers) {
      if (layer.showIf && !String(await resolveText(layer.showIf)).trim()) continue;
      let x = layer.x;
      const anchor = layer.follow ? layer.follow.split(',').find((id) => edges.has(id)) : null;
      if (anchor) x = edges.get(anchor) + layer.gap + leftReach(layer);
      ctx.save();
      try {
        ctx.globalAlpha = layer.opacity;
        ctx.translate(x, layer.y);
        if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
        let right = null;
        if (layer.type === 'shape') { drawShape(ctx, layer); right = x + layer.w / 2; }
        else if (layer.type === 'image') {
          const moving = frame && layer.id === motion.layerId;
          if (await drawImage(ctx, layer, resolveText, moving ? async () => frame : loadSource)) {
            right = x + layer.w / 2;
            if (moving) box = { x: x - layer.w / 2, y: layer.y - layer.h / 2, w: layer.w, h: layer.h };
          }
        }
        else if (layer.type === 'avatar') { drawAvatar(ctx, layer, await avatar(layer.source)); right = x + layer.size / 2; }
        else if (layer.type === 'bar') { await drawBar(ctx, layer, resolveText); right = x + layer.w / 2; }
        else if (layer.type === 'text') { const width = await drawText(ctx, layer, resolveText); if (width !== null) right = x + rightReach(layer, width); }
        if (right !== null) edges.set(layer.id, right);
      } finally {
        ctx.restore();
      }
    }
    return { canvas, box };
  };

  if (!motion) return (await paint()).canvas.toBuffer('image/png');

  // A picture that moves: the first frame is the whole card, and each next one is only the square around that picture.
  const still = await paint(motion.frames[0].canvas);
  if (!still.box) return (await paint()).canvas.toBuffer('image/png');
  const pad = 2;
  const left = Math.max(0, Math.floor(still.box.x) - pad);
  const top = Math.max(0, Math.floor(still.box.y) - pad);
  const region = {
    x: left, y: top,
    w: Math.min(card.width, Math.ceil(still.box.x + still.box.w) + pad) - left,
    h: Math.min(card.height, Math.ceil(still.box.y + still.box.h) + pad) - top,
  };
  const parts = [];
  for (const frame of motion.frames.slice(1)) {
    const next = await paint(frame.canvas);
    const piece = createCanvas(region.w, region.h);
    piece.getContext('2d').drawImage(next.canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
    parts.push({ png: piece.toBuffer('image/png'), x: region.x, y: region.y, delayMs: frame.delayMs });
  }
  const animated = encodeApng({ png: still.canvas.toBuffer('image/png'), delayMs: motion.frames[0].delayMs }, parts);
  // A card too big for a message goes out still.
  return animated.length <= MAX_ANIMATED_BYTES ? animated : (await paint()).canvas.toBuffer('image/png');
}

/**
 * The layer of a card that moves and its frames, or null. A picture layer with `animate` moves when its picture is an animation
 * (`loadFrames` gives its frames, or null for a still one). Only a plain layer is animated: not turned, no shadow. Long
 * animations are cut down to `MAX_FRAMES` frames.
 */
async function findMotion(card, resolveText, loadFrames) {
  for (const layer of card.layers) {
    if (layer.type !== 'image' || !layer.animate || layer.rotation || layer.shadow || !layer.src) continue;
    if (layer.showIf && !String(await resolveText(layer.showIf)).trim()) continue;
    const frames = await loadFrames(await resolveText(layer.src));
    if (!frames || frames.length < 2) continue;
    const step = Math.max(1, Math.ceil(frames.length / MAX_FRAMES));
    const picked = [];
    for (let at = 0; at < frames.length; at += step) {
      const group = frames.slice(at, at + step);
      picked.push({ canvas: group[0].canvas, delayMs: group.reduce((sum, f) => sum + f.delayMs, 0) });
    }
    return { layerId: layer.id, frames: picked };
  }
  return null;
}

/** How far a layer reaches to the left of its x, so a layer that follows another one starts after it (shapes and pictures are centered, a text with a pill starts at its padding). */
function leftReach(layer) {
  if (layer.type === 'shape' || layer.type === 'image' || layer.type === 'bar') return layer.w / 2;
  if (layer.type === 'avatar') return layer.size / 2;
  return layer.type === 'text' && layer.align === 'left' && layer.pill ? layer.pill.padX : 0;
}
/** How far a text of `width` reaches to the right of its x (with the padding of its pill). */
function rightReach(layer, width) {
  const pad = layer.pill ? layer.pill.padX : 0;
  if (layer.align === 'center') return width / 2 + pad;
  if (layer.align === 'right') return pad;
  return width + pad;
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

/** A hexagon with its point up that fills `w` by `h`, with its corners rounded by `radius`. */
function hexagonPath(ctx, w, h, radius) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push([Math.cos(angle) * (w / 2), Math.sin(angle) * (h / 2)]);
  }
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 4));
  ctx.beginPath();
  points.forEach((point, i) => {
    const prev = points[(i + 5) % 6];
    const next = points[(i + 1) % 6];
    const toward = (a, b, d) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; return [a[0] + (dx / len) * d, a[1] + (dy / len) * d]; };
    const start = toward(point, prev, r);
    const end = toward(point, next, r);
    if (i === 0) ctx.moveTo(start[0], start[1]); else ctx.lineTo(start[0], start[1]);
    ctx.quadraticCurveTo(point[0], point[1], end[0], end[1]);
  });
  ctx.closePath();
}

function drawShape(ctx, layer) {
  setShadow(ctx, layer.shadow);
  ctx.fillStyle = layer.fill;
  if (layer.shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
  } else if (layer.shape === 'hexagon') {
    hexagonPath(ctx, layer.w, layer.h, layer.radius);
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
  if (!layer.src) return false;
  const image = await loadSource(await resolveText(layer.src));
  if (!image) return false;
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
  return true;
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

/** The first `max` lines, with the last one shortened (and an ellipsis at its end) so that it fits `maxWidth`. */
function ellipsize(ctx, lines, max, maxWidth) {
  const kept = lines.slice(0, max);
  let last = `${kept[max - 1]}…`;
  while (maxWidth && last.length > 1 && ctx.measureText(last).width > maxWidth) last = `${last.slice(0, -2).trimEnd()}…`;
  kept[max - 1] = last;
  return kept;
}

/** Draws a text and gives back the width of its widest line, or null when there was nothing to draw. */
async function drawText(ctx, layer, resolveText) {
  let value = await resolveText(layer.text);
  if (layer.upper) value = value.toUpperCase();
  if (!value) return null;
  ctx.font = canvasFont(layer.font, layer.weight, layer.size);
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.spacing}px`;
  let lines = wrapLines(ctx, value.replace(/\r/g, ''), layer.w);
  if (layer.maxLines > 0 && lines.length > layer.maxLines) lines = ellipsize(ctx, lines, layer.maxLines, layer.w);
  const lineHeight = layer.size * layer.lineHeight;
  const top = -((lines.length - 1) * lineHeight) / 2;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  if (layer.pill) {
    const { padX, padY } = layer.pill;
    const boxW = width + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2 - (lineHeight - layer.size);
    const left = layer.align === 'center' ? -boxW / 2 : layer.align === 'right' ? -width - padX : -padX;
    ctx.save();
    ctx.globalAlpha *= layer.pill.opacity;
    ctx.fillStyle = layer.pill.color;
    roundedPath(ctx, left, -boxH / 2, boxW, boxH, layer.pill.radius);
    ctx.fill();
    ctx.restore();
  }
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
  return width;
}

module.exports = { renderCard, fitRect, wrapLines };
