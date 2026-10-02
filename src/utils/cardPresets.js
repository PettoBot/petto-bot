// The layouts of the basic editor. A basic card keeps a few settings (`basic`) and the layers are built from them,
// so a free server cannot save layers the basic editor does not offer. The dashboard builds the same layers for its
// preview from the same rules, and a test pins the result for every preset.

const PRESETS = ['classic', 'side', 'bars', 'panel'];
// The layouts of a rank card: they show the level, the rank and a progress bar.
const RANK_PRESETS = ['rank', 'rankBottom'];
const RANK_DEFAULTS = {
  preset: 'rank',
  title: 'LEVEL {level}',
  name: '{user.display_name}',
  subtitle: '{level_xp_current} / {level_xp_needed} XP',
  extra: 'RANK #{level_rank}',
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
const BASIC_DEFAULTS = {
  preset: 'classic',
  title: 'Welcome',
  name: '{user.display_name}',
  subtitle: 'We are now {server_membercount} members',
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

/** The basic settings, checked. Anything missing or wrong becomes the default. `kind` is `welcome` or `rank`. */
function normalizeBasic(raw, kind = 'welcome') {
  const input = raw && typeof raw === 'object' ? raw : {};
  if (kind === 'rank') {
    const hex = (value, fallback) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback);
    return {
      preset: RANK_PRESETS.includes(input.preset) ? input.preset : RANK_DEFAULTS.preset,
      title: cap(input.title, 60, RANK_DEFAULTS.title),
      name: cap(input.name, 80, RANK_DEFAULTS.name),
      subtitle: cap(input.subtitle, 120, RANK_DEFAULTS.subtitle),
      extra: cap(input.extra, 40, RANK_DEFAULTS.extra),
      textColor: hex(input.textColor, RANK_DEFAULTS.textColor),
      accent: hex(input.accent, RANK_DEFAULTS.accent),
      font: typeof input.font === 'string' ? input.font : RANK_DEFAULTS.font,
      avatarShape: ['circle', 'rounded', 'square'].includes(input.avatarShape) ? input.avatarShape : RANK_DEFAULTS.avatarShape,
      showAvatar: flag(input.showAvatar, true),
      showTitle: flag(input.showTitle, true),
      showName: flag(input.showName, true),
      showSubtitle: flag(input.showSubtitle, true),
      showExtra: flag(input.showExtra, true),
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
  };
}

const text = (id, value, x, y, size, o = {}) => ({
  id, type: 'text', text: value, x, y, size, font: o.font, weight: o.weight ?? 700, color: o.color, align: o.align ?? 'center',
  w: o.w ?? 0, opacity: o.opacity ?? 1, spacing: o.spacing ?? 0, upper: o.upper ?? false,
  shadow: o.shadow ?? { color: '#000000', blur: 8, x: 0, y: 2 },
});

/** The layers of a rank card: the avatar, the name, the level and rank texts, and the progress bar of `{level_progress}`. */
function buildRankLayers(b, width, height) {
  const layers = [];
  const line = (id, show, value, x, y, size, o) => { if (show && value) layers.push(text(id, value, x, y, size, { font: b.font, color: b.textColor, ...o })); };
  const bar = (x, y, w, h) => layers.push({
    id: 'bar', type: 'bar', x, y, w, h, radius: h / 2, fill: b.accent, fill2: '', track: '#000000', trackOpacity: 0.45, value: '{level_progress}', shadow: null,
  });
  layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: width / 2, y: height / 2, w: width - 50, h: height - 50, fill: '#000000', radius: 34, opacity: 0.45 });
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
  const line = (id, show, value, x, y, size, o) => { if (show && value) layers.push(text(id, value, x, y, size, { font: b.font, color: b.textColor, ...o })); };

  if (b.preset === 'side') {
    avatar(height * 0.52, height / 2, height * 0.52);
    const x = height * 0.52 + height * 0.26 + 50;
    const w = width - x - 40;
    line('title', b.showTitle, b.title, x, height * 0.34, 38, { align: 'left', color: b.accent, spacing: 6, upper: true, w });
    line('name', b.showName, b.name, x, height * 0.5, 66, { align: 'left', weight: 800, w });
    line('subtitle', b.showSubtitle, b.subtitle, x, height * 0.68, 34, { align: 'left', weight: 400, opacity: 0.9, w });
  } else if (b.preset === 'bars') {
    layers.push({ id: 'bar-top', type: 'shape', shape: 'rect', x: cx, y: height * 0.08, w: width, h: height * 0.16, fill: '#000000', opacity: 0.55 });
    layers.push({ id: 'bar-bottom', type: 'shape', shape: 'rect', x: cx, y: height * 0.92, w: width, h: height * 0.16, fill: '#000000', opacity: 0.55 });
    avatar(cx, height * 0.33, height * 0.4);
    line('title', b.showTitle, b.title, cx, height * 0.64, 78, { weight: 800, upper: true, color: b.accent, w: width - 80 });
    line('name', b.showName, b.name, cx, height * 0.79, 38, { w: width - 80 });
    line('subtitle', b.showSubtitle, b.subtitle, cx, height * 0.92, 30, { weight: 700, upper: true, w: width - 80 });
  } else if (b.preset === 'panel') {
    layers.push({ id: 'panel', type: 'shape', shape: 'rect', x: cx, y: height / 2, w: width - 100, h: height - 100, fill: '#000000', radius: 40, opacity: 0.5 });
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

module.exports = { PRESETS, RANK_PRESETS, BASIC_DEFAULTS, RANK_DEFAULTS, normalizeBasic, buildBasicLayers };
