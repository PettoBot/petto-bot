// How a live counter turns into a channel name, and when the channel is worth renaming.
// Kept free of Discord and database imports so scripts/check-counters.js can run it on its own.
const { t, currentLanguage } = require('../i18n');

// What a counter can count. The first twelve are the original ones (their saved rows keep working); `{option}` in an old
// name shows them in the server's language. A 10-digit unix timestamp is a countdown.
const LEGACY_OPTIONS = ['members', 'users_only', 'bots_only', 'pending_members', 'all_channels', 'text_channels', 'voice_channels', 'categories', 'announcement_channels', 'staging_channels', 'boosts', 'booster_count'];
const NEW_OPTIONS = ['online', 'status_online', 'status_idle', 'status_dnd', 'in_voice', 'boost_level', 'roles', 'emojis', 'stickers', 'role_members', 'goal', 'clock', 'date'];
const OPTIONS = [...LEGACY_OPTIONS, ...NEW_OPTIONS];

// The words people type for a type, in the three languages, and the names other counter bots use.
const ALIASES = {
  member: 'members', total: 'members', all: 'members', miembros: 'members', membros: 'members',
  humans: 'users_only', human: 'users_only', users: 'users_only', people: 'users_only', humanos: 'users_only', personas: 'users_only', pessoas: 'users_only',
  bots: 'bots_only', bot: 'bots_only',
  pending: 'pending_members',
  channels: 'all_channels', canales: 'all_channels', canais: 'all_channels',
  text: 'text_channels', voice: 'voice_channels', voz: 'voice_channels', announcements: 'announcement_channels', news: 'announcement_channels', stages: 'staging_channels',
  boost: 'boosts', mejoras: 'boosts', impulsos: 'boosts', boosters: 'booster_count', level: 'boost_level', tier: 'boost_level', boostlevel: 'boost_level',
  status: 'online', connected: 'online', conectados: 'online', idle: 'status_idle', ausentes: 'status_idle', dnd: 'status_dnd', busy: 'status_dnd', ocupados: 'status_dnd',
  invoice: 'in_voice', vc: 'in_voice', voicemembers: 'in_voice', envoz: 'in_voice',
  role: 'role_members', rolemembers: 'role_members', inrole: 'role_members', rol: 'role_members', cargo: 'role_members',
  emoji: 'emojis', sticker: 'stickers', rolecount: 'roles',
  meta: 'goal', target: 'goal', objetivo: 'goal',
  time: 'clock', hora: 'clock', fecha: 'date', data: 'date', today: 'date',
};

// The types that need every member in the cache, the ones read from presences, and the ones that are not a number.
const NEEDS_MEMBERS = new Set(['users_only', 'bots_only', 'pending_members', 'booster_count', 'role_members']);
const NEEDS_PRESENCES = new Set(['online', 'status_online', 'status_idle', 'status_dnd']);
const TEXT_VALUES = new Set(['clock', 'date']);
const FORMATS = ['plain', 'grouped', 'compact'];
const FORMAT_ALIASES = { full: 'grouped', comma: 'grouped', commas: 'grouped', separated: 'grouped', short: 'compact', k: 'compact', compacto: 'compact', normal: 'plain', none: 'plain' };

// Discord lets a channel be renamed twice every ten minutes. Asking more often does not rename it faster: the request waits
// in line inside discord.js. The budget below keeps every counter under that limit, with a few seconds to spare.
const RENAME_LIMIT = 2;
const RENAME_WINDOW_MS = 10 * 60_000;
const RENAME_MARGIN_MS = 5_000;
// The old name, kept for whoever still reads it.
const MIN_RENAME_GAP_MS = RENAME_WINDOW_MS / RENAME_LIMIT;
// A clock moves every minute but a channel can only change every five: it shows the time in steps of five minutes.
const CLOCK_STEP_MS = 5 * 60_000;

/** The type a typed word means (`humans` → `users_only`), a countdown's timestamp as it is, or null. */
function resolveOption(word) {
  const key = String(word ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (!key) return null;
  if (/^\d{10}$/.test(key)) return key;
  if (OPTIONS.includes(key)) return key;
  const compact = key.replace(/_/g, '');
  return ALIASES[key] ?? ALIASES[compact] ?? OPTIONS.find((option) => option.replace(/_/g, '') === compact) ?? null;
}

function resolveFormat(word) {
  const key = String(word ?? '').trim().toLowerCase();
  if (FORMATS.includes(key)) return key;
  return FORMAT_ALIASES[key] ?? null;
}

/** Whether a time zone name is one the runtime knows (`Europe/Madrid`, `UTC`). */
function validTimeZone(zone) {
  if (!zone || typeof zone !== 'string' || zone.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

/**
 * Text and announcement channels cannot hold spaces or capitals: Discord lowercases the name and turns spaces
 * into hyphens. Comparing the raw wanted name with the stored one never matched, so those counters were
 * renamed on every pass. Voice channels, stages and categories keep the name as written.
 */
function normalizeForType(name, channelType) {
  // A topic keeps what is written, like the names of voice channels, stages and categories.
  if (channelType === 'voice' || channelType === 'category' || channelType === 'stage' || channelType === 'topic') return name;
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** The name of a counter option in `lang` for the old `{option}` placeholder; a countdown's timestamp and anything unknown stay as they are. */
function optionLabel(option, lang = currentLanguage()) {
  return LEGACY_OPTIONS.includes(option) ? t(lang, `counters.option.${option}`) : option;
}

/** The readable name of a type, for lists and the dashboard ("Humans", "Members in a role"). */
function typeLabel(option, lang = currentLanguage()) {
  if (/^\d{10}$/.test(String(option))) return t(lang, 'counters.label.countdown');
  return OPTIONS.includes(option) ? t(lang, `counters.label.${option}`) : String(option);
}

/** The name a new counter of this type gets when nobody writes one, in the server's language. */
function defaultTemplate(option, lang = currentLanguage()) {
  if (/^\d{10}$/.test(String(option))) return t(lang, 'counters.default.countdown');
  return t(lang, `counters.default.${OPTIONS.includes(option) ? option : 'members'}`);
}

const SEPARATORS = { en: { group: ',', decimal: '.' }, es: { group: '.', decimal: ',' }, 'pt-BR': { group: '.', decimal: ',' } };

/**
 * A number the way the counter asks for it: `plain` 1234, `grouped` 1,234 (1.234 in Spanish and Portuguese), `compact` 1.2k.
 * Text values (a clock, a countdown) are returned as they are.
 */
function formatCount(value, format = 'plain', lang = currentLanguage()) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
  const n = Math.trunc(value);
  const marks = SEPARATORS[lang] ?? SEPARATORS.en;
  const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, marks.group);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (format === 'grouped') return sign + group(String(abs));
  if (format === 'compact' && abs >= 1000) {
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    for (const [size, unit] of units) {
      if (abs < size) continue;
      const scaled = abs / size;
      // One decimal below 100 (1.2k, 12.5k), none above (125k); never rounded up past what the count really is.
      const digits = scaled < 100 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled);
      const text = String(digits).replace('.', marks.decimal);
      return `${sign}${text}${unit}`;
    }
  }
  return sign + String(abs);
}

const NICE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/**
 * The next goal of a goal counter. A goal set by the server is used until it is reached; then (or without one) the next round
 * number a quarter of the way up: 87 → 90, 450 → 500, 1,234 → 1,250.
 */
function nextGoal(count, setGoal = null) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const fixed = Math.trunc(Number(setGoal) || 0);
  if (fixed > n) return fixed;
  let step = NICE_STEPS[0];
  for (const candidate of NICE_STEPS) if (candidate <= n / 4) step = candidate;
  return (Math.floor(n / step) + 1) * step;
}

/** A clock or a date for a time zone. The clock goes down to a step of five minutes so it changes when a rename is allowed. */
function timeValue(option, { now = Date.now(), timeZone = 'UTC', lang = currentLanguage() } = {}) {
  const zone = validTimeZone(timeZone) ? timeZone : 'UTC';
  const locale = lang === 'pt-BR' ? 'pt-BR' : lang === 'es' ? 'es' : 'en-GB';
  if (option === 'date') return new Intl.DateTimeFormat(locale, { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(now)).replace(/\./g, '');
  const stepped = Math.floor(now / CLOCK_STEP_MS) * CLOCK_STEP_MS;
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(stepped));
}

/** The short name of a time zone for `{tz}`: `UTC`, `GMT+2`, `CEST`... */
function zoneLabel(timeZone, now = Date.now()) {
  const zone = validTimeZone(timeZone) ? timeZone : 'UTC';
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(now)).find((p) => p.type === 'timeZoneName');
  return part?.value ?? zone;
}

/**
 * The channel name of a counter. `value` is what was counted (a number, or a text for clocks and countdowns); `extra` brings what
 * some templates show: `goal`, `role` (the role's name) and `now` for time zones. Placeholders:
 *   {count} the formatted value ({value} and {remaining} are the same, from older templates)
 *   {goal} {left} {percent} for goals, {role} the role's name, {tz} the time zone, {option} the old option word.
 */
function renderName(row, value, lang = currentLanguage(), extra = {}) {
  // i18n-ignore: the template of old rows, its words come from optionLabel
  const template = row.name_template || '{option}: {value}';
  const format = FORMATS.includes(row.number_format) ? row.number_format : 'plain';
  const count = formatCount(value, format, lang);
  const goal = typeof value === 'number' ? (extra.goal ?? nextGoal(value, row.goal)) : null;
  const vars = {
    '{count}': count, '{value}': count, '{remaining}': count,
    '{option}': optionLabel(row.counter_option, lang),
    '{goal}': goal == null ? '' : formatCount(goal, format, lang),
    '{left}': goal == null ? '' : formatCount(Math.max(0, goal - value), format, lang),
    '{percent}': goal ? `${Math.min(100, Math.floor((value / goal) * 100))}%` : '',
    '{role}': extra.role ?? '',
    '{tz}': template.includes('{tz}') ? zoneLabel(row.timezone, extra.now) : '',
  };
  const text = template.replace(/\{(count|value|remaining|option|goal|left|percent|role|tz)\}/g, (whole) => vars[whole]);
  const name = `${row.prefix ?? ''}${text}${row.suffix ?? ''}`.replace(/\s+/g, ' ').trim();
  // Discord takes at most 100 characters in a name and 1024 in a topic; an emoji is two of them in JavaScript and is never cut in half.
  const max = maxLengthOf(row);
  return Array.from(name).reduce((out, char) => (out.length + char.length <= max ? out + char : out), '') || count;
}

/** Where a counter shows its value: `topic` (a text channel's topic) or `name`. */
function targetOf(row) {
  return row?.target === 'topic' ? 'topic' : 'name';
}

/** How long the shown text can be: 1024 characters for a topic, 100 for a name. */
function maxLengthOf(row) {
  return targetOf(row) === 'topic' ? 1024 : 100;
}

/** How long a template can be when it is written. */
function templateMax(row) {
  return targetOf(row) === 'topic' ? 500 : 100;
}

function sameName(current, wanted, channelType) {
  return current === wanted || current === normalizeForType(wanted, channelType);
}

/** The renames of the last ten minutes, oldest first. */
function recentRenames(times, now) {
  return (Array.isArray(times) ? times : []).map(Number).filter((time) => Number.isFinite(time) && now - time < RENAME_WINDOW_MS && time <= now + 1000).sort((a, b) => a - b);
}

/**
 * When the channel can be renamed again: now when fewer than two renames happened in the last ten minutes, otherwise when the
 * older of the two leaves the window. `minGapMs` keeps a longer gap a server asked for; `blockedUntil` is a rate limit Discord gave.
 */
function nextRenameAt(times, now, { minGapMs = 0, blockedUntil = 0 } = {}) {
  const recent = recentRenames(times, now);
  let at = now;
  if (recent.length >= RENAME_LIMIT) at = Math.max(at, recent[recent.length - RENAME_LIMIT] + RENAME_WINDOW_MS + RENAME_MARGIN_MS);
  if (minGapMs > 0 && recent.length) at = Math.max(at, recent[recent.length - 1] + minGapMs);
  if (blockedUntil > now) at = Math.max(at, blockedUntil);
  return at;
}

/**
 * Decides what to do with a counter channel: nothing (the name is already right), rename it now, or rename it later at `at`.
 * `lastWanted` and `lastStored` are what was asked for and what Discord kept the last time, so a name Discord rewrites in its
 * own way is not asked for again while it is still the same value.
 */
function planRename({ currentName, wantedName, channelType, lastWanted, lastStored, times = [], now, minGapMs = 0, blockedUntil = 0 }) {
  if (sameName(currentName, wantedName, channelType)) return { action: 'skip' };
  if (lastWanted === wantedName && lastStored !== undefined && currentName === lastStored) return { action: 'skip' };
  const at = nextRenameAt(times, now, { minGapMs, blockedUntil });
  return at <= now ? { action: 'now' } : { action: 'later', at };
}

/** The earlier yes/no form of planRename, kept for its callers: a rename is wanted now. */
function shouldRename({ currentName, wantedName, channelType, lastWanted, lastStored, renamedAt, now }) {
  return planRename({ currentName, wantedName, channelType, lastWanted, lastStored, times: renamedAt === undefined ? [] : [renamedAt, renamedAt], now, minGapMs: MIN_RENAME_GAP_MS }).action === 'now';
}

module.exports = {
  OPTIONS, LEGACY_OPTIONS, NEW_OPTIONS, NEEDS_MEMBERS, NEEDS_PRESENCES, TEXT_VALUES, FORMATS,
  RENAME_LIMIT, RENAME_WINDOW_MS, MIN_RENAME_GAP_MS, CLOCK_STEP_MS,
  resolveOption, resolveFormat, validTimeZone, optionLabel, typeLabel, defaultTemplate, normalizeForType, targetOf, maxLengthOf, templateMax,
  formatCount, nextGoal, timeValue, zoneLabel, renderName, sameName, recentRenames, nextRenameAt, planRename, shouldRename,
};
