// The saved form of an image card, and the checks that keep it inside what the renderer can draw safely.
// A card is plain JSON: a size, a background and a list of layers drawn from the first to the last.
const { fontExists, isPremiumFont, DEFAULT_FONT } = require('../imgutils/cardFonts');
const { normalizeBasic, buildBasicLayers } = require('./cardPresets');

const LIMITS = {
  minWidth: 400, maxWidth: 1600, minHeight: 160, maxHeight: 900,
  layersBasic: 12, layersAdvanced: 40,
  text: 300, src: 500, id: 40,
  coordinate: 4000, size: 4000, fontMin: 8, fontMax: 400,
};
const DEFAULT_SIZE = { width: 1024, height: 500 };
const LAYER_TYPES = new Set(['text', 'image', 'avatar', 'shape', 'bar']);
const RANK_SIZE = { width: 1024, height: 320 };
const AVATAR_SOURCES = new Set(['user', 'server']);
const AVATAR_SHAPES = new Set(['circle', 'rounded', 'square']);
const FITS = new Set(['cover', 'contain', 'stretch']);
const ALIGNS = new Set(['left', 'center', 'right']);
const WEIGHTS = [400, 700, 800];

const HEX = /^#[0-9a-f]{6}$/i;
const num = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const color = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (HEX.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  return fallback;
};
const text = (value, max) => String(value ?? '').slice(0, max);
const bool = (value) => value === true || value === 'true' || value === 1;

/** A background or layer image: an https link, a variable such as {user.avatar}, or `asset:<id>` for an uploaded file. */
function source(value) {
  const src = text(value, LIMITS.src).trim();
  if (!src) return '';
  if (/^asset:\d{1,18}$/.test(src) || /^\{[a-z0-9_.]+\}$/i.test(src) || /^https:\/\/\S+$/i.test(src)) return src;
  return '';
}

function stroke(value) {
  if (!value || typeof value !== 'object') return null;
  const width = num(value.width, 0, 40, 0);
  return width > 0 ? { color: color(value.color, '#000000'), width } : null;
}

function shadow(value) {
  if (!value || typeof value !== 'object') return null;
  const blur = num(value.blur, 0, 60, 0);
  const x = num(value.x, -60, 60, 0);
  const y = num(value.y, -60, 60, 0);
  if (!blur && !x && !y) return null;
  return { color: color(value.color, '#000000'), blur, x, y };
}

function normalizeLayer(raw, index, problems) {
  if (!raw || typeof raw !== 'object' || !LAYER_TYPES.has(raw.type)) {
    problems.push(`Layer ${index + 1} has an unknown type and was left out.`);
    return null;
  }
  const base = {
    id: text(raw.id || `layer-${index + 1}`, LIMITS.id).replace(/[^a-zA-Z0-9_-]/g, '-'),
    type: raw.type,
    x: num(raw.x, -LIMITS.coordinate, LIMITS.coordinate, 0),
    y: num(raw.y, -LIMITS.coordinate, LIMITS.coordinate, 0),
    rotation: num(raw.rotation, -360, 360, 0),
    opacity: num(raw.opacity, 0, 1, 1),
  };
  if (raw.type === 'text') {
    const family = fontExists(raw.font) ? raw.font : DEFAULT_FONT;
    const weight = WEIGHTS.includes(Number(raw.weight)) ? Number(raw.weight) : 700;
    return {
      ...base,
      text: text(raw.text, LIMITS.text),
      size: num(raw.size, LIMITS.fontMin, LIMITS.fontMax, 48),
      font: family,
      weight,
      color: color(raw.color, '#ffffff'),
      align: ALIGNS.has(raw.align) ? raw.align : 'center',
      w: num(raw.w, 0, LIMITS.size, 0),
      lineHeight: num(raw.lineHeight, 0.8, 2.5, 1.15),
      spacing: num(raw.spacing, -5, 40, 0),
      upper: bool(raw.upper),
      stroke: stroke(raw.stroke),
      shadow: shadow(raw.shadow),
    };
  }
  if (raw.type === 'avatar') {
    return {
      ...base,
      source: AVATAR_SOURCES.has(raw.source) ? raw.source : 'user',
      size: num(raw.size, 16, 1200, 200),
      shape: AVATAR_SHAPES.has(raw.shape) ? raw.shape : 'circle',
      border: stroke(raw.border),
      shadow: shadow(raw.shadow),
    };
  }
  if (raw.type === 'image') {
    const src = source(raw.src);
    if (!src) problems.push(`The image in layer ${index + 1} needs an https link, an uploaded file or a variable such as {user.avatar}.`);
    return {
      ...base,
      src,
      w: num(raw.w, 4, LIMITS.size, 200),
      h: num(raw.h, 4, LIMITS.size, 200),
      fit: FITS.has(raw.fit) ? raw.fit : 'cover',
      radius: num(raw.radius, 0, 2000, 0),
      shadow: shadow(raw.shadow),
    };
  }
  if (raw.type === 'bar') {
    const h = num(raw.h, 2, 500, 30);
    return {
      ...base,
      w: num(raw.w, 4, LIMITS.size, 500),
      h,
      radius: num(raw.radius, 0, 2000, h / 2),
      fill: color(raw.fill, '#8399ff'),
      fill2: raw.fill2 ? color(raw.fill2, '') : '',
      track: color(raw.track, '#000000'),
      trackOpacity: num(raw.trackOpacity, 0, 1, 0.45),
      // A number, or a variable such as {level_progress} that the renderer turns into one, 0 to 100.
      value: text(raw.value ?? '{level_progress}', 40),
      shadow: shadow(raw.shadow),
    };
  }
  return {
    ...base,
    shape: raw.shape === 'circle' ? 'circle' : 'rect',
    w: num(raw.w, 1, LIMITS.size, 200),
    h: num(raw.h, 1, LIMITS.size, 100),
    fill: color(raw.fill, '#ffffff'),
    radius: num(raw.radius, 0, 2000, 0),
    stroke: stroke(raw.stroke),
    shadow: shadow(raw.shadow),
  };
}

function normalizeBackground(raw, problems) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const background = { color: color(input.color, '#1e1f22'), gradient: null, image: null, overlay: null };
  if (input.gradient && typeof input.gradient === 'object') {
    background.gradient = { from: color(input.gradient.from, '#5865f2'), to: color(input.gradient.to, '#eb459e'), angle: num(input.gradient.angle, 0, 360, 135) };
  }
  if (input.image && typeof input.image === 'object') {
    const src = source(input.image.src);
    if (input.image.src && !src) problems.push('The background image needs an https link or an uploaded file.');
    if (src) background.image = { src, fit: FITS.has(input.image.fit) ? input.image.fit : 'cover', blur: num(input.image.blur, 0, 24, 0) };
  }
  if (input.overlay && typeof input.overlay === 'object') {
    const opacity = num(input.overlay.opacity, 0, 1, 0);
    if (opacity > 0) background.overlay = { color: color(input.overlay.color, '#000000'), opacity };
  }
  return background;
}

/**
 * Cleans a card to the limits. Nothing throws: what is not valid is dropped or put back to a default, and described
 * in `problems`. `premium` says whether the server can use the advanced editor and every font.
 * `usesAdvanced` tells whether the card needs Premium, so the dashboard can refuse to save it for a free server.
 */
function normalizeCard(raw, { premium = false } = {}) {
  const problems = [];
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = input.mode === 'advanced' ? 'advanced' : 'basic';
  // A rank card shows the level and a progress bar; every other card is a welcome-style picture.
  const kind = input.kind === 'rank' ? 'rank' : 'welcome';
  const fallbackSize = kind === 'rank' ? RANK_SIZE : DEFAULT_SIZE;
  const card = {
    v: 1,
    kind,
    mode,
    width: Math.round(num(input.width, LIMITS.minWidth, LIMITS.maxWidth, fallbackSize.width)),
    height: Math.round(num(input.height, LIMITS.minHeight, LIMITS.maxHeight, fallbackSize.height)),
    background: normalizeBackground(input.background, problems),
    layers: [],
  };
  const maxLayers = mode === 'advanced' ? LIMITS.layersAdvanced : LIMITS.layersBasic;
  // A basic card is its settings: the layers always come from the presets, never from what was sent.
  if (mode === 'basic') card.basic = normalizeBasic(input.basic, kind);
  const rawLayers = mode === 'basic' ? buildBasicLayers(card.basic, card.width, card.height, kind) : (Array.isArray(input.layers) ? input.layers : []);
  if (rawLayers.length > maxLayers) problems.push(`A card holds at most ${maxLayers} layers, the rest were left out.`);
  const seen = new Set();
  rawLayers.slice(0, maxLayers).forEach((layer, index) => {
    const clean = normalizeLayer(layer, index, problems);
    if (!clean) return;
    while (seen.has(clean.id)) clean.id = `${clean.id}-${seen.size + 1}`;
    seen.add(clean.id);
    card.layers.push(clean);
  });
  const usesPremiumFont = card.layers.some((layer) => layer.type === 'text' && isPremiumFont(layer.font));
  const usesAdvanced = mode === 'advanced' || usesPremiumFont;
  if (usesAdvanced && !premium) problems.push('This card uses the advanced editor or a Premium font, which needs Premium.');
  return { card, problems, usesAdvanced, usesPremiumFont };
}

module.exports = { LIMITS, DEFAULT_SIZE, RANK_SIZE, normalizeCard, color, source };
