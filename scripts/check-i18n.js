// The translations of Petto (src/i18n): every English key exists in Spanish and Brazilian Portuguese with the same
// placeholders and the same Markdown, no key is written twice, the texts fit the limits of Discord (100 characters for
// a slash command description, 80 for a button, 100 for a menu, 4000 for a whole Components V2 message), the descriptions of
// the commands match their builders, and the translated files have no English text left written in the code.
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
const { LANGUAGES, CATALOGS, t, tn, localizations, normalizeLanguage, languageFromLocale, languageOf, formatNumber, formatDuration, formatList, formatDecimal, runWithLanguage, currentLanguage, localizeCommandJson } = i18n;
const { commandEntries, builderTexts } = require('./i18n-commands');
const { hardcodedText, filesUnder } = require('./find-hardcoded-text');

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

// A plural has both forms.
for (const key of Object.keys(english)) {
  const match = /^(.*)\.(one|other)$/.exec(key);
  if (match && !Object.hasOwn(english, `${match[1]}.${match[2] === 'one' ? 'other' : 'one'}`)) problem(`en: ${key} has no ${match[2] === 'one' ? '.other' : '.one'} form`);
}

// The descriptions of the commands in the catalogs are the ones of the builders, word for word (the English stays in the
// builder; scripts/i18n-commands.js writes the catalog). A category is checked once its English catalog exists.
const entries = commandEntries();
for (const [category, list] of Object.entries(entries)) {
  const file = path.join(LOCALES_DIR, 'en', `cmd.${category}.js`);
  if (!fs.existsSync(file)) continue;
  const catalog = require(file);
  const expected = new Map(list);
  for (const [key, text] of expected) {
    if (!Object.hasOwn(catalog, key)) problem(`en/cmd.${category}.js is missing ${key}: run node scripts/i18n-commands.js ${category}`);
    else if (catalog[key] !== text) problem(`en/cmd.${category}.js: ${key} is not the builder's text (${JSON.stringify(text)}): run node scripts/i18n-commands.js ${category}`);
  }
  for (const key of Object.keys(catalog)) if (!expected.has(key)) problem(`en/cmd.${category}.js: ${key} is no longer in the builders: run node scripts/i18n-commands.js ${category}`);
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

// What is registered with Discord: the localized descriptions fit, and `!language` is a prefix command only.
const { collectCommandData } = require('../src/handlers/commandHandler');
const registered = collectCommandData();
for (const json of registered) problems.push(...tooLong(json, `registered /${json.name}`));
if (registered.some((json) => json.name === 'language')) problem('!language must not be registered as a slash command');
if (require('../src/commands/config/language').registerSlash || require('../src/commands/config/language').slashOnly) problem('!language must stay prefix only (no registerSlash / slashOnly)');

// Every key the code asks for by name exists in English (a typo would show the key to the member).
const used = new Map();
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (full !== LOCALES_DIR) scan(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(/\b(t|tn)\((?:[^,()]|\([^()]*\))+,\s*'([a-z][\w-]*(?:\.[\w-]+)+)'/g)) {
      for (const key of match[1] === 'tn' ? [`${match[2]}.one`, `${match[2]}.other`] : [match[2]]) used.set(key, path.relative(ROOT, full));
    }
  }
};
scan(path.join(ROOT, 'src'));
for (const [key, file] of used) if (!Object.hasOwn(english, key)) problem(`${file} uses ${key}, which is not in the English catalog`);

// No English left written in the code of what is translated. Until every module is done, a file counts as translated once
// it uses src/i18n; SCAN_ALL then covers every file people read text from. Lines that must stay in English (logs, team
// notices, names that are never translated) carry `i18n-ignore`; files nobody outside the team reads start with
// `// i18n-ignore-file: <why>`.
const SCAN_ALL = false;
const SCANNED_DIRS = ['commands', 'interactions', 'events', 'jobs', 'utils', 'logging', 'handlers', 'imgutils'].map((dir) => path.join(ROOT, 'src', dir));
const ignoredTexts = builderTexts();
const USES_I18N = /require\(['"](?:\.\.?\/)+(?:\.\.\/)*i18n['"]\)/;
for (const file of SCANNED_DIRS.flatMap(filesUnder)) {
  const source = fs.readFileSync(file, 'utf8');
  if (!SCAN_ALL && !USES_I18N.test(source)) continue;
  for (const hit of hardcodedText(source)) {
    if (ignoredTexts.has(hit.text)) continue;
    problem(`${path.relative(ROOT, file)}:${hit.line} looks like English written in the code: ${JSON.stringify(hit.text)} (translate it, or mark the line with // i18n-ignore and why)`);
  }
}

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

  // A new server starts in the language of its community, a known one keeps its own (the real db/guilds on a fake table).
  const database = require('../src/db/database');
  const table = new Map([['old', { guild_id: 'old', prefix: '!', language: 'en' }]]);
  database.from = () => {
    const query = { filters: {}, payload: null };
    const result = () => {
      if (query.payload) {
        if (table.has(query.payload.guild_id)) return { data: null, error: new Error('duplicate key') };
        const row = { prefix: '!', language: 'en', ...query.payload };
        table.set(row.guild_id, row);
        return { data: row, error: null };
      }
      return { data: table.get(query.filters.guild_id) ?? null, error: null };
    };
    const api = {
      select: () => api,
      eq: (column, value) => { query.filters[column] = value; return api; },
      insert: (payload) => { query.payload = payload; return api; },
      maybeSingle: async () => result(),
      single: async () => result(),
    };
    return api;
  };
  const guildsDb = require('../src/db/guilds');
  let created = await guildsDb.createGuildIfMissing('new-es', { language: languageFromLocale('es-419') });
  assert.equal(created.created, true);
  assert.equal(table.get('new-es').language, 'es', 'a new Spanish-speaking server starts in Spanish');
  created = await guildsDb.createGuildIfMissing('old', { language: languageFromLocale('pt-BR') });
  assert.equal(created.created, false);
  assert.equal(table.get('old').language, 'en', 'a server Petto already knew keeps its language');
  assert.equal(await guildsDb.findGuildLanguage('nobody'), null, 'reading the language never makes a row');
  assert.equal(table.has('nobody'), false);
  for (const [locale, expected] of [['es-ES', 'es'], ['es-419', 'es'], ['pt-BR', 'pt-BR'], ['en-US', 'en'], ['fr', 'en'], ['pt-PT', 'en']]) {
    assert.equal(languageFromLocale(locale), expected, `a new server with preferredLocale ${locale}`);
  }

  // guildCreate makes the row first, with the language of guild.preferredLocale, and sends its messages in it.
  const stub = (relative, exports) => {
    const resolved = require.resolve(path.join(ROOT, relative));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const joins = [];
  stub('src/db/guilds.js', { createGuildIfMissing: async (id, defaults) => { joins.push([id, defaults]); return { row: { guild_id: id, prefix: '!', ...defaults }, created: true }; } });
  stub('src/utils/discordOps.js', { sendGuildLifecycleLog: async () => { joins.push(['language during the join', currentLanguage()]); } });
  stub('src/utils/autoModManager.js', { syncGuildAutoMod: async () => {} });
  stub('src/utils/onboarding.js', { commandMention: async () => '</setup:1>', commandSubcommandMention: async () => '', ensureAdminSetupChannel: async () => null, findFallbackChannel: () => null, buildAdminSetupMessage: () => ({}), buildOwnerGuide: () => ({}), sendSetupMessage: async () => null });
  delete require.cache[require.resolve('../src/events/guildCreate')];
  const guildCreate = require('../src/events/guildCreate');
  const fakeGuild = { id: 'joined', preferredLocale: 'pt-BR', name: 'Servidor', memberCount: 3, createdTimestamp: 0, client: { user: { id: '1' }, users: { fetch: async () => null } }, fetchOwner: async () => null, fetchAuditLogs: async () => { throw new Error('no access'); } };
  await guildCreate.execute(fakeGuild);
  assert.deepEqual(joins[0], ['joined', { language: 'pt-BR' }], 'guildCreate saves the language of preferredLocale');
  assert.deepEqual(joins[1], ['language during the join', 'pt-BR'], 'and runs the rest of the join in it');
  assert.equal(await i18n.guildLanguage('joined'), 'pt-BR', 'used at once');
  const thanks = guildCreate.buildThanksMessage('S', '</setup:1>', '!', 'es');
  assert.match(JSON.stringify(thanks.components.map(json)), /Gracias por agregar a Petto a S/);
  assert.match(JSON.stringify(guildCreate.buildThanksMessage('S', '</setup:1>', '!').components.map(json)), /Thanks for adding Petto to S/);

  const rows = { g1: { language: 'pt-BR' }, g2: { language: 'pt' }, g3: { language: null } };
  let reads = 0;
  const updates = [];
  stub('src/db/guilds.js', {
    findGuildLanguage: async (id) => { reads += 1; if (id === 'broken') throw new Error('database down'); if (id === 'slow') return new Promise(() => {}); return rows[id]?.language ?? null; },
    updateGuild: async (id, patch) => { updates.push([id, patch]); rows[id] = { ...rows[id], ...patch }; return rows[id]; },
  });
  assert.equal(await languageOf({ guildId: 'g1', locale: 'es-ES' }), 'pt-BR', 'in a server the server decides, not the member');
  assert.equal(await i18n.guildLanguage('g1'), 'pt-BR');
  assert.equal(reads, 1, 'the language of a server is cached');
  const together = await Promise.all([i18n.guildLanguage('g2'), i18n.guildLanguage('g2'), i18n.guildLanguage('g2')]);
  assert.deepEqual(together, ['pt-BR', 'pt-BR', 'pt-BR']);
  assert.equal(reads, 2, 'events that arrive together share one lookup');
  const slowStart = Date.now();
  assert.equal(await i18n.guildLanguage('slow'), 'en', 'a database that does not answer gives English');
  assert.ok(Date.now() - slowStart < 1500, 'without waiting long');
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
  const data = language.data.toJSON();
  assert.equal(data.default_member_permissions, String(require('discord.js').PermissionFlagsBits.ManageGuild), 'needs Manage Server');
  assert.deepEqual(data.options[0].choices.map((choice) => choice.value), ['en', 'es', 'pt-BR']);
  assert.deepEqual(language.aliases, ['lang']);
  assert.equal(registered.some((json) => json.name === 'language'), false, '!language is not a slash command');

  // The language of the running command or event reaches the helpers that are not handed one.
  assert.equal(currentLanguage(), 'en', 'English outside of a command');
  await runWithLanguage('es', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(currentLanguage(), 'es', 'kept across awaits and timers');
    assert.equal(require('../src/utils/duration').formatDuration(7_200_000), '2 horas');
    assert.equal(require('../src/utils/permissions').botCanAct({ kickable: false }, 'kick'), t('es', 'core.moderate.cannotKick'));
  });
  assert.equal(currentLanguage(), 'en');
  assert.equal(require('../src/utils/duration').formatDuration(7_200_000), '2 hours', 'English is unchanged');

  // The descriptions registered with Discord carry their translations, never translated names.
  CATALOGS.es['cmd.check.hug.desc'] = 'Abraza a alguien';
  CATALOGS.es['cmd.check.hug.opt.user.desc'] = 'A quién abrazar';
  const localized = localizeCommandJson('check', { name: 'hug', description: 'Hug someone', options: [{ type: 6, name: 'user', description: 'Who to hug' }] });
  assert.equal(localized.description_localizations['es-419'], 'Abraza a alguien');
  assert.equal(localized.options[0].description_localizations['es-ES'], 'A quién abrazar');
  assert.equal(localized.name_localizations, undefined);
  assert.equal(localized.options[0].name, 'user');
  delete CATALOGS.es['cmd.check.hug.desc'];
  delete CATALOGS.es['cmd.check.hug.opt.user.desc'];

  // The answers every command shares: the dispatcher, usage cards and lists.
  const { missingOptionCard, unknownSubcommandCard } = require('../src/utils/usageCard');
  const fakeCommand = { category: 'check', data: { name: 'demo', toJSON: () => ({ name: 'demo', options: [{ type: 1, name: 'create', description: 'Make one', options: [{ type: 3, name: 'name', description: 'The name', required: true }] }] }) } };
  for (const lang of LANGUAGES) {
    const unknown = JSON.stringify(unknownSubcommandCard({ command: fakeCommand, prefix: '!', name: 'demo', typed: 'crate', lang }).components.map(json));
    assert.ok(unknown.includes('!demo create'), `${lang}: the guess`);
    const missing = JSON.stringify(missingOptionCard({ command: fakeCommand, prefix: '!', name: 'demo', argText: 'create', missing: 'name', lang }).components.map(json));
    assert.ok(missing.includes(t(lang, 'core.usage.type.text')), `${lang}: the type of the option`);
  }
  assert.match(JSON.stringify(unknownSubcommandCard({ command: fakeCommand, prefix: '!', name: 'demo', typed: 'crate', lang: 'es' }).components.map(json)), /Quisiste decir/);
  assert.match(JSON.stringify(unknownSubcommandCard({ command: fakeCommand, prefix: '!', name: 'demo', typed: 'crate' }).components.map(json)), /Did you mean/, 'English by default');
  assert.equal(tn('pt-BR', 'core.pager.entries', 1), '1 item');
  assert.equal(tn('es', 'core.pager.entries', 1200), '1,200 entradas');
  assert.equal(formatList('pt-BR', ['a', 'b', 'c']), 'a, b e c');
  assert.equal(formatDecimal('pt-BR', 2.54), '2,5');
  assert.equal(formatDuration('es', 60_000), '1 minuto');
  assert.equal(require('../src/utils/permissionLabels').describePermissions(String(1n << 2n), 'pt-BR'), 'Banir membros');
  assert.equal(require('../src/utils/permissionLabels').describePermissions(String(1n << 2n), 'en'), 'Ban Members');

  console.log(`Checked ${Object.keys(english).length} translation keys in ${LANGUAGES.join(', ')}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
