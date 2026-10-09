const { typeOf, isTruthy, toText, equals, toNumber, FORBIDDEN_KEYS } = require('./values');

// The functions of Petto Code. Each one is a name, the least and the most arguments it takes (null: any number), and the
// function itself, which gets the environment first. The ones that change something in Discord do not do it: they note it
// as an effect, and the bot decides later whether to do it.
const functions = new Map();
const def = (name, min, max, run) => functions.set(name, { min, max, run });

const EMBEDS = new WeakSet(); // the maps made by cembed
const COMPLEX = new WeakSet(); // the maps made by complexMessage
const BUTTONS = new WeakSet(); // the maps made by cbutton
const SELECTS = new WeakSet(); // the maps made by cselect
const ROWS = new WeakSet(); // the maps made by crow
const TEXT_INPUTS = new WeakSet(); // the maps made by ctext
const MODALS = new WeakSet(); // the maps made by cmodal
const SNOWFLAKE = /^\d{15,22}$/;
const MAX_FIELD_NAME = 256;

const text = (value) => toText(value);
const num = (value) => toNumber(value);
const list = (value, what = 'a list') => { if (!Array.isArray(value)) throw new Error(`Expected ${what}, got ${typeOf(value)}`); return value; };
const str = (value, what = 'a text') => { if (typeof value !== 'string') throw new Error(`Expected ${what}, got ${typeOf(value)}`); return value; };
// IDs are text: a number that big loses its last digits.
const snowflake = (value, what) => {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) throw new Error(`Expected ${what} as a Discord ID in quotes, like "123456789012345678"`);
  return value;
};

// ── Logic and comparison ────────────────────────────────────────────────────
def('eq', 2, null, (env, first, ...others) => others.some((other) => equals(first, other)));
def('ne', 2, 2, (env, a, b) => !equals(a, b));
const ordered = (op) => (env, a, b) => {
  const bothNumbers = typeof a === 'number' && typeof b === 'number';
  const bothTexts = typeof a === 'string' && typeof b === 'string';
  if (!bothNumbers && !bothTexts) throw new Error(`Cannot compare ${typeOf(a)} with ${typeOf(b)}`);
  return op(a, b);
};
def('lt', 2, 2, ordered((a, b) => a < b));
def('le', 2, 2, ordered((a, b) => a <= b));
def('gt', 2, 2, ordered((a, b) => a > b));
def('ge', 2, 2, ordered((a, b) => a >= b));
def('not', 1, 1, (env, value) => !isTruthy(value));
def('and', 1, null, (env, ...values) => { for (const value of values) if (!isTruthy(value)) return value; return values.at(-1); });
def('or', 1, null, (env, ...values) => { for (const value of values) if (isTruthy(value)) return value; return values.at(-1); });

// ── Numbers ─────────────────────────────────────────────────────────────────
def('add', 2, null, (env, ...values) => values.reduce((sum, value) => sum + num(value), 0));
def('sub', 2, null, (env, first, ...others) => others.reduce((total, value) => total - num(value), num(first)));
def('mult', 2, null, (env, ...values) => values.reduce((total, value) => total * num(value), 1));
def('div', 2, 2, (env, a, b) => { if (num(b) === 0) throw new Error('Cannot divide by zero'); return num(a) / num(b); });
def('mod', 2, 2, (env, a, b) => { if (num(b) === 0) throw new Error('Cannot divide by zero'); return num(a) % num(b); });
def('pow', 2, 2, (env, a, b) => { const result = num(a) ** Math.min(num(b), 1000); if (!Number.isFinite(result)) throw new Error('The number is too big'); return result; });
def('floor', 1, 1, (env, value) => Math.floor(num(value)));
def('ceil', 1, 1, (env, value) => Math.ceil(num(value)));
def('round', 1, 1, (env, value) => Math.round(num(value)));
def('abs', 1, 1, (env, value) => Math.abs(num(value)));
def('min', 1, null, (env, ...values) => Math.min(...values.map(num)));
def('max', 1, null, (env, ...values) => Math.max(...values.map(num)));
def('toInt', 1, 1, (env, value) => { const n = typeof value === 'boolean' ? Number(value) : Number(String(value ?? '').trim()); return Number.isFinite(n) ? Math.trunc(n) : 0; });
def('toFloat', 1, 1, (env, value) => { const n = Number(String(value ?? '').trim()); return Number.isFinite(n) ? n : 0; });
def('randInt', 1, 2, (env, a, b) => {
  const [low, high] = b === undefined ? [0, num(a)] : [num(a), num(b)];
  if (!(high > low)) throw new Error('randInt needs a high number above the low one');
  return Math.floor(low) + Math.floor(env.rng() * (Math.floor(high) - Math.floor(low)));
});

// ── Text ────────────────────────────────────────────────────────────────────
def('str', 1, 1, (env, value) => text(value));
def('print', 0, null, (env, ...values) => values.map(text).join(''));
def('lower', 1, 1, (env, value) => text(value).toLowerCase());
def('upper', 1, 1, (env, value) => text(value).toUpperCase());
def('title', 1, 1, (env, value) => text(value).replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()));
def('trim', 1, 1, (env, value) => text(value).trim());
def('contains', 2, 2, (env, haystack, needle) => text(haystack).includes(text(needle)));
def('hasPrefix', 2, 2, (env, value, prefix) => text(value).startsWith(text(prefix)));
def('hasSuffix', 2, 2, (env, value, suffix) => text(value).endsWith(text(suffix)));
def('replace', 3, 3, (env, value, from, to) => { const needle = text(from); return needle === '' ? text(value) : text(value).split(needle).join(text(to)); });
def('split', 2, 2, (env, value, separator) => text(value).split(text(separator)));
def('join', 2, 2, (env, items, separator) => list(items).map(text).join(text(separator)));
def('printf', 1, null, (env, format, ...values) => {
  let used = 0;
  return str(format, 'a format text').replace(/%(-?)(\d{0,3})(?:\.(\d{1,2}))?([sdvftqx%])/g, (match, left, width, precision, verb) => {
    if (verb === '%') return '%';
    if (used >= values.length) return `%!${verb}(MISSING)`;
    const value = values[used]; used += 1;
    let out;
    if (verb === 'd') out = String(Math.trunc(num(value)));
    else if (verb === 'f') out = num(value).toFixed(precision === undefined ? 6 : Number(precision));
    else if (verb === 'x') out = Math.trunc(num(value)).toString(16);
    else if (verb === 't') out = isTruthy(value) ? 'true' : 'false';
    else if (verb === 'q') out = JSON.stringify(text(value));
    else out = text(value);
    const size = Number(width || 0);
    return left ? out.padEnd(size) : out.padStart(size);
  });
});

// ── Lists and maps ──────────────────────────────────────────────────────────
def('len', 1, 1, (env, value) => {
  if (typeof value === 'string') return [...value].length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  throw new Error(`len needs a text, a list or a map, got ${typeOf(value)}`);
});
def('index', 2, null, (env, base, ...keys) => keys.reduce((current, key) => {
  if (Array.isArray(current)) {
    const position = num(key);
    if (!Number.isInteger(position) || position < 0 || position >= current.length) throw new Error(`The index ${position} is out of the list (it has ${current.length})`);
    return current[position];
  }
  if (current && typeof current === 'object') { const name = String(key); return FORBIDDEN_KEYS.has(name) || !Object.prototype.hasOwnProperty.call(current, name) ? null : current[name]; }
  throw new Error(`index needs a list or a map, got ${typeOf(current)}`);
}, base));
def('cslice', 0, 200, (env, ...values) => values);
const makeMap = (name) => (env, ...pairs) => {
  if (pairs.length % 2) throw new Error(`${name} needs pairs of a key and a value`);
  const map = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const key = text(pairs[i]);
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`"${key}" cannot be a key`);
    map[key] = pairs[i + 1];
  }
  return map;
};
def('dict', 0, 200, makeMap('dict'));
def('sdict', 0, 200, makeMap('sdict'));
def('append', 2, 2, (env, items, value) => [...list(items), value]);
def('in', 2, 2, (env, items, value) => list(items).some((item) => equals(item, value)));
def('slice', 2, 3, (env, value, from, to) => {
  const start = num(from);
  if (typeof value === 'string') { const chars = [...value]; return chars.slice(start, to === undefined ? undefined : num(to)).join(''); }
  return list(value, 'a list or a text').slice(start, to === undefined ? undefined : num(to));
});
def('seq', 2, 2, (env, from, to) => {
  const start = Math.trunc(num(from)); const end = Math.trunc(num(to));
  if (end - start > 1000) throw new Error('seq can make at most 1000 numbers');
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
});
def('shuffle', 1, 1, (env, items) => {
  const copy = [...list(items)];
  for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(env.rng() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
});
def('keys', 1, 1, (env, map) => { if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('keys needs a map'); return Object.keys(map); });

// ── Mentions, time and the user ─────────────────────────────────────────────
def('mentionUser', 1, 1, (env, id) => `<@${snowflake(id, 'a user')}>`);
def('mentionRole', 1, 1, (env, id) => `<@&${snowflake(id, 'a role')}>`);
def('mentionChannel', 1, 1, (env, id) => `<#${snowflake(id, 'a channel')}>`);
def('unix', 0, 0, (env) => Math.floor(env.now() / 1000));
def('timestamp', 1, 2, (env, seconds, style) => {
  const kind = style === undefined ? 'f' : text(style);
  if (!['t', 'T', 'd', 'D', 'f', 'F', 'R'].includes(kind)) throw new Error('The style of a timestamp is one of t T d D f F R');
  return `<t:${Math.trunc(num(seconds))}:${kind}>`;
});
def('humanizeDuration', 1, 1, (env, seconds) => {
  let left = Math.max(0, Math.trunc(num(seconds)));
  const units = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  const out = [];
  for (const [label, size] of units) { const amount = Math.floor(left / size); left -= amount * size; if (amount) out.push(`${amount}${label}`); }
  return out.length ? out.join(' ') : '0s';
});
def('hasRole', 1, 1, (env, id) => (env.data?.Member?.RoleIDs ?? []).includes(snowflake(id, 'a role')));

// ── Embeds ──────────────────────────────────────────────────────────────────
const httpUrl = (value, what) => {
  const url = str(value, `${what} as a link`);
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2000) throw new Error(`${what} must be a link that starts with http:// or https://`);
  return url;
};
const limitText = (value, max, what) => { const result = text(value); if ([...result].length > max) throw new Error(`${what} is longer than ${max} characters`); return result; };

def('cembed', 0, 50, (env, ...pairs) => {
  if (pairs.length % 2) throw new Error('cembed needs pairs of a name and a value, like "title" "Hi"');
  const embed = {};
  let authorIcon; let authorUrl; let footerIcon;
  for (let i = 0; i < pairs.length; i += 2) {
    const key = text(pairs[i]).toLowerCase();
    const value = pairs[i + 1];
    if (value === null || value === undefined) continue;
    switch (key) {
      case 'title': embed.title = limitText(value, 256, 'The title'); break;
      case 'description': embed.description = limitText(value, 4096, 'The description'); break;
      case 'url': embed.url = httpUrl(value, 'The url'); break;
      case 'color': {
        const color = typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value) ? parseInt(value.replace('#', ''), 16) : Math.trunc(num(value));
        if (color < 0 || color > 0xffffff) throw new Error('The color must be between 0 and 16777215, or a hex like "#ff91c2"');
        embed.color = color; break;
      }
      case 'footer': embed.footer = { text: limitText(value, 2048, 'The footer') }; break;
      case 'author': embed.author = { name: limitText(value, 256, 'The author') }; break;
      case 'authoricon': authorIcon = httpUrl(value, 'The author icon'); break;
      case 'authorurl': authorUrl = httpUrl(value, 'The author link'); break;
      case 'footericon': footerIcon = httpUrl(value, 'The footer icon'); break;
      case 'thumbnail': embed.thumbnail = { url: httpUrl(value, 'The thumbnail') }; break;
      case 'image': embed.image = { url: httpUrl(value, 'The image') }; break;
      case 'timestamp': embed.timestamp = isTruthy(value) ? new Date(env.now()).toISOString() : undefined; break;
      case 'fields': {
        const rows = list(value, 'a list of fields');
        if (rows.length > 25) throw new Error('An embed holds at most 25 fields');
        embed.fields = rows.map((row, n) => {
          const parts = list(row, `the field ${n + 1} as cslice "name" "value"`);
          if (parts.length < 2) throw new Error(`The field ${n + 1} needs a name and a value`);
          return { name: limitText(parts[0], MAX_FIELD_NAME, 'A field name') || '​', value: limitText(parts[1], 1024, 'A field value') || '​', inline: parts[2] === true };
        });
        break;
      }
      default: throw new Error(`cembed does not know "${key}". Use title, description, url, color, footer, footerIcon, author, authorIcon, authorUrl, thumbnail, image, timestamp or fields`);
    }
  }
  if (authorIcon || authorUrl) {
    if (!embed.author) throw new Error('authorIcon and authorUrl need an author, like "author" "Liam"');
    if (authorIcon) embed.author.icon_url = authorIcon;
    if (authorUrl) embed.author.url = authorUrl;
  }
  if (footerIcon) {
    if (!embed.footer) throw new Error('footerIcon needs a footer, like "footer" "Petto"');
    embed.footer.icon_url = footerIcon;
  }
  const size = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0)
    + (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);
  if (size > 6000) throw new Error('An embed holds at most 6000 characters in total');
  EMBEDS.add(embed);
  return embed;
});
// ── Buttons and menus ───────────────────────────────────────────────────────
// A button or a menu says which handler it runs (a name the code chooses). When someone uses it, the same command runs
// again with `.Trigger` set to "button" or "select", and `.Button.ID` is that name, so one command can hold everything.
const HANDLER_SHAPE = /^[A-Za-z0-9_-]{1,20}$/;
const DATA_SHAPE = /^[A-Za-z0-9_.-]{0,20}$/;
const BUTTON_STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 };

const flatPairs = (pairs, what) => {
  if (pairs.length % 2) throw new Error(`${what} needs pairs of a name and a value, like "label" "Yes"`);
  const map = new Map();
  for (let i = 0; i < pairs.length; i += 2) map.set(text(pairs[i]).toLowerCase(), pairs[i + 1]);
  return map;
};
const emojiOf = (value) => {
  const emoji = str(value, 'an emoji');
  if (!emoji || emoji.length > 80) throw new Error('The emoji is empty or too long');
  return emoji;
};

def('cbutton', 2, 20, (env, ...pairs) => {
  const map = flatPairs(pairs, 'cbutton');
  const known = ['label', 'id', 'data', 'style', 'emoji', 'disabled', 'url', 'user'];
  for (const key of map.keys()) if (!known.includes(key)) throw new Error(`cbutton does not know "${key}". Use ${known.join(', ')}`);
  const button = { type: 'button' };
  if (map.has('label') && map.get('label') !== null) button.label = limitText(map.get('label'), 80, 'The label');
  if (map.has('emoji') && map.get('emoji') !== null) button.emoji = emojiOf(map.get('emoji'));
  if (!button.label && !button.emoji) throw new Error('A button needs a label or an emoji');
  if (map.has('disabled')) button.disabled = isTruthy(map.get('disabled'));
  if (map.has('url') && map.get('url') !== null) {
    if (map.has('id')) throw new Error('A button with a url opens a link and cannot also have an id');
    button.url = httpUrl(map.get('url'), 'The url');
    button.style = 5;
  } else {
    const id = map.get('id');
    if (typeof id !== 'string' || !HANDLER_SHAPE.test(id)) throw new Error('A button needs an id of 1 to 20 letters, numbers, - or _, such as "id" "yes"');
    button.handler = id;
    const styleName = map.has('style') ? text(map.get('style')).toLowerCase() : 'secondary';
    if (!(styleName in BUTTON_STYLES)) throw new Error('The style of a button is primary, secondary, success or danger');
    button.style = BUTTON_STYLES[styleName];
    const data = map.has('data') && map.get('data') !== null ? text(map.get('data')) : '';
    if (!DATA_SHAPE.test(data)) throw new Error('The data of a button holds at most 20 letters, numbers, . - or _');
    button.data = data;
    if (map.has('user') && map.get('user') !== null) button.userId = snowflake(map.get('user'), 'the user');
  }
  BUTTONS.add(button);
  return button;
});

def('cselect', 3, 20, (env, ...pairs) => {
  const map = flatPairs(pairs, 'cselect');
  const known = ['id', 'placeholder', 'options', 'min', 'max', 'user'];
  for (const key of map.keys()) if (!known.includes(key)) throw new Error(`cselect does not know "${key}". Use ${known.join(', ')}`);
  const id = map.get('id');
  if (typeof id !== 'string' || !HANDLER_SHAPE.test(id)) throw new Error('A menu needs an id of 1 to 20 letters, numbers, - or _');
  const rows = list(map.get('options'), 'a list of options like cslice (cslice "label" "value")');
  if (!rows.length || rows.length > 25) throw new Error('A menu holds from 1 to 25 options');
  const options = rows.map((row, n) => {
    const parts = list(row, `the option ${n + 1} as cslice "label" "value"`);
    if (parts.length < 2) throw new Error(`The option ${n + 1} needs a label and a value`);
    const option = { label: limitText(parts[0], 100, 'An option label') || '\u200b', value: limitText(parts[1], 100, 'An option value') };
    if (!option.value) throw new Error(`The option ${n + 1} needs a value`);
    if (parts[2] !== undefined && parts[2] !== null) option.description = limitText(parts[2], 100, 'An option description');
    return option;
  });
  const select = { type: 'select', handler: id, options };
  if (map.get('placeholder') !== undefined && map.get('placeholder') !== null) select.placeholder = limitText(map.get('placeholder'), 150, 'The placeholder');
  const min = map.has('min') ? Math.trunc(num(map.get('min'))) : 1;
  const max = map.has('max') ? Math.trunc(num(map.get('max'))) : 1;
  if (min < 0 || max < 1 || max > options.length || min > max) throw new Error('A menu min is at least 0, and its max is from 1 to the number of options');
  select.min = min; select.max = max;
  if (map.get('user') !== undefined && map.get('user') !== null) select.userId = snowflake(map.get('user'), 'the user');
  SELECTS.add(select);
  return select;
});

def('crow', 1, 5, (env, ...items) => {
  const first = items[0];
  if (SELECTS.has(first)) {
    if (items.length > 1) throw new Error('A menu takes a whole row by itself');
    const row = { type: 'row', items: [first] };
    ROWS.add(row);
    return row;
  }
  for (const item of items) if (!BUTTONS.has(item)) throw new Error('A row holds buttons made with cbutton, or one menu made with cselect');
  const row = { type: 'row', items };
  ROWS.add(row);
  return row;
});

const FIELD_ID_SHAPE = /^[A-Za-z0-9_]{1,20}$/;

def('ctext', 2, 14, (env, ...pairs) => {
  const map = flatPairs(pairs, 'ctext');
  const known = ['id', 'label', 'style', 'placeholder', 'value', 'required', 'min', 'max'];
  for (const key of map.keys()) if (!known.includes(key)) throw new Error(`ctext does not know "${key}". Use ${known.join(', ')}`);
  const id = map.get('id');
  if (typeof id !== 'string' || !FIELD_ID_SHAPE.test(id)) throw new Error('A field needs an id of 1 to 20 letters, numbers or _, such as "id" "reason"');
  const label = limitText(map.get('label'), 45, 'The label of a field');
  if (!label) throw new Error('A field needs a label of up to 45 characters');
  const styleName = map.has('style') ? text(map.get('style')).toLowerCase() : 'short';
  if (!['short', 'paragraph'].includes(styleName)) throw new Error('The style of a field is short or paragraph');
  const field = { type: 'textInput', id, label, style: styleName === 'paragraph' ? 2 : 1, required: map.has('required') ? isTruthy(map.get('required')) : true };
  if (map.get('placeholder') !== undefined && map.get('placeholder') !== null) field.placeholder = limitText(map.get('placeholder'), 100, 'The placeholder');
  if (map.get('value') !== undefined && map.get('value') !== null) field.value = limitText(map.get('value'), 4000, 'The value');
  const min = map.has('min') ? Math.trunc(num(map.get('min'))) : 0;
  const max = map.has('max') ? Math.trunc(num(map.get('max'))) : 4000;
  if (min < 0 || max < 1 || max > 4000 || min > max) throw new Error('A field min is from 0, and its max from 1 to 4000');
  field.min = min; field.max = max;
  TEXT_INPUTS.add(field);
  return field;
});

def('cmodal', 3, 8, (env, ...pairs) => {
  const map = flatPairs(pairs, 'cmodal');
  const known = ['id', 'title', 'fields', 'data'];
  for (const key of map.keys()) if (!known.includes(key)) throw new Error(`cmodal does not know "${key}". Use ${known.join(', ')}`);
  const id = map.get('id');
  if (typeof id !== 'string' || !HANDLER_SHAPE.test(id)) throw new Error('A modal needs an id of 1 to 20 letters, numbers, - or _');
  const title = limitText(map.get('title'), 45, 'The title of a modal');
  if (!title) throw new Error('A modal needs a title of up to 45 characters');
  const fields = list(map.get('fields'), 'a list of fields made with ctext');
  if (!fields.length || fields.length > 5) throw new Error('A modal holds from 1 to 5 fields');
  const seen = new Set();
  for (const field of fields) {
    if (!TEXT_INPUTS.has(field)) throw new Error('The fields of a modal are made with ctext');
    if (seen.has(field.id)) throw new Error(`Two fields of the modal have the id "${field.id}"`);
    seen.add(field.id);
  }
  const data = map.has('data') && map.get('data') !== null ? text(map.get('data')) : '';
  if (!DATA_SHAPE.test(data)) throw new Error('The data of a modal holds at most 20 letters, numbers, . - or _');
  const modal = { type: 'modal', handler: id, title, fields, data };
  MODALS.add(modal);
  return modal;
});

const componentsOf = (value) => {
  const rows = list(value, 'a list of rows made with crow');
  if (rows.length > 5) throw new Error('A message holds at most 5 rows of buttons or menus');
  for (const row of rows) if (!ROWS.has(row)) throw new Error('The rows of a message are made with crow');
  return rows;
};

def('complexMessage', 0, 8, (env, ...pairs) => {
  if (pairs.length % 2) throw new Error('complexMessage needs pairs of a name and a value, like "content" "Hi"');
  const message = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const key = text(pairs[i]).toLowerCase();
    if (key === 'content') message.content = limitText(pairs[i + 1], 2000, 'The content');
    else if (key === 'embed') { if (!EMBEDS.has(pairs[i + 1])) throw new Error('"embed" must be made with cembed'); message.embed = pairs[i + 1]; }
    else if (key === 'components') message.components = componentsOf(pairs[i + 1]);
    else if (key === 'reactions') {
      const emojis = list(pairs[i + 1], 'a list of emojis like cslice "🦋" "🎀"').map((emoji) => emojiOf(emoji));
      if (!emojis.length || emojis.length > 5) throw new Error('A message gets from 1 to 5 reactions');
      message.reactions = [...new Set(emojis)];
    } else if (key === 'silent') { if (isTruthy(pairs[i + 1])) message.silent = true; }
    else if (key === 'reply') { if (isTruthy(pairs[i + 1])) message.reply = true; }
    else throw new Error(`complexMessage does not know "${key}". Use content, embed, components, reactions, silent or reply`);
  }
  COMPLEX.add(message);
  return message;
});

// ── Effects: what the code asks the bot to do ───────────────────────────────
function messageOf(value) {
  if (EMBEDS.has(value)) return { embed: value };
  if (COMPLEX.has(value)) return Object.fromEntries(Object.entries({ content: value.content, embed: value.embed, components: value.components, reactions: value.reactions, silent: value.silent, reply: value.reply }).filter(([, part]) => part !== undefined));
  if (typeof value === 'string' || typeof value === 'number') return { content: limitText(value, 2000, 'A message') };
  throw new Error('A message is a text, or something made with cembed or complexMessage');
}
const hasBody = (message) => Boolean((message.content ?? '').trim() || message.embed || message.components?.length);

def('sendMessage', 2, 2, (env, channel, value) => {
  const message = messageOf(value);
  if (!hasBody(message)) throw new Error('The message is empty');
  const channelId = channel === null || channel === undefined || channel === '' || channel === 0 ? null : snowflake(channel, 'the channel');
  env.effects.add('message', { channelId, ...message });
  return null;
});
def('sendDM', 1, 1, (env, value) => {
  const message = messageOf(value);
  if (message.components) throw new Error('A direct message cannot have buttons or menus');
  if (message.reactions) throw new Error('reactions only work in a message sent with sendMessage');
  if (!hasBody(message)) throw new Error('The message is empty');
  env.effects.add('dm', message);
  return null;
});
def('addRole', 1, 1, (env, id) => { env.effects.add('addRole', { roleId: snowflake(id, 'a role') }); return null; });
def('removeRole', 1, 1, (env, id) => { env.effects.add('removeRole', { roleId: snowflake(id, 'a role') }); return null; });
def('addReaction', 1, 1, (env, emoji) => {
  const value = str(emoji, 'an emoji');
  if (!value || value.length > 100) throw new Error('The emoji is empty or too long');
  env.effects.add('reaction', { emoji: value });
  return null;
});
const needComponent = (env, name) => {
  if (!['button', 'select', 'modal', 'reaction'].includes(env.data?.Trigger)) throw new Error(`${name} only works when the command runs because of a button or a menu (or a modal, or a reaction)`);
};
def('showModal', 1, 1, (env, modal) => {
  if (!['button', 'select'].includes(env.data?.Trigger)) throw new Error('showModal only works when the command runs because of a button or a menu (a modal cannot answer a modal)');
  if (!MODALS.has(modal)) throw new Error('showModal needs a modal made with cmodal');
  env.effects.add('modal', { modal });
  return null;
});
def('respond', 1, 2, (env, value, ephemeral) => {
  needComponent(env, 'respond');
  const message = messageOf(value);
  if (message.reactions) throw new Error('reactions only work in a message sent with sendMessage');
  if (!hasBody(message)) throw new Error('The message is empty');
  env.effects.add('respond', { ...message, ephemeral: ephemeral === undefined ? false : isTruthy(ephemeral) });
  return null;
});
def('updateMessage', 1, 1, (env, value) => {
  needComponent(env, 'updateMessage');
  const message = messageOf(value);
  if (message.reactions) throw new Error('reactions only work in a message sent with sendMessage');
  if (!hasBody(message)) throw new Error('The message is empty');
  env.effects.add('update', message);
  return null;
});
def('removeReaction', 0, 0, (env) => {
  if (env.data?.Trigger !== 'reaction') throw new Error('removeReaction only works when the command runs because someone reacted');
  env.effects.add('removeReaction', {});
  return null;
});
// A delay (in seconds, up to 5 minutes) deletes the message a while later, like YAGPDB's deleteTrigger.
const delayOf = (value) => {
  if (value === undefined || value === null) return 0;
  const seconds = Math.trunc(num(value));
  if (seconds < 0 || seconds > 300) throw new Error('The delay is from 0 to 300 seconds');
  return seconds;
};
def('deleteTrigger', 0, 1, (env, delay) => { env.effects.add('deleteTrigger', { delay: delayOf(delay) }); return null; });
def('deleteResponse', 0, 1, (env, delay) => {
  if (env.data?.Trigger !== undefined && !['command', 'exec'].includes(env.data?.Trigger)) throw new Error('deleteResponse only works when the command is typed or run with execCC, not in a button, a menu, a form or a reaction');
  env.effects.add('deleteResponse', { delay: delay === undefined || delay === null ? 10 : delayOf(delay) });
  return null;
});
// Runs another command with code of this server once this one is done (or after a delay), like YAGPDB's execCC. The data
// goes as JSON, so the other command gets a copy (.ExecData) and never something this one can still change.
const MAX_EXEC_DATA = 2000;
def('execCC', 1, 3, (env, name, delay, value) => {
  const wanted = str(name, 'the name of a command').trim().toLowerCase().replace(/^[^a-z0-9_-]+/, '');
  if (!/^[a-z0-9_-]{1,32}$/.test(wanted)) throw new Error('The name of a command has 1 to 32 letters, numbers, - or _');
  const json = JSON.stringify(value ?? null) ?? 'null';
  if (json.length > MAX_EXEC_DATA) throw Object.assign(new Error(`The data of execCC is too big: at most ${MAX_EXEC_DATA} characters`), { limit: true, bare: true });
  env.effects.add('execCC', { name: wanted, delay: delayOf(delay), data: JSON.parse(json) });
  return null;
});

// ── Stored data: what the commands of a server remember between uses ───────
const KEY_SHAPE = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_STORED_LENGTH = 4000;

function storeKey(value) {
  if (typeof value !== 'string' || !KEY_SHAPE.test(value)) throw new Error('A key is a text of 1 to 100 letters, numbers, . _ : or -');
  if (value.startsWith('rx:')) throw new Error('A key cannot start with rx:, Petto uses it');
  return value;
}
/** A user ID for data of one member, or '' for data of the whole server. */
function storeUser(value) {
  if (value === undefined || value === null || value === '') return '';
  return snowflake(value, 'the user');
}
/** Only text, numbers, booleans, lists and maps can be stored, not too deep and not too big. */
function storable(value, depth = 0) {
  if (depth > 6) throw new Error('A stored value goes too deep');
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('A stored number must be finite'); return value; }
  if (Array.isArray(value)) return value.map((item) => storable(item, depth + 1));
  if (typeof value === 'object') {
    if (EMBEDS.has(value) || COMPLEX.has(value)) throw new Error('An embed or a message cannot be stored');
    const copy = {};
    for (const key of Object.keys(value)) { if (!FORBIDDEN_KEYS.has(key)) copy[key] = storable(value[key], depth + 1); }
    return copy;
  }
  throw new Error('That value cannot be stored');
}
function needStore(env) {
  if (!env.store) throw new Error('Stored data is not available here');
  return env.store;
}
function toStore(value) {
  const clean = storable(value);
  if (JSON.stringify(clean).length > MAX_STORED_LENGTH) throw new Error(`A stored value holds at most ${MAX_STORED_LENGTH} characters`);
  return clean;
}

def('dbSet', 2, 3, async (env, key, value, user) => { await needStore(env).call('set', storeKey(key), toStore(value), storeUser(user), null); return null; });
def('dbSetExpire', 3, 4, async (env, key, value, seconds, user) => {
  const ttl = Math.trunc(num(seconds));
  if (ttl < 1 || ttl > 31_536_000) throw new Error('The time must be from 1 second to a year');
  await needStore(env).call('set', storeKey(key), toStore(value), storeUser(user), ttl);
  return null;
});
def('dbGet', 1, 2, async (env, key, user) => needStore(env).call('get', storeKey(key), storeUser(user)));
def('dbDel', 1, 2, async (env, key, user) => { await needStore(env).call('del', storeKey(key), storeUser(user)); return null; });
def('dbIncr', 2, 3, async (env, key, amount, user) => needStore(env).call('incr', storeKey(key), num(amount), storeUser(user)));
def('dbTop', 2, 2, async (env, key, count) => {
  const limit = Math.trunc(num(count));
  if (limit < 1 || limit > 25) throw new Error('dbTop gives from 1 to 25 members');
  return needStore(env).call('top', storeKey(key), limit);
});
def('dbKeys', 0, 2, async (env, prefix, user) => needStore(env).call('keys', prefix === undefined || prefix === null ? '' : storeKey(prefix), storeUser(user)));

// ── More text ───────────────────────────────────────────────────────────────
// Many of these have the names YAGPDB uses, so code written for it is easier to bring over.
const codePoints = (value) => [...text(value)];
def('toString', 1, 1, (env, value) => text(value));
def('toLower', 1, 1, (env, value) => text(value).toLowerCase());
def('toUpper', 1, 1, (env, value) => text(value).toUpperCase());
def('trimSpace', 1, 1, (env, value) => text(value).trim());
def('joinStr', 1, null, (env, separator, ...values) => values.flatMap((value) => (Array.isArray(value) ? value : [value])).map(text).join(text(separator)));
def('trimPrefix', 2, 2, (env, value, prefix) => { const t = text(value); const p = text(prefix); return p && t.startsWith(p) ? t.slice(p.length) : t; });
def('trimSuffix', 2, 2, (env, value, suffix) => { const t = text(value); const p = text(suffix); return p && t.endsWith(p) ? t.slice(0, -p.length) : t; });
def('inFold', 2, 2, (env, haystack, needle) => text(haystack).toLowerCase().includes(text(needle).toLowerCase()));
def('capitalize', 1, 1, (env, value) => { const chars = codePoints(value); return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('') : ''; });
def('repeat', 2, 2, (env, value, times) => {
  const t = text(value); const n = Math.trunc(num(times));
  if (n < 0) throw new Error('repeat needs 0 or more times');
  if (t.length * n > 20_000) throw new Error('A text got too long');
  return t.repeat(n);
});
def('truncate', 2, 3, (env, value, length, end) => {
  const chars = codePoints(value); const n = Math.max(0, Math.trunc(num(length)));
  if (chars.length <= n) return chars.join('');
  const tail = end === undefined ? '…' : text(end);
  return chars.slice(0, Math.max(0, n - [...tail].length)).join('') + tail;
});
const pad = (side) => (env, value, length, fill) => {
  const t = text(value); const n = Math.trunc(num(length)); const f = fill === undefined ? ' ' : text(fill);
  if (n > 1000) throw new Error('A padded text holds at most 1000 characters');
  if (!f) return t;
  const missing = n - [...t].length;
  if (missing <= 0) return t;
  const padding = f.repeat(Math.ceil(missing / [...f].length)).slice(0, missing);
  return side === 'left' ? padding + t : t + padding;
};
def('padLeft', 2, 3, pad('left'));
def('padRight', 2, 3, pad('right'));
def('count', 2, 2, (env, haystack, needle) => { const n = text(needle); return n ? text(haystack).split(n).length - 1 : 0; });
def('indexOf', 2, 2, (env, base, value) => {
  if (Array.isArray(base)) return base.findIndex((item) => equals(item, value));
  const t = text(base); const at = t.indexOf(text(value));
  return at < 0 ? -1 : [...t.slice(0, at)].length;
});
def('reverse', 1, 1, (env, value) => (Array.isArray(value) ? [...value].reverse() : codePoints(value).reverse().join('')));
def('urlescape', 1, 1, (env, value) => encodeURIComponent(text(value)));
def('urlunescape', 1, 1, (env, value) => { try { return decodeURIComponent(text(value)); } catch { throw new Error('That text is not a valid escaped link'); } });
def('escapeMarkdown', 1, 1, (env, value) => text(value).replace(/([\\*_~`|>#[\]()-])/g, '\\$1'));
def('formatNumber', 1, 2, (env, value, decimals) => {
  const n = num(value);
  const places = decimals === undefined ? (Number.isInteger(n) ? 0 : 2) : Math.min(10, Math.max(0, Math.trunc(num(decimals))));
  const [whole, part] = Math.abs(n).toFixed(places).split('.');
  return `${n < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${part ? `.${part}` : ''}`;
});

// ── More numbers ────────────────────────────────────────────────────────────
def('fdiv', 2, 2, (env, a, b) => { if (num(b) === 0) throw new Error('Cannot divide by zero'); return num(a) / num(b); });
def('sqrt', 1, 1, (env, value) => { const n = num(value); if (n < 0) throw new Error('sqrt needs a number of 0 or more'); return Math.sqrt(n); });
def('cbrt', 1, 1, (env, value) => Math.cbrt(num(value)));
def('log', 1, 2, (env, value, base) => {
  const n = num(value); if (n <= 0) throw new Error('log needs a number above 0');
  if (base === undefined) return Math.log(n);
  const b = num(base); if (b <= 0 || b === 1) throw new Error('The base of log is above 0 and not 1');
  return Math.log(n) / Math.log(b);
});
def('roundCeil', 1, 1, (env, value) => Math.ceil(num(value)));
def('roundFloor', 1, 1, (env, value) => Math.floor(num(value)));
def('roundEven', 1, 1, (env, value) => { const n = num(value); const r = Math.round(n); return Math.abs(n % 1) === 0.5 && r % 2 !== 0 ? r - Math.sign(n) : r; });
def('clamp', 3, 3, (env, value, low, high) => Math.min(Math.max(num(value), num(low)), num(high)));
def('toInt64', 1, 1, (env, value) => { const n = typeof value === 'boolean' ? Number(value) : Number(String(value ?? '').trim()); return Number.isFinite(n) ? Math.trunc(n) : 0; });

// ── Time ────────────────────────────────────────────────────────────────────
const DISCORD_EPOCH = 1420070400000n;
const UNITS = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
def('currentTime', 0, 0, (env) => Math.floor(env.now() / 1000));
/** A duration such as "1h30m", "2d", "90s" or "1w" in seconds. A number is already seconds. 0 when it is not one. */
def('toDuration', 1, 1, (env, value) => {
  if (typeof value === 'number') return Math.max(0, Math.trunc(value));
  const raw = text(value).trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^(\d+(w|d|h|m|s))+$/.test(raw) || raw.length > 40) return 0;
  let total = 0;
  for (const [, amount, unit] of raw.matchAll(/(\d+)([wdhms])/g)) total += Number(amount) * UNITS[unit];
  return Math.min(total, 315_360_000);
});
def('humanizeTimeSince', 1, 1, (env, seconds) => functions.get('humanizeDuration').run(env, Math.floor(env.now() / 1000) - Math.trunc(num(seconds))));
/** When a Discord ID was made, in unix seconds. */
def('snowflakeToTime', 1, 1, (env, id) => Number(((BigInt(snowflake(id, 'an ID')) >> 22n) + DISCORD_EPOCH) / 1000n));
def('newDate', 3, 6, (env, year, month, day, hour = 0, minute = 0, second = 0) => {
  const ms = Date.UTC(Math.trunc(num(year)), Math.trunc(num(month)) - 1, Math.trunc(num(day)), Math.trunc(num(hour)), Math.trunc(num(minute)), Math.trunc(num(second)));
  if (!Number.isFinite(ms)) throw new Error('That date does not exist');
  return Math.floor(ms / 1000);
});
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shifted = (seconds, offset) => {
  const hours = offset === undefined ? 0 : num(offset);
  if (hours < -14 || hours > 14) throw new Error('The time zone is from -14 to 14 hours');
  return new Date((Math.trunc(num(seconds)) + Math.round(hours * 3600)) * 1000);
};
/** A date as text with a layout of YYYY, MM, DD, HH, mm, ss, MMMM (month) and dddd (day), in UTC or with an offset in hours. */
def('formatTime', 1, 3, (env, seconds, layout, offset) => {
  const date = shifted(seconds, offset);
  if (Number.isNaN(date.getTime())) throw new Error('That time does not exist');
  const two = (n) => String(n).padStart(2, '0');
  const parts = {
    YYYY: String(date.getUTCFullYear()), YY: String(date.getUTCFullYear()).slice(-2), MMMM: MONTHS[date.getUTCMonth()], MMM: MONTHS[date.getUTCMonth()].slice(0, 3),
    MM: two(date.getUTCMonth() + 1), M: String(date.getUTCMonth() + 1), DD: two(date.getUTCDate()), D: String(date.getUTCDate()),
    dddd: DAYS[date.getUTCDay()], ddd: DAYS[date.getUTCDay()].slice(0, 3), HH: two(date.getUTCHours()), H: String(date.getUTCHours()),
    hh: two(date.getUTCHours() % 12 || 12), mm: two(date.getUTCMinutes()), ss: two(date.getUTCSeconds()), A: date.getUTCHours() < 12 ? 'AM' : 'PM',
  };
  const format = layout === undefined ? 'YYYY-MM-DD HH:mm' : text(layout);
  if (format.length > 100) throw new Error('The layout holds at most 100 characters');
  // Only a whole word that is a code changes, so "Day D" keeps its word: "Day 8".
  return format.replace(/\p{L}+/gu, (word) => (Object.prototype.hasOwnProperty.call(parts, word) ? parts[word] : word));
});
def('weekday', 1, 2, (env, seconds, offset) => shifted(seconds, offset).getUTCDay());

// ── More lists and maps ─────────────────────────────────────────────────────
const plainMap = (value, what = 'a map') => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${what}, got ${typeOf(value)}`); return value; };
const compare = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if ((a === null || a === undefined) && (b === null || b === undefined)) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  throw new Error(`Cannot compare ${typeOf(a)} with ${typeOf(b)}`);
};
const direction = (order) => {
  if (order === undefined || order === null) return 1;
  const o = text(order).toLowerCase();
  if (o === 'asc') return 1;
  if (o === 'desc') return -1;
  throw new Error('The order is "asc" or "desc"');
};
def('sort', 1, 2, (env, items, order) => { const d = direction(order); return [...list(items)].sort((a, b) => d * compare(a, b)); });
def('sortBy', 2, 3, (env, items, key, order) => {
  const d = direction(order); const k = text(key);
  return [...list(items)].sort((a, b) => d * compare(a && typeof a === 'object' ? a[k] : null, b && typeof b === 'object' ? b[k] : null));
});
def('uniq', 1, 1, (env, items) => list(items).filter((item, i, all) => all.findIndex((other) => equals(other, item)) === i));
def('first', 1, 1, (env, items) => { const l = list(items); return l.length ? l[0] : null; });
def('last', 1, 1, (env, items) => { const l = list(items); return l.length ? l[l.length - 1] : null; });
def('sum', 1, 1, (env, items) => list(items).reduce((total, value) => total + num(value), 0));
def('randItem', 1, 1, (env, items) => { const l = list(items); return l.length ? l[Math.floor(env.rng() * l.length)] : null; });
def('concat', 1, 20, (env, ...lists) => lists.flatMap((value) => list(value)));
def('hasKey', 2, 2, (env, map, key) => { const k = text(key); return !FORBIDDEN_KEYS.has(k) && Object.prototype.hasOwnProperty.call(plainMap(map), k); });
def('setKey', 3, 3, (env, map, key, value) => { const k = text(key); if (FORBIDDEN_KEYS.has(k)) throw new Error(`"${k}" cannot be a key`); return { ...plainMap(map), [k]: value }; });
def('delKey', 2, 2, (env, map, key) => { const copy = { ...plainMap(map) }; delete copy[text(key)]; return copy; });
def('merge', 1, 20, (env, ...maps) => Object.assign({}, ...maps.map((map) => plainMap(map))));
def('values', 1, 1, (env, map) => { const m = plainMap(map); return Object.keys(m).sort().map((key) => m[key]); });
def('kindOf', 1, 1, (env, value) => ({ string: 'text', number: 'number', boolean: 'bool' })[typeof value] ?? typeOf(value));
def('json', 1, 1, (env, value) => { const out = JSON.stringify(value ?? null); if (out.length > 20_000) throw new Error('A text got too long'); return out; });
/** Turns a JSON text back into values, with the same rules as stored data: not too deep, not too big, no special keys. */
def('parseJson', 1, 1, (env, value) => {
  const raw = text(value);
  if (raw.length > 20_000) throw new Error('The JSON text is too long');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('That text is not valid JSON'); }
  const clean = (item, depth) => {
    if (depth > 6) throw new Error('The JSON goes too deep');
    if (Array.isArray(item)) return item.slice(0, 2000).map((x) => clean(x, depth + 1));
    if (item && typeof item === 'object') { const out = {}; for (const key of Object.keys(item)) if (!FORBIDDEN_KEYS.has(key)) out[key] = clean(item[key], depth + 1); return out; }
    return item;
  };
  return clean(parsed, 0);
});

// ── IDs from mentions ───────────────────────────────────────────────────────
// What people type after a command is text: "<@123…>", "<@!123…>" or the ID. These give the ID, or nil when it is not one.
const idFrom = (pattern) => (env, value) => { const m = pattern.exec(text(value).trim()); return m ? m[1] : null; };
def('userID', 1, 1, idFrom(/^(?:<@!?)?(\d{15,22})>?$/));
def('roleID', 1, 1, idFrom(/^(?:<@&)?(\d{15,22})>?$/));
def('channelID', 1, 1, idFrom(/^(?:<#)?(\d{15,22})>?$/));

// ── Members, roles and channels of the server (read only) ───────────────────
function needLookup(env) {
  if (!env.lookup) throw new Error('Members, roles and channels cannot be read here');
  return env.lookup;
}
def('getMember', 1, 1, async (env, id) => { const value = idFrom(/^(?:<@!?)?(\d{15,22})>?$/)(env, id); return value ? needLookup(env).call('member', value) : null; });
def('getRole', 1, 1, async (env, id) => { const value = idFrom(/^(?:<@&)?(\d{15,22})>?$/)(env, id); return value ? needLookup(env).call('role', value) : null; });
def('getChannel', 1, 1, async (env, id) => { const value = idFrom(/^(?:<#)?(\d{15,22})>?$/)(env, id); return value ? needLookup(env).call('channel', value) : null; });
def('targetHasRole', 2, 2, async (env, user, role) => {
  const roleId = snowflake(idFrom(/^(?:<@&)?(\d{15,22})>?$/)(env, role) ?? '', 'a role');
  const member = await functions.get('getMember').run(env, user);
  return Boolean(member && (member.RoleIDs ?? []).includes(roleId));
});

// ── More actions ────────────────────────────────────────────────────────────
def('addReactions', 1, 5, (env, ...emojis) => {
  for (const emoji of emojis.flatMap((value) => (Array.isArray(value) ? value : [value]))) functions.get('addReaction').run(env, emoji);
  return null;
});

// ── More stored data ────────────────────────────────────────────────────────
def('dbCount', 0, 2, async (env, prefix, user) => needStore(env).call('count', prefix === undefined || prefix === null ? '' : storeKey(prefix), storeUser(user)));
def('dbRank', 2, 2, async (env, key, user) => needStore(env).call('rank', storeKey(key), snowflake(user, 'the user')));
def('dbBottom', 2, 2, async (env, key, count) => {
  const limit = Math.trunc(num(count));
  if (limit < 1 || limit > 25) throw new Error('dbBottom gives from 1 to 25 members');
  return needStore(env).call('bottom', storeKey(key), limit);
});

module.exports = { functions, EMBEDS, COMPLEX, BUTTONS, SELECTS, ROWS };
