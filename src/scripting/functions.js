const { typeOf, isTruthy, toText, equals, toNumber, FORBIDDEN_KEYS } = require('./values');

// The functions of Petto Code. Each one is a name, the least and the most arguments it takes (null: any number), and the
// function itself, which gets the environment first. The ones that change something in Discord do not do it: they note it
// as an effect, and the bot decides later whether to do it.
const functions = new Map();
const def = (name, min, max, run) => functions.set(name, { min, max, run });

const EMBEDS = new WeakSet(); // the maps made by cembed
const COMPLEX = new WeakSet(); // the maps made by complexMessage
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

def('cembed', 0, 40, (env, ...pairs) => {
  if (pairs.length % 2) throw new Error('cembed needs pairs of a name and a value, like "title" "Hi"');
  const embed = {};
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
      default: throw new Error(`cembed does not know "${key}". Use title, description, url, color, footer, author, thumbnail, image, timestamp or fields`);
    }
  }
  const size = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0)
    + (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);
  if (size > 6000) throw new Error('An embed holds at most 6000 characters in total');
  EMBEDS.add(embed);
  return embed;
});
def('complexMessage', 0, 4, (env, ...pairs) => {
  if (pairs.length % 2) throw new Error('complexMessage needs pairs of a name and a value, like "content" "Hi"');
  const message = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const key = text(pairs[i]).toLowerCase();
    if (key === 'content') message.content = limitText(pairs[i + 1], 2000, 'The content');
    else if (key === 'embed') { if (!EMBEDS.has(pairs[i + 1])) throw new Error('"embed" must be made with cembed'); message.embed = pairs[i + 1]; }
    else throw new Error(`complexMessage does not know "${key}". Use content or embed`);
  }
  COMPLEX.add(message);
  return message;
});

// ── Effects: what the code asks the bot to do ───────────────────────────────
function messageOf(value) {
  if (EMBEDS.has(value)) return { embed: value };
  if (COMPLEX.has(value)) return { content: value.content, embed: value.embed };
  if (typeof value === 'string' || typeof value === 'number') return { content: limitText(value, 2000, 'A message') };
  throw new Error('A message is a text, or something made with cembed or complexMessage');
}
const hasBody = (message) => Boolean((message.content ?? '').trim() || message.embed);

def('sendMessage', 2, 2, (env, channel, value) => {
  const message = messageOf(value);
  if (!hasBody(message)) throw new Error('The message is empty');
  const channelId = channel === null || channel === undefined || channel === '' || channel === 0 ? null : snowflake(channel, 'the channel');
  env.effects.add('message', { channelId, ...message });
  return null;
});
def('sendDM', 1, 1, (env, value) => {
  const message = messageOf(value);
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
def('deleteTrigger', 0, 0, (env) => { env.effects.add('deleteTrigger', {}); return null; });

// ── Stored data: what the commands of a server remember between uses ───────
const KEY_SHAPE = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_STORED_LENGTH = 4000;

function storeKey(value) {
  if (typeof value !== 'string' || !KEY_SHAPE.test(value)) throw new Error('A key is a text of 1 to 100 letters, numbers, . _ : or -');
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

module.exports = { functions, EMBEDS, COMPLEX };
