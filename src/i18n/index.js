// The languages Petto speaks: `t(lang, key, vars)` and the language of each server.
//
// The catalogs live in src/i18n/locales/<lang>/<module>.js, one flat object per module whose keys all start with the
// module name (`moderation.ban.done` lives in moderation.js; `cmd.moderation.ban.desc` lives in cmd.moderation.js).
// English is the reference: a key missing in es or pt-BR falls back to English, and `npm run check`
// (scripts/check-i18n.js) fails when a key or a `{placeholder}` is missing.
//
// How the code finds the language:
//   - commands, buttons, menus and modals: `const lang = await languageOf(interaction)` once, then `t(lang, ...)`;
//   - events and jobs: `await guildLanguage(guild.id)` (the event handler also runs each event inside its server's language);
//   - helpers that build text take `lang` as a parameter that defaults to `currentLanguage()`, the language of the command or
//     event that is running (English outside of one, so the checks get English).
//
// Key endings with a meaning, checked by scripts/check-i18n.js:
//   `.desc`            description of a command, subcommand or option (100 characters, the limit of Discord)
//   `.button`          label of a button (80 characters)
//   `.menu`            label, description or placeholder of a select menu (100 characters)
//   `.one` / `.other`  the two forms of a plural, used by `tn()` (both must exist)
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const LANGUAGES = ['en', 'es', 'pt-BR'];
const DEFAULT_LANGUAGE = 'en';
// The name of each language, written in that language (they are never translated).
const LANGUAGE_NAMES = { en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' };
// The Discord locales each language answers for: descriptions of registered slash commands, `interaction.locale` and
// `guild.preferredLocale`.
const DISCORD_LOCALES = { es: ['es-ES', 'es-419'], 'pt-BR': ['pt-BR'] };
// How numbers are written (thousands separators) in each language.
const NUMBER_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };

const LOCALES_DIR = path.join(__dirname, 'locales');

/** Every catalog file of one language, merged: { key: text }. */
function loadCatalog(lang) {
  const dir = path.join(LOCALES_DIR, lang);
  const catalog = {};
  if (!fs.existsSync(dir)) return catalog;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js')).sort()) {
    Object.assign(catalog, require(path.join(dir, file)));
  }
  return catalog;
}

const CATALOGS = Object.fromEntries(LANGUAGES.map((lang) => [lang, loadCatalog(lang)]));

/** `es`, `ES`, `es-419`, `spanish`, `español` -> `es`; `pt`, `pt-br`, `português` -> `pt-BR`. Anything else is null. */
function normalizeLanguage(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return null;
  if (['en', 'en-us', 'en-gb', 'english', 'inglés', 'ingles', 'inglês'].includes(raw)) return 'en';
  if (raw === 'es' || raw.startsWith('es-') || ['spanish', 'español', 'espanol', 'espanhol'].includes(raw)) return 'es';
  if (raw === 'pt' || raw.startsWith('pt-') || ['br', 'ptbr', 'portuguese', 'português', 'portugues', 'portugués'].includes(raw)) return 'pt-BR';
  return null;
}

/** The language for a Discord locale (`interaction.locale`, `guild.preferredLocale`): es-ES and es-419 -> es, pt-BR -> pt-BR, else en. */
function languageFromLocale(locale) {
  for (const [lang, locales] of Object.entries(DISCORD_LOCALES)) {
    if (locales.includes(locale)) return lang;
  }
  return DEFAULT_LANGUAGE;
}

// The language of the command or event that is running, for helpers that are not handed one.
const languageStorage = new AsyncLocalStorage();

/** Runs `callback` with `lang` as the current language. */
function runWithLanguage(lang, callback) {
  return languageStorage.run(normalizeLanguage(lang) ?? DEFAULT_LANGUAGE, callback);
}

/** The language of the command or event that is running; English outside of one. */
function currentLanguage() {
  return languageStorage.getStore() ?? DEFAULT_LANGUAGE;
}

/**
 * The text of `key` in `lang`, in English when that language does not have it, and the key itself when nobody has it.
 * `{name}` is replaced by `vars.name`; a placeholder that is not in `vars` is left as it is, because many default texts
 * carry variables (`{user}`, `{server}`) that the template engine fills later.
 */
function t(lang, key, vars) {
  const catalog = CATALOGS[normalizeLanguage(lang) ?? DEFAULT_LANGUAGE];
  const text = catalog[key] ?? CATALOGS[DEFAULT_LANGUAGE][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

/**
 * A plural: `${key}.one` when `count` is 1, `${key}.other` otherwise, with `{count}` filled in (with the thousands separators
 * of the language) next to `vars`.
 */
function tn(lang, key, count, vars = {}) {
  return t(lang, `${key}.${Number(count) === 1 ? 'one' : 'other'}`, { count: formatNumber(lang, count), ...vars });
}

/**
 * A text the database keeps with an English default (a backup label, a form title, a thread name…): while it is still exactly
 * that default (`t('en', key)`), it is shown in `lang`; anything the server wrote is shown as it is.
 */
function defaultText(lang, stored, key) {
  return stored === t(DEFAULT_LANGUAGE, key) ? t(lang, key) : stored;
}

/** A number with the thousands separators of the language. */
function formatNumber(lang, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString(NUMBER_LOCALES[normalizeLanguage(lang) ?? DEFAULT_LANGUAGE]);
}

/** A number with exactly `digits` decimals, written the way the language does it ("2.5" in English, "2,5" in Portuguese). */
function formatDecimal(lang, value, digits = 1) {
  return Number(value).toLocaleString(NUMBER_LOCALES[normalizeLanguage(lang) ?? DEFAULT_LANGUAGE], { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

/** A list joined the way the language does it: "a, b and c", "a, b y c", "a, b e c" (`word: 'or'` for "a, b or c"). */
function formatList(lang, items, { word = 'and' } = {}) {
  const list = [...items].map(String);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} ${t(lang, word === 'or' ? 'common.or' : 'common.and')} ${list[list.length - 1]}`;
}

// A length of time in words, like the `ms` library writes it in English ("1 minute", "2 hours"): the largest unit, rounded.
const DURATION_UNITS = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000]];
function formatDuration(lang, value) {
  const msValue = Number(value);
  const abs = Math.abs(msValue);
  for (const [unit, size] of DURATION_UNITS) {
    if (abs >= size) {
      const amount = Math.round(msValue / size);
      return t(lang, `common.duration.${unit}.${abs >= size * 1.5 ? 'other' : 'one'}`, { count: amount });
    }
  }
  return t(lang, 'common.duration.ms', { count: msValue });
}

// Descriptions of commands. They stay written in English in each command's builder; the catalogs `cmd.<category>.js` hold
// them in every language under `cmd.<category>.<command>[.<group>][.<subcommand>][.opt.<option>].desc` (scripts/i18n-commands.js
// writes the English file and checks keeps it equal to the builders).

/** The catalog key of a description: `path` is the subcommand group and subcommand (none, one or both), `option` an option name. */
function commandDescriptionKey(category, commandName, path = [], option = null) {
  return ['cmd', category, commandName, ...path, ...(option ? ['opt', option] : []), 'desc'].join('.');
}

/**
 * The description of a command, subcommand or option in `lang` (`command` is a loaded command, which has `category`).
 * `fallback` (the English text of the builder) is used when the catalogs do not have it.
 */
function commandDescription(lang, command, path = [], option = null, fallback = '') {
  const category = command?.category ?? 'other';
  const name = command?.data?.name ?? '';
  const key = commandDescriptionKey(category, name, path, option);
  const text = t(lang, key);
  return text === key ? fallback : text;
}

/** `description_localizations` for Discord ({ 'es-ES', 'es-419', 'pt-BR' }) of one catalog key; empty when none is translated. */
function localizations(key) {
  const result = {};
  for (const [lang, locales] of Object.entries(DISCORD_LOCALES)) {
    const text = CATALOGS[lang][key];
    if (text === undefined) continue;
    for (const locale of locales) result[locale] = text;
  }
  return result;
}

/**
 * The JSON of a slash command (as `toJSON()` gives it) with the translated descriptions of the command, its subcommands and
 * options as `description_localizations`. Names are never localized. Used only for the commands registered with Discord.
 */
function localizeCommandJson(category, json) {
  const walk = (node, path) => {
    const copy = { ...node };
    const optionName = path.option ?? null;
    if (copy.description) {
      const found = localizations(commandDescriptionKey(category, json.name, path.parts, optionName));
      if (Object.keys(found).length) copy.description_localizations = { ...(copy.description_localizations ?? {}), ...found };
    }
    if (Array.isArray(node.options)) {
      copy.options = node.options.map((option) => (option.type === 1 || option.type === 2
        ? walk(option, { parts: [...path.parts, option.name] })
        : walk(option, { parts: path.parts, option: option.name })));
    }
    return copy;
  };
  return walk(json, { parts: [] });
}

// The language of each server, always answered from memory so a message or a command never waits for the database:
//   - when the bot is ready, one query loads every server that chose a language other than English (loadGuildLanguages);
//   - every few minutes the same query runs again in the background, and until it answers the values already known are served
//     (stale-while-revalidate);
//   - `!language`, the dashboard route and guildCreate write the new value at once (setCachedGuildLanguage);
//   - a server that is not known is English. Before the first load has answered, it is looked up once in the background and the
//     message goes on in English (or the last known language) instead of waiting.
const REFRESH_EVERY_MS = 5 * 60 * 1000;
const languages = new Map(); // guildId -> language, for servers that are not English or were set explicitly
const writtenAt = new Map(); // guildId -> when !language / the dashboard / a join wrote it (newer than a load that started before)
const lookups = new Map(); // guildId -> a single-server lookup in flight (only before the first load)
let loadedAt = 0; // when the last full load started; 0 = never loaded
let loading = null;
let refreshTimer = null;

/** The language of a server, from memory, never waiting: what the last load or change said, English when nothing is known. */
function peekGuildLanguage(guildId) {
  if (!guildId) return DEFAULT_LANGUAGE;
  const known = languages.get(guildId);
  if (known) return known;
  if (!loadedAt) lookupInBackground(guildId);
  return DEFAULT_LANGUAGE;
}

/** The language a server chose (`guilds.language`). Kept as a promise for the callers that await it; it never waits. */
function guildLanguage(guildId) {
  return Promise.resolve(peekGuildLanguage(guildId));
}

// Before the first load, a server that sends a message is looked up on its own (once), so it has its language a moment later.
function lookupInBackground(guildId) {
  if (lookups.has(guildId)) return;
  const started = Date.now();
  const lookup = Promise.resolve()
    .then(() => require('../db/guilds').findGuildLanguage(guildId)) // required here: `t` and the catalogs work without the database
    .then((value) => {
      if ((writtenAt.get(guildId) ?? 0) >= started || loadedAt >= started) return; // something newer already answered
      const lang = normalizeLanguage(value) ?? DEFAULT_LANGUAGE;
      if (lang === DEFAULT_LANGUAGE) languages.delete(guildId);
      else languages.set(guildId, lang);
    })
    .catch(() => { lookups.delete(guildId); }) // a failed lookup can be tried again by the next message
    .finally(() => { if (loadedAt) lookups.delete(guildId); });
  lookups.set(guildId, lookup);
}

/**
 * Loads the language of every server in one query (the servers that chose a language other than English; the rest are English)
 * and replaces what is in memory, except the servers changed after the load started. Never throws: on a database error the
 * values already known stay. Returns how many servers have a language other than English.
 */
function loadGuildLanguages() {
  if (loading) return loading;
  const started = Date.now();
  loading = Promise.resolve()
    .then(() => require('../db/guilds').listGuildLanguages())
    .then((rows) => {
      const next = new Map();
      for (const row of rows ?? []) {
        const lang = normalizeLanguage(row.language);
        if (lang && lang !== DEFAULT_LANGUAGE) next.set(String(row.guild_id), lang);
      }
      // A change written while the query was running is newer than what the query read.
      for (const [guildId, at] of writtenAt) {
        if (at >= started) {
          const lang = languages.get(guildId);
          if (lang) next.set(guildId, lang);
          else next.delete(guildId);
        }
      }
      languages.clear();
      for (const [guildId, lang] of next) languages.set(guildId, lang);
      loadedAt = started;
      lookups.clear();
      return languages.size;
    })
    .catch(() => languages.size)
    .finally(() => { loading = null; });
  return loading;
}

/** Loads the languages now and again every few minutes, in the background (called when the bot is ready). */
function startGuildLanguageRefresh({ everyMs = REFRESH_EVERY_MS } = {}) {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { loadGuildLanguages(); }, everyMs);
  refreshTimer.unref?.();
  return loadGuildLanguages();
}

/** Called right after `!language`, the dashboard or a join changes it, so the new language is used at once. */
function setCachedGuildLanguage(guildId, lang) {
  const value = normalizeLanguage(lang) ?? DEFAULT_LANGUAGE;
  writtenAt.set(guildId, Date.now());
  languages.set(guildId, value);
}

/** Forgets a server (when Petto leaves it). */
function forgetGuildLanguage(guildId) {
  languages.delete(guildId);
  writtenAt.delete(guildId);
}

/**
 * The language for a request of the website: the one it asks for (`?lang=`, `lang` in the body or the `x-petto-language`
 * header), then the browser's (`Accept-Language`), then the server's when the request is about one, else English.
 */
function requestLanguage(req, guildId = null) {
  const asked = normalizeLanguage(req?.query?.lang ?? req?.body?.lang ?? req?.get?.('x-petto-language'));
  if (asked) return asked;
  const browser = String(req?.get?.('accept-language') ?? '').split(',').map((part) => normalizeLanguage(part.split(';')[0].trim())).find(Boolean);
  if (browser) return browser;
  return guildId ? peekGuildLanguage(String(guildId)) : DEFAULT_LANGUAGE;
}

/** Saves the language a person chose for a server and uses it at once. */
async function setGuildLanguage(guildId, lang) {
  const value = normalizeLanguage(lang);
  if (!value) throw new Error(`Unknown language: ${lang}`);
  const { updateGuild } = require('../db/guilds');
  // Whoever calls this (`!language`, the buttons of the setup message) is choosing: Petto never offers to change it again.
  await updateGuild(guildId, { language: value, language_source: 'manual' });
  setCachedGuildLanguage(guildId, value);
  return value;
}

/**
 * The language to answer an interaction (or the pseudo-interaction of a prefix command) in: the one the dispatcher already
 * found (`pettoLang`), the server's inside a server, and the Discord language of the user in DMs.
 */
async function languageOf(interaction) {
  if (interaction?.pettoLang) return interaction.pettoLang;
  const guildId = interaction?.guildId ?? interaction?.guild?.id ?? null;
  if (guildId) return peekGuildLanguage(guildId);
  return languageFromLocale(interaction?.locale);
}

module.exports = {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  DISCORD_LOCALES,
  CATALOGS,
  t,
  tn,
  defaultText,
  formatNumber,
  formatDecimal,
  formatList,
  formatDuration,
  localizations,
  commandDescriptionKey,
  commandDescription,
  localizeCommandJson,
  normalizeLanguage,
  languageFromLocale,
  runWithLanguage,
  currentLanguage,
  guildLanguage,
  peekGuildLanguage,
  loadGuildLanguages,
  startGuildLanguageRefresh,
  forgetGuildLanguage,
  requestLanguage,
  setGuildLanguage,
  setCachedGuildLanguage,
  languageOf,
};
