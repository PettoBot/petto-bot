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

// The language of each server, kept a few minutes so a command does not read the database every time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1000;
const guildCache = new Map(); // guildId -> { lang, expiresAt }
const pending = new Map(); // guildId -> the lookup in flight

/**
 * The language a server chose (`guilds.language`). A slow database never makes Petto answer in the wrong language for long:
 * after 1 second the last language known for the server is used (English if none is known yet), and the lookup still finishes
 * in the background and fills the cache, so the next message has it. A failed lookup is not cached, so the next one tries again.
 */
function guildLanguage(guildId) {
  if (!guildId) return Promise.resolve(DEFAULT_LANGUAGE);
  const cached = guildCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.lang);
  const fallback = cached?.lang ?? DEFAULT_LANGUAGE;
  // Many events of one server arrive together: they share one lookup.
  if (!pending.has(guildId)) {
    const lookup = Promise.resolve()
      .then(() => require('../db/guilds').findGuildLanguage(guildId)) // required here: `t` and the catalogs work without the database
      .then((value) => {
        const lang = normalizeLanguage(value) ?? DEFAULT_LANGUAGE;
        // `!language` or the dashboard may have set it while the lookup was running: theirs is newer.
        const now = guildCache.get(guildId);
        if (!now || now.setAt < started) guildCache.set(guildId, { lang, expiresAt: Date.now() + CACHE_TTL_MS, setAt: Date.now() });
        return guildCache.get(guildId).lang;
      })
      .catch(() => null)
      .finally(() => pending.delete(guildId));
    const started = Date.now();
    pending.set(guildId, lookup);
  }
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS); });
  return Promise.race([pending.get(guildId), timeout]).then((lang) => {
    clearTimeout(timer);
    return lang ?? fallback;
  });
}

/** Called right after `!language` changes it, so the new language is used at once instead of when the cache runs out. */
function setCachedGuildLanguage(guildId, lang) {
  guildCache.set(guildId, { lang: normalizeLanguage(lang) ?? DEFAULT_LANGUAGE, expiresAt: Date.now() + CACHE_TTL_MS, setAt: Date.now() });
}

/** Saves the language of a server and uses it at once. */
async function setGuildLanguage(guildId, lang) {
  const value = normalizeLanguage(lang);
  if (!value) throw new Error(`Unknown language: ${lang}`);
  const { updateGuild } = require('../db/guilds');
  await updateGuild(guildId, { language: value });
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
  if (guildId) return guildLanguage(guildId);
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
  setGuildLanguage,
  setCachedGuildLanguage,
  languageOf,
};
