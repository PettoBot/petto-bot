// Saved messages made in the dashboard's Components V2 editor. A V2 message is a list of components (containers, text,
// pictures, sections, dividers and rows of link buttons) with no `content` and no embeds, and it needs the
// IsComponentsV2 flag when it is sent. The saved shape follows Discord's own JSON, so the Embed Builder can read it:
//   { v2: { components: [ { type: 17, accent_color, components: [ { type: 10, content } ... ] } ] } }
// Every text and link can hold `{variables}`. They are resolved here, and anything that would make Discord refuse the
// message is cleaned or left out: an empty text, a picture whose link ended up empty, a button without a label or link.
const { MessageFlags } = require('discord.js');
const { resolve } = require('./embedVariables');

const LIMITS = { components: 40, text: 4000, buttonLabel: 80, url: 512, galleryItems: 10, rowButtons: 5, sectionTexts: 3, description: 1024 };
const TYPES = { ROW: 1, BUTTON: 2, SECTION: 9, TEXT: 10, THUMBNAIL: 11, GALLERY: 12, SEPARATOR: 14, CONTAINER: 17 };
const BUTTON_LINK = 5;

const isV2 = (data) => Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.v2 && Array.isArray(data.v2.components));

function safeUrl(value) {
  const text = String(value ?? '').trim().slice(0, LIMITS.url);
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? text : '';
  } catch {
    return '';
  }
}

function emojiOf(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const name = String(raw.name ?? '').slice(0, 64);
  if (!name) return undefined;
  const id = /^\d{15,25}$/.test(String(raw.id ?? '')) ? String(raw.id) : undefined;
  return id ? { name, id, animated: Boolean(raw.animated) } : { name };
}

/** One pass over a message: keeps the count of components and the characters of text, and resolves variables. */
function makeBuilder(ctx) {
  let components = 0;
  let characters = 0;
  const room = (count = 1) => components + count <= LIMITS.components;
  const take = (count = 1) => { components += count; };
  const text = async (value) => {
    const resolved = String(await resolve(String(value ?? ''), ctx)).trim();
    if (!resolved) return '';
    const left = LIMITS.text - characters;
    if (left <= 0) return '';
    const clipped = resolved.slice(0, left);
    characters += clipped.length;
    return clipped;
  };
  const link = async (value) => safeUrl(await resolve(String(value ?? ''), ctx));

  const textNode = async (raw) => {
    if (!room()) return null;
    const content = await text(raw.content);
    if (!content) return null;
    take();
    return { type: TYPES.TEXT, content };
  };

  const separator = (raw) => {
    if (!room()) return null;
    take();
    return { type: TYPES.SEPARATOR, divider: raw.divider !== false, spacing: raw.spacing === 2 ? 2 : 1 };
  };

  const gallery = async (raw) => {
    const items = [];
    for (const item of (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.galleryItems)) {
      const url = await link(item?.media?.url);
      if (!url) continue;
      const description = item.description ? (await text(item.description)).slice(0, LIMITS.description) : '';
      items.push({ media: { url }, ...(description ? { description } : {}), spoiler: Boolean(item.spoiler) });
    }
    if (!items.length || !room()) return null;
    take();
    return { type: TYPES.GALLERY, items };
  };

  const button = async (raw) => {
    const label = (await text(raw?.label)).slice(0, LIMITS.buttonLabel);
    const url = await link(raw?.url);
    const emoji = emojiOf(raw?.emoji);
    if (!url || (!label && !emoji)) return null;
    return { type: TYPES.BUTTON, style: BUTTON_LINK, ...(label ? { label } : {}), url, ...(emoji ? { emoji } : {}), ...(raw.disabled ? { disabled: true } : {}) };
  };

  const row = async (raw) => {
    const buttons = [];
    for (const item of (Array.isArray(raw.components) ? raw.components : []).slice(0, LIMITS.rowButtons)) {
      if (item?.type !== TYPES.BUTTON || !room(buttons.length + 2)) continue;
      const built = await button(item);
      if (built) buttons.push(built);
    }
    if (!buttons.length || !room(1 + buttons.length)) return null;
    take(1 + buttons.length);
    return { type: TYPES.ROW, components: buttons };
  };

  const section = async (raw) => {
    const texts = [];
    for (const item of (Array.isArray(raw.components) ? raw.components : []).slice(0, LIMITS.sectionTexts)) {
      if (item?.type !== TYPES.TEXT) continue;
      const content = await text(item.content);
      if (content) texts.push({ type: TYPES.TEXT, content });
    }
    if (!texts.length) return null;
    let accessory = null;
    if (raw.accessory?.type === TYPES.THUMBNAIL) {
      const url = await link(raw.accessory.media?.url);
      if (url) {
        const description = raw.accessory.description ? (await text(raw.accessory.description)).slice(0, LIMITS.description) : '';
        accessory = { type: TYPES.THUMBNAIL, media: { url }, ...(description ? { description } : {}), spoiler: Boolean(raw.accessory.spoiler) };
      }
    } else if (raw.accessory?.type === TYPES.BUTTON) {
      accessory = await button(raw.accessory);
    }
    // A section needs an accessory. Without one (a picture that is not there for this message) it is plain text.
    if (!accessory) {
      const plain = [];
      for (const item of texts) { if (room()) { take(); plain.push(item); } }
      return plain;
    }
    const needed = 2 + texts.length;
    if (!room(needed)) return null;
    take(needed);
    return { type: TYPES.SECTION, components: texts, accessory };
  };

  const child = async (raw) => {
    switch (raw?.type) {
      case TYPES.TEXT: return textNode(raw);
      case TYPES.SEPARATOR: return separator(raw);
      case TYPES.GALLERY: return gallery(raw);
      case TYPES.SECTION: return section(raw);
      case TYPES.ROW: return row(raw);
      default: return null;
    }
  };

  const container = async (raw) => {
    if (!room()) return null;
    take();
    const children = [];
    for (const item of Array.isArray(raw.components) ? raw.components : []) {
      const built = await child(item);
      if (Array.isArray(built)) children.push(...built); else if (built) children.push(built);
    }
    if (!children.length) { components -= 1; return null; }
    const accent = Number.isInteger(raw.accent_color) && raw.accent_color >= 0 && raw.accent_color <= 0xffffff ? raw.accent_color : null;
    return { type: TYPES.CONTAINER, ...(accent !== null ? { accent_color: accent } : {}), ...(raw.spoiler ? { spoiler: true } : {}), components: children };
  };

  return { container, child, count: () => components, chars: () => characters };
}

/**
 * The components of a V2 template for one send, with the variables resolved, plus the flag Discord needs.
 * `extraText` is added as a last line of text when there is room (the credit of the quest alerts uses it).
 */
async function buildV2(v2, ctx = {}, { prefixText = null, suffixText = null } = {}) {
  const builder = makeBuilder(ctx);
  const components = [];
  if (prefixText && builder.count() < LIMITS.components) { components.push({ type: TYPES.TEXT, content: prefixText }); }
  for (const item of Array.isArray(v2?.components) ? v2.components : []) {
    const built = item?.type === TYPES.CONTAINER ? await builder.container(item) : await builder.child(item);
    if (Array.isArray(built)) components.push(...built); else if (built) components.push(built);
  }
  if (suffixText && components.length && builder.count() < LIMITS.components) components.push({ type: TYPES.TEXT, content: suffixText });
  return { components, flags: MessageFlags.IsComponentsV2 };
}

/** True when a V2 template would send something: at least one text, picture or button. */
function hasV2Content(data) {
  const walk = (nodes) => (Array.isArray(nodes) ? nodes : []).some((node) => {
    if (!node || typeof node !== 'object') return false;
    if (node.type === TYPES.TEXT) return Boolean(String(node.content ?? '').trim());
    if (node.type === TYPES.GALLERY) return Array.isArray(node.items) && node.items.length > 0;
    if (node.type === TYPES.ROW) return Array.isArray(node.components) && node.components.length > 0;
    return walk(node.components) || Boolean(node.accessory);
  });
  return isV2(data) && walk(data.v2.components);
}

module.exports = { LIMITS, TYPES, isV2, buildV2, hasV2Content };
