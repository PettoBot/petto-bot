// The layouts of the basic editor. A basic card keeps a few settings (`basic`) and the layers are built from them,
// so a free server cannot save layers the basic editor does not offer. The dashboard builds the same layers for its
// preview from the same rules, and a test pins the result for every preset.

const PRESETS = ['classic', 'side', 'bars', 'panel'];
// The layouts of a rank card: they show the level, the rank and a progress bar.
const RANK_PRESETS = ['rank', 'rankBottom', 'levelup'];
// The defaults below are the dashboard's starting values and are pinned by scripts/fixtures/card-presets.json, so they stay in
// English here; the cards the bot draws without texts of their own get them translated (utils/cardService.js, embeds.card.*).
const RANK_DEFAULTS = {
  preset: 'rank',
  title: 'LEVEL {level}',
  name: '{user.display_name}',
  subtitle: '{level_xp_current} / {level_xp_needed} XP', // i18n-ignore: variables and XP, nothing to translate
  extra: 'RANK #{level_rank}', // i18n-ignore: dashboard default (see above)
  textColor: '#ffffff',
  accent: '#8399ff',
  font: 'Poppins',
  avatarShape: 'circle',
  showAvatar: true,
  showTitle: true,
  showName: true,
  showSubtitle: true,
  showExtra: true,
};
// The texts of the level-up layout (the rank layout keeps its own): the chip of the position and the line under the name.
const LEVELUP_DEFAULTS = {
  extra: '#{level_rank}', // i18n-ignore: variables only
  subtitle: 'You are now in Top {level_top_percent}%', // i18n-ignore: dashboard default (see above)
};
const BASIC_DEFAULTS = {
  preset: 'classic',
  title: 'Welcome', // i18n-ignore: dashboard default (see above)
  name: '{user.display_name}',
  subtitle: 'We are now {server_membercount} members', // i18n-ignore: dashboard default (see above)
  textColor: '#ffffff',
  accent: '#ffffff',
  font: 'Poppins',
  avatarShape: 'circle',
  showAvatar: true,
  showTitle: true,
  showName: true,
  showSubtitle: true,
};
const HEX = /^#[0-9a-f]{6}$/i;
const cap = (value, max, fallback) => (typeof value === 'string' ? value.slice(0, max) : fallback);
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
/** The tint and strength of the dark panel behind the text (layouts with a panel or bars). Only kept when set, so cards made before it draw as they did. */
function panelSettings(input) {
  const out = {};
  if (typeof input.panelColor === 'string' && HEX.test(input.panelColor.trim())) out.panelColor = input.panelColor.trim().toLowerCase();
  const opacity = Number(input.panelOpacity);
  if (input.panelOpacity !== undefined && input.panelOpacity !== null && input.panelOpacity !== '' && Number.isFinite(opacity)) out.panelOpacity = Math.min(0.9, Math.max(0, opacity));
  return out;
}

/** The basic settings, checked. Anything missing or wrong becomes the default. `kind` is `welcome` or `rank`. */
function normalizeBasic(raw, kind = 'welcome') {
  const input = raw && typeof raw === 'object' ? raw : {};
  if (kind === 'rank') {
    const hex = (value, fallback) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback);
    const preset = RANK_PRESETS.includes(input.preset) ? input.preset : RANK_DEFAULTS.preset;
    // The level-up layout has texts of its own: a card that still has the rank texts (the dashboard did not change them) gets those.
    const levelUp = preset === 'levelup';
    const texts = (value, rankDefault, levelUpDefault) => (levelUp && (value === undefined || value === rankDefault) ? levelUpDefault : value);
    return {
      preset,
      title: cap(input.title, 60, RANK_DEFAULTS.title),
      name: cap(input.name, 80, RANK_DEFAULTS.name),
      subtitle: cap(texts(input.subtitle, RANK_DEFAULTS.subtitle, LEVELUP_DEFAULTS.subtitle), 120, levelUp ? LEVELUP_DEFAULTS.subtitle : RANK_DEFAULTS.subtitle),
      extra: cap(texts(input.extra, RANK_DEFAULTS.extra, LEVELUP_DEFAULTS.extra), 40, levelUp ? LEVELUP_DEFAULTS.extra : RANK_DEFAULTS.extra),
      textColor: hex(input.textColor, RANK_DEFAULTS.textColor),
      accent: hex(input.accent, RANK_DEFAULTS.accent),
      font: typeof input.font === 'string' ? input.font : RANK_DEFAULTS.font,
      avatarShape: ['circle', 'rounded', 'square'].includes(input.avatarShape) ? input.avatarShape : RANK_DEFAULTS.avatarShape,
      showAvatar: flag(input.showAvatar, true),
      showTitle: flag(input.showTitle, true),
      showName: flag(input.showName, true),
      showSubtitle: flag(input.showSubtitle, true),
      showExtra: flag(input.showExtra, true),
      // What Discord shows around the person, on the level-up layout: the decoration of the avatar and the nameplate behind the card.
      // Each one is only drawn when the person has it.
      showDecoration: flag(input.showDecoration, true),
      showNameplate: flag(input.showNameplate, false),
      // The decoration moves (Premium) when it is an animated one; without it, or without Premium, it is the still picture.
      animateDecoration: flag(input.animateDecoration, false),
      ...panelSettings(input),
    };
  }
  const hex = (value, fallback) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback);
  return {
    preset: PRESETS.includes(input.preset) ? input.preset : BASIC_DEFAULTS.preset,
    title: cap(input.title, 60, BASIC_DEFAULTS.title),
    name: cap(input.name, 80, BASIC_DEFAULTS.name),
    subtitle: cap(input.subtitle, 120, BASIC_DEFAULTS.subtitle),
    textColor: hex(input.textColor, BASIC_DEFAULTS.textColor),
    accent: hex(input.accent, BASIC_DEFAULTS.accent),
    font: typeof input.font === 'string' ? input.font : BASIC_DEFAULTS.font,
    avatarShape: ['circle', 'rounded', 'square'].includes(input.avatarShape) ? input.avatarShape : BASIC_DEFAULTS.avatarShape,
    showAvatar: flag(input.showAvatar, true),
    showTitle: flag(input.showTitle, true),
    showName: flag(input.showName, true),
    showSubtitle: flag(input.showSubtitle, true),
    ...panelSettings(input),
  };
}

const FIT_LINES = { title: 1, name: 1, subtitle: 2, extra: 1 };
const textLayer = (id, value, x, y, size, o = {}) => ({
  id, type: 'text', text: value, x, y, size, font: o.font, weight: o.weight ?? 700, color: o.color, align: o.align ?? 'center',
  w: o.w ?? 0, opacity: o.opacity ?? 1, spacing: o.spacing ?? 0, upper: o.upper ?? false,
  shadow: o.shadow ?? { color: '#000000', blur: 8, x: 0, y: 2 },
  // A long name or text gets smaller before it is cut: the name and the title stay on one line, the line under them takes two.
  maxLines: o.maxLines ?? FIT_LINES[id] ?? 1, fit: true,
});

/**
 * The layers of a level-up card: the person (avatar with its decoration, name with the chip of the position and the server tag, and
 * the line under it) and, on the right, the level they were at going to the one they reached, each in a hexagon.
 */
function buildLevelUpLayers(b, width, height) {
  const layers = [];
  const text = (id, show, value, x, y, size, o) => { if (show && value) layers.push({ ...textLayer(id, value, x, y, size, { font: b.font, color: b.textColor, ...o }) }); };
  const margin = height * 0.075;
  const panelW = width - margin * 2;
  const panelH = height - margin * 2;
  const radius = height * 0.2;
  // The dark panel is under the nameplate, like Discord's own: the nameplate fades out on the left, where the name is.
  layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: width / 2, y: height / 2, w: panelW, h: panelH, fill: b.panelColor ?? '#000000', radius, opacity: b.panelOpacity ?? 0.5 });
  if (b.showNameplate) layers.push({ id: 'nameplate', type: 'image', src: '{user.nameplate}', x: width / 2, y: height / 2, w: panelW, h: panelH, fit: 'cover', radius, opacity: 1, showIf: '{user.nameplate}' });

  const avatar = height * 0.5;
  const avatarX = margin + height * 0.1 + avatar * 0.6;
  if (b.showAvatar) {
    layers.push({ id: 'avatar', type: 'avatar', source: 'user', x: avatarX, y: height / 2, size: avatar, shape: b.avatarShape, border: null, shadow: { color: '#000000', blur: 16, x: 0, y: 4 } });
    if (b.showDecoration) layers.push({ id: 'decoration', type: 'image', src: '{user.avatar_decoration}', x: avatarX, y: height / 2, w: avatar * 1.2, h: avatar * 1.2, fit: 'contain', radius: 0, opacity: 1, showIf: '{user.avatar_decoration}', ...(b.animateDecoration ? { animate: true } : {}) });
  }
  // The hexagons of the levels (drawn below) are where the texts on the left must stop.
  const newH = height * 0.56;
  const newW = newH * 0.98;
  const oldH = newH * 0.76;
  const oldW = oldH * 0.98;
  const newX = width - margin - height * 0.12 - newW / 2;
  const arrowX = newX - newW / 2 - height * 0.2;
  const oldX = arrowX - height * 0.2 - oldW / 2;
  const x = (b.showAvatar ? avatarX + avatar * 0.6 : margin + height * 0.1) + height * 0.16;
  const nameSize = height * 0.2;
  const chip = height * 0.11;
  const pill = { color: '#ffffff', opacity: 0.22, padX: chip * 0.55, padY: chip * 0.22, radius: 999 };
  // The room the name, its chip and the line under it have: from the avatar to the first hexagon. A long name (and a long word for the position, as
  // `Rango #10` in Spanish) used to run into the hexagon of the level before: the name now gets what is left after the chip.
  const room = Math.max(oldX - oldW / 2 - x - height * 0.06, height * 0.5);
  const chipText = String(b.extra ?? '').replace(/\{[^}]+\}/g, '000');
  const chipSpace = b.showName && b.showExtra && chipText ? chipText.length * chip * 0.56 + pill.padX * 2 + chip * 0.9 : 0;
  const nameRoom = Math.min(Math.max(room - chipSpace, room * 0.55), width * 0.4);
  text('name', b.showName, b.name, x, height * 0.37, nameSize, { align: 'left', weight: 800, w: nameRoom, maxLines: 1 });
  if (b.showName && b.showExtra) layers.push({ ...textLayer('rank', b.extra, x, height * 0.37, chip, { font: b.font, color: b.textColor, align: 'left', weight: 700, shadow: false }), follow: 'name', gap: chip * 0.9, pill });
  text('subtitle', b.showSubtitle, b.subtitle, x, height * 0.64, height * 0.115, { align: 'left', weight: 400, opacity: 0.92, w: Math.min(width * 0.4, room), maxLines: 1 });

  // The levels: the one before (dim) and the one reached, in hexagons.
  layers.push({ id: 'hex-old', type: 'shape', shape: 'hexagon', x: oldX, y: height / 2, w: oldW, h: oldH, fill: '#000000', radius: oldH * 0.1, opacity: 0.7, stroke: { color: '#9a9ca3', width: Math.max(5, height * 0.04) } });
  text('level-old', true, '{level_previous}', oldX, height / 2, oldH * 0.4, { color: '#9a9ca3', weight: 800, shadow: false, w: oldW });
  const shaft = height * 0.2;
  layers.push({ id: 'arrow', type: 'shape', shape: 'rect', x: arrowX, y: height / 2, w: shaft, h: Math.max(3, height * 0.02), fill: '#ffffff', radius: 3, opacity: 0.9 });
  layers.push({ id: 'arrow-up', type: 'shape', shape: 'rect', x: arrowX + shaft * 0.36, y: height / 2 - shaft * 0.13, w: shaft * 0.38, h: Math.max(3, height * 0.02), fill: '#ffffff', radius: 3, opacity: 0.9, rotation: 40 });
  layers.push({ id: 'arrow-down', type: 'shape', shape: 'rect', x: arrowX + shaft * 0.36, y: height / 2 + shaft * 0.13, w: shaft * 0.38, h: Math.max(3, height * 0.02), fill: '#ffffff', radius: 3, opacity: 0.9, rotation: -40 });
  layers.push({ id: 'hex-new', type: 'shape', shape: 'hexagon', x: newX, y: height / 2, w: newW, h: newH, fill: '#000000', radius: newH * 0.1, opacity: 0.9, stroke: { color: b.accent, width: Math.max(7, height * 0.06) }, shadow: { color: '#000000', blur: 14, x: 0, y: 4 } });
  text('level-new', true, '{level}', newX, height / 2, newH * 0.42, { weight: 800, shadow: false, w: newW });
  return layers;
}

/** The layers of a rank card: the avatar, the name, the level and rank texts, and the progress bar of `{level_progress}`. */
function buildRankLayers(b, width, height) {
  if (b.preset === 'levelup') return buildLevelUpLayers(b, width, height);
  const layers = [];
  const line = (id, show, value, x, y, size, o) => { if (show && value) layers.push(textLayer(id, value, x, y, size, { font: b.font, color: b.textColor, ...o })); };
  const bar = (x, y, w, h) => layers.push({
    id: 'bar', type: 'bar', x, y, w, h, radius: h / 2, fill: b.accent, fill2: '', track: '#000000', trackOpacity: 0.45, value: '{level_progress}', shadow: null,
  });
  layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: width / 2, y: height / 2, w: width - 50, h: height - 50, fill: b.panelColor ?? '#000000', radius: 34, opacity: b.panelOpacity ?? 0.45 });
  if (b.preset === 'rankBottom') {
    const size = height * 0.5;
    if (b.showAvatar) layers.push({ id: 'avatar', type: 'avatar', source: 'user', x: 60 + size / 2 + 10, y: height * 0.38, size, shape: b.avatarShape, border: { color: b.accent, width: 7 }, shadow: { color: '#000000', blur: 18, x: 0, y: 5 } });
    const x = 60 + size + 50;
    const w = width - x - 70;
    line('name', b.showName, b.name, x, height * 0.24, 46, { align: 'left', weight: 800, w });
    line('title', b.showTitle, b.title, x, height * 0.42, 32, { align: 'left', color: b.accent, spacing: 3, upper: true, w });
    line('extra', b.showExtra, b.extra, width - 70, height * 0.42, 32, { align: 'right', color: b.accent, spacing: 3, upper: true, w: 300 });
    bar(width / 2, height * 0.71, width - 140, 34);
    line('subtitle', b.showSubtitle, b.subtitle, width / 2, height * 0.855, 24, { weight: 400, opacity: 0.9, w: width - 140 });
    return layers;
  }
  const size = height * 0.56;
  if (b.showAvatar) layers.push({ id: 'avatar', type: 'avatar', source: 'user', x: 56 + size / 2 + 14, y: height / 2, size, shape: b.avatarShape, border: { color: b.accent, width: 7 }, shadow: { color: '#000000', blur: 18, x: 0, y: 5 } });
  const x = 56 + size + 60;
  const right = width - 70;
  const w = right - x;
  line('name', b.showName, b.name, x, height * 0.3, 46, { align: 'left', weight: 800, w: w - 220 });
  line('extra', b.showExtra, b.extra, right, height * 0.3, 34, { align: 'right', color: b.accent, spacing: 3, upper: true, w: 260 });
  line('title', b.showTitle, b.title, x, height * 0.5, 30, { align: 'left', color: b.accent, spacing: 3, upper: true, w });
  bar(x + w / 2, height * 0.68, w, 32);
  line('subtitle', b.showSubtitle, b.subtitle, right, height * 0.86, 24, { align: 'right', weight: 400, opacity: 0.9, w });
  return layers;
}

/** The layers of a basic card, for a card of `width` by `height`. `kind` is `welcome` or `rank`. */
function buildBasicLayers(rawBasic, width = 1024, height = 500, kind = 'welcome') {
  if (kind === 'rank') return buildRankLayers(normalizeBasic(rawBasic, 'rank'), width, height);
  const b = normalizeBasic(rawBasic);
  const cx = width / 2;
  const layers = [];
  const avatar = (x, y, size) => {
    if (b.showAvatar) layers.push({ id: 'avatar', type: 'avatar', source: 'user', x, y, size, shape: b.avatarShape, border: { color: b.accent, width: 8 }, shadow: { color: '#000000', blur: 24, x: 0, y: 6 } });
  };
  const line = (id, show, value, x, y, size, o) => { if (show && value) layers.push(textLayer(id, value, x, y, size, { font: b.font, color: b.textColor, ...o })); };

  if (b.preset === 'side') {
    // A design carries a tinted panel so the text stays readable over its picture; without one the layout is as it always was.
    if (b.panelColor) layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: cx, y: height / 2, w: width - 50, h: height - 50, fill: b.panelColor, radius: 40, opacity: b.panelOpacity ?? 0.5 });
    avatar(height * 0.52, height / 2, height * 0.52);
    const x = height * 0.52 + height * 0.26 + 50;
    const w = width - x - 40;
    line('title', b.showTitle, b.title, x, height * 0.34, 38, { align: 'left', color: b.accent, spacing: 6, upper: true, w });
    line('name', b.showName, b.name, x, height * 0.5, 66, { align: 'left', weight: 800, w });
    line('subtitle', b.showSubtitle, b.subtitle, x, height * 0.68, 34, { align: 'left', weight: 400, opacity: 0.9, w });
  } else if (b.preset === 'bars') {
    layers.push({ id: 'bar-top', type: 'shape', shape: 'rect', x: cx, y: height * 0.08, w: width, h: height * 0.16, fill: b.panelColor ?? '#000000', opacity: b.panelOpacity ?? 0.55 });
    layers.push({ id: 'bar-bottom', type: 'shape', shape: 'rect', x: cx, y: height * 0.92, w: width, h: height * 0.16, fill: b.panelColor ?? '#000000', opacity: b.panelOpacity ?? 0.55 });
    avatar(cx, height * 0.33, height * 0.4);
    line('title', b.showTitle, b.title, cx, height * 0.64, 78, { weight: 800, upper: true, color: b.accent, w: width - 80 });
    line('name', b.showName, b.name, cx, height * 0.79, 38, { w: width - 80 });
    line('subtitle', b.showSubtitle, b.subtitle, cx, height * 0.92, 30, { weight: 700, upper: true, w: width - 80 });
  } else if (b.preset === 'panel') {
    layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: cx, y: height / 2, w: width - 100, h: height - 100, fill: b.panelColor ?? '#000000', radius: 40, opacity: b.panelOpacity ?? 0.5 });
    avatar(width * 0.22, height / 2, height * 0.46);
    const x = width * 0.22 + height * 0.23 + 50;
    const w = width - x - 90;
    line('title', b.showTitle, b.title, x, height * 0.36, 34, { align: 'left', color: b.accent, spacing: 4, upper: true, w });
    line('name', b.showName, b.name, x, height * 0.5, 58, { align: 'left', weight: 800, w });
    line('subtitle', b.showSubtitle, b.subtitle, x, height * 0.65, 30, { align: 'left', weight: 400, opacity: 0.9, w });
  } else {
    line('title', b.showTitle, b.title, cx, height * 0.12, 40, { color: b.accent, spacing: 8, upper: true, w: width - 80 });
    avatar(cx, height * 0.42, height * 0.38);
    line('name', b.showName, b.name, cx, height * 0.72, 58, { weight: 800, w: width - 80 });
    line('subtitle', b.showSubtitle, b.subtitle, cx, height * 0.86, 32, { weight: 400, opacity: 0.9, w: width - 80 });
  }
  return layers;
}

module.exports = { PRESETS, RANK_PRESETS, BASIC_DEFAULTS, RANK_DEFAULTS, LEVELUP_DEFAULTS, normalizeBasic, buildBasicLayers };
