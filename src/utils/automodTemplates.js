/**
 * Ready-made filters for AutoMod. Each template builds regular expressions that work in Discord's own AutoMod (the Rust
 * engine: no lookaround and no backreferences, 260 characters each, 10 per rule) and in Petto's own filter (JavaScript).
 * A pattern is `{ source, flags }`; the flags are only i, m and s, so Discord gets them as `(?ims)` in front of the
 * source and Petto compiles them with the `u` flag.
 */
const ZERO_WIDTH = '​‌‍‎‏⁠⁢⁣﻿';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const num = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** id, group, native: false means only Petto's filter can do it, `options` are what the server can tune. */
const TEMPLATES = {
  links: {
    group: 'links',
    options: [{ key: 'nonClickable', type: 'boolean', default: false }],
    build: (o) => {
      const patterns = [{ source: '(?:h\\W{0,2}t\\W{0,2}t\\W{0,2}p\\W{0,2}s?\\W{0,2}:\\W{0,2}/\\W{0,2}/|www\\W{0,2}\\.)\\S*', flags: 'i' }];
      if (o.nonClickable) patterns.push({ source: '\\b[a-z0-9-]{2,63}(?:\\.[a-z0-9-]{2,63})*\\.(?:com|net|org|io|gg|xyz|me|co|app|dev|ly|tv|info|biz|ru|cn|uk|de|fr|es|br|ar|mx|link|site|online|shop|store|club|top)\\b\\S*', flags: 'i' });
      return patterns;
    },
  },
  invites: {
    group: 'links',
    options: [{ key: 'thirdParty', type: 'boolean', default: false }],
    build: (o) => {
      const patterns = [{ source: '(?:discord(?:app)?\\W{0,2}(?:gg|com\\W{0,2}/\\W{0,2}invite)|discord\\.com/servers)\\W{0,2}/?\\W{0,2}[\\w-]+', flags: 'i' }];
      if (o.thirdParty) patterns.push({ source: '\\b(?:dsc\\.gg|invite\\.gg|discord\\.me|discord\\.io|discord\\.link|discord\\.st|top\\.gg/servers|disboard\\.org/server)/\\S+', flags: 'i' });
      return patterns;
    },
  },
  inline_links: {
    group: 'links',
    options: [{ key: 'disguisedOnly', type: 'boolean', default: false }],
    build: (o) => [{
      source: o.disguisedOnly
        ? '\\[[^\\]]*[a-z0-9-]+\\.[a-z]{2,}[^\\]]*\\]\\(\\s*<?(?:https?://|www\\.)[^)\\s]+'
        : '\\[[^\\]]+\\]\\(\\s*<?(?:https?://|www\\.)[^)\\s]+',
      flags: 'i',
    }],
  },
  emails: {
    group: 'links',
    options: [],
    build: () => [{ source: '[A-Za-z0-9._%+-]+\\s?(?:@|\\[at\\]|\\(at\\))\\s?[A-Za-z0-9.-]+\\s?(?:\\.|\\[dot\\]|\\(dot\\))\\s?[A-Za-z]{2,}', flags: '' }],
  },
  scam: {
    group: 'safety',
    options: [],
    build: () => [{ source: '(?:free|claim|get|gift)\\W{0,10}(?:discord\\W{0,3})?nitro|steam\\W{0,3}(?:gift|giveaway)|free\\W{0,3}robux|crypto\\W{0,3}airdrop|(?:wallet|seed)\\W{0,3}(?:connect|phrase)', flags: 'i' }],
  },
  ip_addresses: {
    group: 'safety',
    options: [],
    build: () => [{ source: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: '' }],
  },
  phone_numbers: {
    group: 'safety',
    options: [],
    build: () => [{ source: '\\+?\\d{1,3}[\\s.-]?\\(?\\d{2,4}\\)?[\\s.-]?\\d{3,4}[\\s.-]?\\d{3,4}', flags: '' }],
  },
  emojis: {
    group: 'text',
    options: [{ key: 'max', type: 'number', min: 0, max: 12, default: 6 }],
    build: (o) => [{ source: `(?:.*?(?:<a?:\\w{2,32}:\\d{17,20}>|\\p{Extended_Pictographic})){${num(o.max, 0, 12, 6) + 1}}`, flags: 's' }],
  },
  zalgo: {
    group: 'text',
    options: [{ key: 'filterAccents', type: 'boolean', default: false }],
    build: (o) => [{ source: o.filterAccents ? '\\p{Mn}' : '\\p{Mn}{3,}', flags: '' }],
  },
  headings: {
    group: 'text',
    options: [{ key: 'level', type: 'number', min: 1, max: 3, default: 3 }],
    build: (o) => [{ source: `^\\s*#{1,${num(o.level, 1, 3, 3)}}\\s+\\S`, flags: 'm' }],
  },
  subtext: {
    group: 'text',
    options: [],
    build: () => [{ source: '^\\s*-#\\s+\\S', flags: 'm' }],
  },
  caps: {
    group: 'text',
    options: [{ key: 'words', type: 'number', min: 3, max: 20, default: 6 }],
    build: (o) => [{ source: `(?:\\b[A-Z]{2,}\\b\\W*){${num(o.words, 3, 20, 6)},}`, flags: '' }],
  },
  repeated_characters: {
    group: 'text',
    options: [{ key: 'times', type: 'number', min: 6, max: 30, default: 10 }],
    build: (o) => {
      const n = num(o.times, 6, 30, 10);
      return [{ source: `(?:${LETTERS.map((l) => `${l}{${n},}`).join('|')}|[!?.]{${n},})`, flags: 'i' }];
    },
  },
  spoilers: {
    group: 'text',
    options: [{ key: 'max', type: 'number', min: 1, max: 10, default: 3 }],
    build: (o) => [{ source: `(?:\\|\\|[^|]*\\|\\|\\s*){${num(o.max, 1, 10, 3) + 1},}`, flags: '' }],
  },
  invisible_text: {
    group: 'text',
    options: [],
    build: () => [{ source: `[${ZERO_WIDTH}]{3,}`, flags: '' }],
  },
  fake_pings: {
    group: 'safety',
    options: [],
    build: () => [{ source: '@\\W{0,2}(?:every\\W{0,2}one|here)\\b', flags: 'i' }],
  },
};

const TEMPLATE_IDS = Object.keys(TEMPLATES);

/** What Discord's own AutoMod does without a regex (a trigger of its own). */
const NATIVE_ONLY = ['spam', 'mentions', 'profanity', 'sexual', 'slurs'];

/** The server's options with the template's defaults, and only the keys the template knows. */
function resolveOptions(id, raw) {
  const template = TEMPLATES[id];
  const out = {};
  for (const opt of template?.options ?? []) {
    const value = raw?.[opt.key];
    out[opt.key] = opt.type === 'boolean' ? (value === undefined ? opt.default : value === true || value === 'true' || value === 'on') : num(value ?? opt.default, opt.min, opt.max, opt.default);
  }
  return out;
}

/** The patterns of a template: [{ source, flags }]. Empty for an unknown id. */
function buildPatterns(id, rawOptions) {
  const template = TEMPLATES[id];
  if (!template) return [];
  return template.build(resolveOptions(id, rawOptions));
}

/** The pattern as Discord's AutoMod wants it. */
function toDiscordPattern({ source, flags }) {
  return `${flags ? `(?${flags})` : ''}${source}`;
}

/** The pattern as a JavaScript regular expression, or null when it does not compile. */
function toRegExp({ source, flags }) {
  try {
    return new RegExp(source, `${flags}u`);
  } catch {
    return null;
  }
}

/** Packs: groups of templates that make sense together. `native: false` ones that are only for Petto's filter are not in them. */
const PACKS = {
  basic: { templates: [['invites', {}], ['zalgo', {}], ['subtext', {}], ['fake_pings', {}]] },
  clean_chat: { templates: [['caps', {}], ['repeated_characters', {}], ['emojis', {}], ['spoilers', {}], ['invisible_text', {}]] },
  anti_scam: { templates: [['scam', {}], ['links', {}], ['inline_links', { disguisedOnly: true }], ['fake_pings', {}]] },
  strict: { templates: [['links', { nonClickable: true }], ['invites', { thirdParty: true }], ['emails', {}], ['zalgo', { filterAccents: false }], ['headings', {}], ['subtext', {}]] },
};

module.exports = { TEMPLATES, TEMPLATE_IDS, NATIVE_ONLY, PACKS, resolveOptions, buildPatterns, toDiscordPattern, toRegExp };
