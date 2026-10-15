// The translations of Petto (src/i18n): every English key exists in Spanish and Brazilian Portuguese with the same
// placeholders and the same Markdown, no key is written twice, and the texts fit the limits of Discord (100 characters for
// a slash command description, 80 for a button, 100 for a menu, 4000 for a whole Components V2 message).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Commands read the database layer when they load; nothing here talks to it.
const resolvedDb = require.resolve('../src/db/database');
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };

const i18n = require('../src/i18n');
const { LANGUAGES, CATALOGS, t, localizations, normalizeLanguage, languageFromLocale, languageOf, formatNumber } = i18n;

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales');
const problems = [];
const problem = (text) => problems.push(text);

// (d) Every key once: a JS object keeps only the last of two equal keys, so the files are read as text.
const KEY_LINE = /^\s*(['"])([^'"]+)\1\s*:/;
const seen = Object.fromEntries(LANGUAGES.map((lang) => [lang, new Map()]));
for (const lang of LANGUAGES) {
  const dir = path.join(LOCALES_DIR, lang);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js')).sort()) {
    const where = `${lang}/${file}`;
    const module = file.replace(/\.js$/, '');
    const keys = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').map((line) => KEY_LINE.exec(line)?.[2]).filter(Boolean);
    for (const key of keys) {
      if (seen[lang].has(key)) problem(`${where}: the key ${key} is duplicated (also in ${seen[lang].get(key)})`);
      else seen[lang].set(key, where);
      if (!key.startsWith(`${module}.`)) problem(`${where}: the key ${key} must start with "${module}." (one file per module)`);
    }
    const loaded = Object.keys(require(path.join(dir, file)));
    if (loaded.length !== keys.length) problem(`${where}: ${loaded.length} keys loaded but ${keys.length} written one per line; write each entry as 'key': 'text' on its own line`);
  }
}
for (const lang of LANGUAGES) {
  if (lang === 'en') continue;
  for (const file of fs.existsSync(path.join(LOCALES_DIR, lang)) ? fs.readdirSync(path.join(LOCALES_DIR, lang)) : []) {
    if (!fs.existsSync(path.join(LOCALES_DIR, 'en', file))) problem(`${lang}/${file} has no English file`);
  }
}

// (a) and (b) The same keys, placeholders and Markdown in the three languages.
const PLACEHOLDER = /\{[^{}\n]*\}/g;
const sorted = (list) => [...list].sort().join(' ');
const shapes = {
  placeholders: (text) => sorted(text.match(PLACEHOLDER) ?? []),
  'line breaks': (text) => (text.match(/\n/g) ?? []).length,
  'code marks (`)': (text) => (text.match(/`/g) ?? []).length,
  'bold marks (**)': (text) => (text.match(/\*\*/g) ?? []).length,
  'small text (-#)': (text) => (text.match(/(^|\n)-# /g) ?? []).length,
  'mentions, emojis and links': (text) => sorted(text.match(/<[@#:a][^>\s]*>|https?:\/\/[^\s)>]+/g) ?? []),
};
const english = CATALOGS.en;
for (const lang of LANGUAGES.filter((code) => code !== 'en')) {
  for (const key of Object.keys(english)) {
    const text = CATALOGS[lang][key];
    if (text === undefined) { problem(`${lang}: missing ${key}`); continue; }
    if (typeof text !== 'string' || !text.trim()) { problem(`${lang}: ${key} is empty`); continue; }
    for (const [name, shape] of Object.entries(shapes)) {
      if (shape(text) !== shape(english[key])) problem(`${lang}: ${key} has different ${name} than English (${JSON.stringify(shape(text))} vs ${JSON.stringify(shape(english[key]))})`);
    }
  }
  for (const key of Object.keys(CATALOGS[lang])) {
    if (!Object.hasOwn(english, key)) problem(`${lang}: ${key} is not in English (remove it or add the English text)`);
  }
}

// (c) The limits of Discord, by the ending of the key.
const LIMITS = [[/\.desc$/, 100, 'slash command description'], [/\.button$/, 80, 'button label'], [/\.menu$/, 100, 'menu text']];
for (const lang of LANGUAGES) {
  for (const [key, text] of Object.entries(CATALOGS[lang])) {
    for (const [pattern, max, what] of LIMITS) {
      if (pattern.test(key) && text.length > max) problem(`${lang}: ${key} is ${text.length} characters, a ${what} can have ${max}`);
    }
  }
}

// (c) And the descriptions as Discord gets them, every language of every command, subcommand and option.
const tooLong = (node, trail) => {
  const found = [];
  for (const [locale, text] of Object.entries({ default: node.description ?? '', ...(node.description_localizations ?? {}) })) {
    if (text.length > 100) found.push(`${trail} [${locale}] description is ${text.length} characters (max 100)`);
  }
  if (node.name_localizations && Object.keys(node.name_localizations).length) found.push(`${trail} has name_localizations: names of commands, subcommands and options are never translated`);
  for (const option of node.options ?? []) found.push(...tooLong(option, `${trail}/${option.name}`));
  return found;
};
const { findCommandFiles, COMMANDS_DIR } = require('../src/handlers/commandHandler');
for (const file of findCommandFiles(COMMANDS_DIR)) {
  const trail = path.relative(COMMANDS_DIR, file);
  try {
    const command = require(file);
    if (command?.data?.toJSON) problems.push(...tooLong(command.data.toJSON(), trail));
  } catch (err) {
    problem(`${trail} throws: ${String(err.message).split('\n')[0]}`);
  }
}

// Every key the code asks for by name exists in English (a typo would show the key to the member).
const used = new Map();
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (full !== LOCALES_DIR) scan(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(/\b(?:t\(\s*[^,()]+,|localizations\()\s*'([a-z][\w-]*(?:\.[\w-]+)+)'/g)) used.set(match[1], path.relative(ROOT, full));
  }
};
scan(path.join(ROOT, 'src'));
for (const [key, file] of used) if (!Object.hasOwn(english, key)) problem(`${file} uses ${key}, which is not in the English catalog`);

assert.deepEqual(problems, [], `Translation problems:\n${problems.join('\n')}`);

// How `t` and the language of a member work, on a sample key added for the check only.
const SAMPLE = { en: '**Guild Ping:** `{ms}`', es: '**Ping del servidor:** `{ms}`', 'pt-BR': '**Ping do servidor:** `{ms}`' };
for (const lang of LANGUAGES) CATALOGS[lang]['check.sample'] = SAMPLE[lang];
CATALOGS.en['check.english'] = 'Only in English';
assert.equal(t('en', 'check.sample', { ms: '5ms' }), '**Guild Ping:** `5ms`');
assert.equal(t('es', 'check.sample', { ms: '5ms' }), '**Ping del servidor:** `5ms`');
assert.equal(t('pt-BR', 'check.sample', { ms: '5ms' }), '**Ping do servidor:** `5ms`');
assert.equal(t('pt', 'check.sample', { ms: '5ms' }), '**Ping do servidor:** `5ms`', '"pt" is read as pt-BR');
assert.equal(t('fr', 'check.sample', { ms: '5ms' }), '**Guild Ping:** `5ms`', 'an unknown language is English');
assert.equal(t(undefined, 'check.sample', { ms: '5ms' }), '**Guild Ping:** `5ms`', 'no language is English');
assert.equal(t('es', 'check.english'), 'Only in English', 'a key missing in Spanish falls back to English');
assert.equal(t('es', 'nobody.has.this'), 'nobody.has.this', 'a key nobody has is shown as the key');
assert.equal(t('es', 'check.sample'), '**Ping del servidor:** `{ms}`', 'without values the text is returned as it is');
assert.equal(t('es', 'check.sample', { user: 'x' }), '**Ping del servidor:** `{ms}`', 'a placeholder without a value stays, for the template engine');
assert.equal(t('en', 'check.sample', { ms: '$& {x}' }), '**Guild Ping:** `$& {x}`', 'values are inserted as they are');
assert.deepEqual(localizations('check.sample'), { 'es-ES': SAMPLE.es, 'es-419': SAMPLE.es, 'pt-BR': SAMPLE['pt-BR'] }, 'Discord gets both Spanish locales');
assert.deepEqual(localizations('check.english'), {}, 'a missing translation is left to the English description');
for (const lang of LANGUAGES) delete CATALOGS[lang]['check.sample'];
delete CATALOGS.en['check.english'];
assert.equal(formatNumber('en', 15535), '15,535');
assert.equal(formatNumber('pt-BR', 15535), '15.535');

for (const [input, expected] of [['en', 'en'], ['ES', 'es'], ['es-419', 'es'], ['español', 'es'], ['pt', 'pt-BR'], ['pt-br', 'pt-BR'], ['pt_BR', 'pt-BR'], ['Português', 'pt-BR'], ['fr', null], ['', null], [null, null]]) {
  assert.equal(normalizeLanguage(input), expected, `normalizeLanguage(${JSON.stringify(input)})`);
}
for (const [locale, expected] of [['es-ES', 'es'], ['es-419', 'es'], ['pt-BR', 'pt-BR'], ['en-US', 'en'], ['fr', 'en'], [undefined, 'en']]) {
  assert.equal(languageFromLocale(locale), expected, `languageFromLocale(${locale})`);
}

// The components of a Components V2 message as text: what counts toward its 4000 characters.
const textLength = (node) => {
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + textLength(child), 0);
  if (!node || typeof node !== 'object') return 0;
  return Object.entries(node).reduce((sum, [key, value]) => sum + (['content', 'label', 'placeholder', 'description'].includes(key) && typeof value === 'string' ? value.length : textLength(value)), 0);
};
const json = (component) => JSON.parse(JSON.stringify(component.toJSON ? component.toJSON() : component));

(async () => {
  // In DMs the Discord language of the member; in a server the language of the server.
  assert.equal(await languageOf({ guildId: null, locale: 'es-419' }), 'es');
  assert.equal(await languageOf({ guildId: null, locale: 'pt-BR' }), 'pt-BR');
  assert.equal(await languageOf({ guildId: null, locale: 'de' }), 'en');
  assert.equal(await languageOf({ guildId: 'g1', pettoLang: 'es', locale: 'pt-BR' }), 'es', 'the language the dispatcher found');

  const guildsPath = require.resolve('../src/db/guilds');
  const rows = { g1: { language: 'pt-BR' }, g2: { language: 'pt' }, g3: { language: null } };
  let reads = 0;
  const updates = [];
  require.cache[guildsPath] = {
    id: guildsPath, filename: guildsPath, loaded: true,
    exports: {
      ensureGuild: async (id) => { reads += 1; if (id === 'broken') throw new Error('database down'); return rows[id]; },
      updateGuild: async (id, patch) => { updates.push([id, patch]); rows[id] = { ...rows[id], ...patch }; return rows[id]; },
    },
  };
  assert.equal(await languageOf({ guildId: 'g1', locale: 'es-ES' }), 'pt-BR', 'in a server the server decides, not the member');
  assert.equal(await i18n.guildLanguage('g1'), 'pt-BR');
  assert.equal(reads, 1, 'the language of a server is cached');
  assert.equal(await i18n.guildLanguage('g2'), 'pt-BR', 'an old "pt" is read as pt-BR');
  assert.equal(await i18n.guildLanguage('g3'), 'en', 'no language is English');
  assert.equal(await i18n.guildLanguage('broken'), 'en', 'a database error answers in English');
  assert.equal(await i18n.setGuildLanguage('g3', 'español'), 'es');
  assert.deepEqual(updates, [['g3', { language: 'es' }]], 'saved as the code');
  assert.equal(await i18n.guildLanguage('g3'), 'es', 'used at once');
  await assert.rejects(() => i18n.setGuildLanguage('g3', 'klingon'));

  // The translated cards fit the 4000 characters of a Components V2 message.
  const { buildPingCard } = require('../src/commands/info/ping');
  for (const lang of LANGUAGES) {
    const card = json(buildPingCard({ guildMs: 99999, apiMs: 99999, shard: 99, shardCount: 99, guilds: 9999999, members: 999999999, lang }));
    assert.ok(textLength(card) <= 4000, `the ${lang} ping card fits`);
  }
  const ping = (lang) => JSON.stringify(json(buildPingCard({ guildMs: 254, apiMs: 117.8, shard: 1, shardCount: 2, guilds: 15535, members: 4891774, lang })));
  assert.match(ping('es'), /\*\*Ping del servidor:\*\* `254ms`/);
  assert.match(ping('es'), /Servidor de soporte/);
  assert.match(ping('es'), /Shard 1\/2 • Servidores: 15,535 • Miembros: 4,891,774/);
  assert.match(ping('pt-BR'), /\*\*Ping da API:\*\* `118ms`/);
  assert.match(ping('pt-BR'), /Shard 1\/2 • Servidores: 15\.535 • Membros: 4\.891\.774/);
  assert.match(ping('pt-BR'), /https:\/\/petto\.sbs\/status/, 'links are not translated');

  // `!language`: shows the language in that language, changes it and answers in the new one.
  const language = require('../src/commands/config/language');
  for (const lang of LANGUAGES) {
    for (const card of [language.buildCurrentCard(lang, '!'), language.buildDoneCard(lang)]) {
      assert.ok(textLength(json(card)) <= 4000, `the ${lang} language card fits`);
    }
  }
  for (const [input, expected] of [['es', 'es'], ['set pt', 'pt-BR'], ['Español', 'es'], ['EN', 'en'], ['set', null], ['klingon', null]]) {
    assert.equal(language.readLanguageInput(input), expected, `!language ${input}`);
  }
  const run = async (guildId, value, extra = {}) => {
    const replies = [];
    const interaction = { guildId, guild: { id: guildId }, typedPrefix: '!', options: { getString: () => value }, reply: async (payload) => replies.push(payload), ...extra };
    await language.execute(interaction);
    return { interaction, text: JSON.stringify(replies.map((payload) => (payload.components ?? []).map(json).concat(payload.content ?? ''))) };
  };
  let result = await run('g1', null);
  assert.match(result.text, /Idioma do servidor:\*\* Português \(Brasil\)/, 'shown in the language of the server');
  assert.match(result.text, /!language <en\|es\|pt-BR>/);
  result = await run('g1', 'klingon');
  assert.match(result.text, /Não conheço esse idioma/, 'an unknown language is told in the current language');
  assert.equal(rows.g1.language, 'pt-BR', 'and nothing changes');
  result = await run('g1', 'set es');
  assert.equal(rows.g1.language, 'es', 'saved');
  assert.match(result.text, /Listo: ahora Petto habla \*\*Español\*\*/, 'the answer is already in the new language');
  assert.equal(result.interaction.pettoLang, 'es');
  assert.equal(await i18n.guildLanguage('g1'), 'es', 'the next command uses it at once');
  result = await run('g1', 'en', { pettoLang: 'es' });
  assert.match(result.text, /Done: Petto now speaks \*\*English\*\*/, 'back to English');
  const slash = language.data.toJSON();
  assert.equal(slash.default_member_permissions, String(require('discord.js').PermissionFlagsBits.ManageGuild), 'needs Manage Server');
  assert.deepEqual(slash.options[0].choices.map((choice) => choice.value), ['en', 'es', 'pt-BR']);
  assert.equal(slash.description_localizations['es-419'], CATALOGS.es['config.language.desc']);

  console.log(`Checked ${Object.keys(english).length} translation keys in ${LANGUAGES.join(', ')}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
