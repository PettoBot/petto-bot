// The languages Petto speaks: `t(lang, key, vars)` and the language of each server.
//
// The catalogs live in src/i18n/locales/<lang>/<module>.js, one flat object per module whose keys all start with the
// module name (`info.ping.title` lives in info.js). English is the reference: a key missing in es or pt-BR falls back to
// English, and `npm run check` (scripts/check-i18n.js) fails when a key or a `{placeholder}` is missing.
//
// Key endings that carry a Discord limit, checked by scripts/check-i18n.js:
//   `.desc`   description of a slash command, subcommand or option (100 characters)
//   `.button` label of a button (80 characters)
//   `.menu`   label, description or placeholder of a select menu (100 characters)
const fs = require('node:fs');
const path = require('node:path');

const LANGUAGES = ['en', 'es', 'pt-BR'];
const DEFAULT_LANGUAGE = 'en';
// The name of each language, written in that language (they are never translated).
const LANGUAGE_NAMES = { en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' };
// The Discord locales each language answers for, in descriptions of slash commands and for `interaction.locale`.
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

/** The language for a Discord locale (`interaction.locale`): Spanish for es-ES and es-419, Portuguese for pt-BR, else English. */
function languageFromLocale(locale) {
  for (const [lang, locales] of Object.entries(DISCORD_LOCALES)) {
    if (locales.includes(locale)) return lang;
  }
  return DEFAULT_LANGUAGE;
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

/** `setDescriptionLocalizations` of a slash command, subcommand or option: { 'es-ES', 'es-419', 'pt-BR' } from the catalogs. */
function localizations(key) {
  const result = {};
  for (const [lang, locales] of Object.entries(DISCORD_LOCALES)) {
    const text = CATALOGS[lang][key];
    if (text === undefined) continue;
    for (const locale of locales) result[locale] = text;
  }
  return result;
}

/** A number with the thousands separators of the language. */
function formatNumber(lang, value) {
  return Number(value).toLocaleString(NUMBER_LOCALES[normalizeLanguage(lang) ?? DEFAULT_LANGUAGE]);
}

// The language of each server, kept a few minutes so a command does not read the database every time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const guildCache = new Map(); // guildId -> { lang, expiresAt }

/** The language a server chose (`guilds.language`), English when it chose none or the database cannot be read. */
async function guildLanguage(guildId) {
  if (!guildId) return DEFAULT_LANGUAGE;
  const cached = guildCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.lang;
  let lang = DEFAULT_LANGUAGE;
  try {
    // Required here: the catalogs and `t` work without the database (the checks load them alone).
    const { ensureGuild } = require('../db/guilds');
    const row = await ensureGuild(guildId);
    lang = normalizeLanguage(row?.language) ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE; // not cached, so the next message tries again
  }
  guildCache.set(guildId, { lang, expiresAt: Date.now() + CACHE_TTL_MS });
  return lang;
}

/** Called right after `!language` changes it, so the new language is used at once instead of when the cache runs out. */
function setCachedGuildLanguage(guildId, lang) {
  guildCache.set(guildId, { lang: normalizeLanguage(lang) ?? DEFAULT_LANGUAGE, expiresAt: Date.now() + CACHE_TTL_MS });
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
  localizations,
  formatNumber,
  normalizeLanguage,
  languageFromLocale,
  guildLanguage,
  setGuildLanguage,
  setCachedGuildLanguage,
  languageOf,
};
