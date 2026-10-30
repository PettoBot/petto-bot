// The language a new server starts in: `detectGuildLanguage` (the explicit locale, else the words of the server), the first row of a server made
// with it by whichever part of Petto needs the row first, the setup message that says what was chosen and why, and the buttons that change it
// (only with Manage Server, never for a language somebody chose). The database and Discord are replaced; nothing is sent anywhere.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { detectGuildLanguage, describeDetection, normalizeText } = require('../src/i18n/detect');

const ROOT = path.join(__dirname, '..');
const collection = (names, extra = {}) => new Collection(names.map((name, index) => [String(index), { id: String(index), name, ...extra }]));
const server = ({ name = 'Server', description = null, locale = 'en-US', channels = [], roles = [], system = null, rules = null } = {}) => ({
  id: '111111111111111111',
  name,
  description,
  preferredLocale: locale,
  channels: { cache: collection(channels) },
  roles: { cache: collection(roles) },
  systemChannel: system ? { name: system } : null,
  rulesChannel: rules ? { name: rules } : null,
});

// ---------------------------------------------------------------------------------------------------------------- detection
// Real-looking servers. None of them is a Community server: Discord says en-US for all of them.
const spanish = server({
  name: 'Comunidad Gamer LATAM',
  channels: ['📢┃anuncios', '📜┃reglas', '👋┃bienvenidas', '💬┃charla-general', '💡┃sugerencias', '🎮┃general', '🔊 Sala de voz 1'],
  roles: ['Administradores', 'Moderadores', 'Miembros', '@everyone'],
});
let found = detectGuildLanguage(spanish);
assert.equal(found.language, 'es', 'a Spanish server that reports en-US is Spanish');
assert.equal(found.source, 'words');
assert.ok(found.words.includes('reglas') && found.words.includes('bienvenidas'), `the words found are listed: ${found.words}`);
assert.equal(describeDetection(found).startsWith('es (locale en-US, words: '), true, 'the log line says the language, the locale and the words');
assert.ok(!describeDetection(found).includes('Comunidad Gamer'), 'the log has words of the list, never the names of the server');

const portuguese = server({
  name: 'Brasil Games',
  description: 'O melhor servidor para jogar com os amigos. Seja bem-vindo!',
  channels: ['📢┃avisos', '📜┃regras', '👋┃boas-vindas', '💬┃bate-papo', '💡┃sugestões', '🛟┃suporte', '🎵┃músicas'],
  roles: ['Admin', 'Membros', 'Staff'],
});
found = detectGuildLanguage(portuguese);
assert.equal(found.language, 'pt-BR', 'a Portuguese server that reports en-US is Portuguese');
assert.equal(found.source, 'words');
assert.ok(found.words.includes('regras') && found.words.includes('boas vindas'), `the words found: ${found.words}`);

const english = server({
  name: 'Chill Lounge',
  description: 'Welcome to our community! Join us and make friends.',
  channels: ['welcome', 'rules', 'announcements', 'general', 'chat', 'suggestions', 'support', 'off-topic', 'music'],
  roles: ['Admin', 'Moderators', 'Members'],
});
found = detectGuildLanguage(english);
assert.equal(found.language, 'en');
assert.equal(found.source, 'default', 'English is what is left when nothing points to another language');
assert.ok(found.scores.en >= 4, 'and the English words were counted');

found = detectGuildLanguage(server());
assert.deepEqual([found.language, found.source], ['en', 'default'], 'an empty server is English');
assert.deepEqual(detectGuildLanguage({}).language, 'en', 'and so is an object with nothing');
assert.deepEqual(detectGuildLanguage(null).language, 'en', 'and so is no object at all');

const bilingual = server({
  name: 'Friends Hub',
  channels: ['welcome', 'bienvenidos', 'rules', 'reglas', 'announcements', 'anuncios', 'chat'],
});
found = detectGuildLanguage(bilingual);
assert.equal(found.language, 'en', 'a server that is as English as it is Spanish does not guess: English');
assert.equal(found.scores.es >= 2 && found.scores.en >= 2, true);
assert.equal(detectGuildLanguage(server({ channels: ['welcome', 'rules', 'bienvenidos', 'reglas', 'anuncios', 'charla', 'sugerencias'] })).language, 'es', 'with more Spanish than English it is Spanish');

// The first signal: an explicit locale is trusted, whatever the words say.
assert.deepEqual([detectGuildLanguage(server({ locale: 'es-ES' })).language, detectGuildLanguage(server({ locale: 'es-ES' })).source], ['es', 'locale']);
assert.equal(detectGuildLanguage(server({ locale: 'es-419', channels: ['welcome', 'rules', 'support'] })).language, 'es', 'es-419 wins over English channel names');
assert.equal(detectGuildLanguage(server({ locale: 'pt-BR' })).language, 'pt-BR');
assert.equal(detectGuildLanguage(server({ locale: 'pt-PT' })).language, 'pt-BR', 'pt-PT is Portuguese too (Petto has one Portuguese)');
assert.equal(detectGuildLanguage(server({ locale: 'es-ES' })).words.length, 0);
// Any other locale says nothing: the words decide (a French Community server with Spanish channels is Spanish, one with nothing is English).
assert.equal(detectGuildLanguage({ ...spanish, preferredLocale: 'fr' }).language, 'es');
assert.equal(detectGuildLanguage(server({ locale: 'fr' })).language, 'en');
assert.equal(detectGuildLanguage(server({ locale: 'en-GB', channels: ['reglas', 'anuncios', 'charla'] })).language, 'es', 'en-US and en-GB say nothing either');

// "Clearly wins": two distinct words, and more than the others.
assert.equal(detectGuildLanguage(server({ channels: ['reglas', 'general', 'chat'] })).language, 'en', 'one word is not enough');
assert.equal(detectGuildLanguage(server({ channels: ['reglas', 'reglas-2', 'reglas'] })).language, 'en', 'the same word many times is one word');
assert.equal(detectGuildLanguage(server({ channels: ['reglas', 'anuncios'] })).language, 'es');
assert.equal(detectGuildLanguage(server({ channels: ['anuncios', 'avisos', 'musica', 'noticias'] })).language, 'en', 'words that Spanish and Portuguese share cannot choose between them');
assert.equal(detectGuildLanguage(server({ channels: ['regras', 'reglas', 'anuncios'] })).language, 'en', 'a tie between Portuguese and Spanish is English: no guessing');
assert.equal(detectGuildLanguage(server({ name: 'Los Angeles Roleplay', channels: ['las-vegas', 'el-paso'] })).language, 'en', 'a name with los/las/el is not Spanish: function words only count in a description');
assert.equal(detectGuildLanguage(server({ description: 'Bienvenidos a nuestra comunidad: aquí puedes hablar con los demás.' })).language, 'es', 'a description counts');
// What is not read: the role of a bot (named after the bot) and everything past the limit.
assert.equal(detectGuildLanguage({ ...server(), roles: { cache: new Collection([['1', { name: 'reglas', managed: true }], ['2', { name: 'anuncios', managed: true }]]) } }).language, 'en');
assert.equal(detectGuildLanguage(server({ channels: [...Array(400).fill('x'), 'reglas', 'anuncios'] })).language, 'en', 'a huge server is read only up to a limit');
// The system channel, the rules channel and the categories are read too.
assert.equal(detectGuildLanguage(server({ system: 'bienvenidas', rules: 'reglas' })).language, 'es');
assert.equal(detectGuildLanguage(server({ channels: ['━━━ INFORMACIÓN ━━━', '「📜」NORMAS', 'ＲＥＧＬＡＳ'] })).language, 'es', 'accents, symbols and wide letters do not hide a word');
assert.equal(normalizeText('📢┃Anuncios—Ñandú'), 'anuncios nandu');
assert.equal(detectGuildLanguage({ ...spanish, channels: undefined, roles: null }).source, 'default', 'a guild with no channels or roles does not break it (and the name alone is one word at most)');

// ---------------------------------------------------------------------------------------------------------------- the first row
const database = require('../src/db/database');
const table = new Map([['old', { guild_id: 'old', prefix: '!', language: 'en', language_source: null }]]);
const inserts = [];
let failColumn = false;
let raceRow = null; // another part of Petto inserts this row between the select and the insert
database.from = () => {
  const query = { filters: {}, payload: null };
  const result = () => {
    if (query.payload) {
      inserts.push(query.payload);
      if (raceRow) { table.set(raceRow.guild_id, raceRow); raceRow = null; }
      if (table.has(query.payload.guild_id)) return { data: null, error: new Error('duplicate key') };
      if (failColumn && 'language_source' in query.payload) return { data: null, error: new Error('column "language_source" does not exist') };
      const row = { prefix: '!', language: 'en', language_source: null, created_at: new Date(), ...query.payload };
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
const logs = [];
const logger = require('../src/utils/logger');
const realInfo = logger.info;
logger.info = (...args) => { logs.push(args.join(' ')); };

(async () => {
  // Whichever code needs the row first (a message, a command, the dashboard) makes it with the detected language: here `ensureGuild`.
  const cache = new Map([['spanish-1', { ...spanish, id: 'spanish-1' }], ['english-1', { ...english, id: 'english-1' }], ['broken-1', { get name() { throw new Error('boom'); } }]]);
  guildsDb.setGuildLookup((id) => cache.get(id));
  let row = await guildsDb.ensureGuild('spanish-1');
  assert.deepEqual([row.language, row.language_source], ['es', 'auto'], 'the first row made by ensureGuild, not by the join, has the detected language');
  assert.equal(await require('../src/i18n').guildLanguage('spanish-1'), 'es', 'and it is used at once, not after the next load');
  assert.equal(logs.filter((line) => line.startsWith('language of spanish-1: es (locale en-US, words: ')).length, 1, 'one log line for the new server');
  await guildsDb.ensureGuild('spanish-1');
  assert.equal(logs.filter((line) => line.includes('spanish-1')).length, 1, 'and only one: a known server is not logged again');
  row = await guildsDb.ensureGuild('english-1');
  assert.deepEqual([row.language, row.language_source], ['en', 'auto']);
  assert.ok(logs.some((line) => line === 'language of english-1: en (locale en-US, words: none)'));
  row = await guildsDb.ensureGuild('unknown-1');
  assert.deepEqual([row.language, row.language_source], ['en', null], 'a server Petto cannot see (not in the cache) gets the plain row');
  row = await guildsDb.ensureGuild('broken-1');
  assert.equal(row.language, 'en', 'a guild that cannot be read does not stop the row from being made');

  // The join makes the row with the same detection, and a server that already has a row keeps it.
  let created = await guildsDb.createGuildIfMissing('join-es', {}, { ...portuguese, id: 'join-es' });
  assert.deepEqual([created.created, created.row.language, created.row.language_source], [true, 'pt-BR', 'auto']);
  created = await guildsDb.createGuildIfMissing('old', {}, { ...spanish, id: 'old' });
  assert.deepEqual([created.created, created.row.language, created.row.language_source], [false, 'en', null], 'a server that was here before keeps its language and is not marked');
  assert.equal(table.get('old').language, 'en');
  created = await guildsDb.createGuildIfMissing('join-fr', { prefix: '?' }, { ...spanish, id: 'join-fr' });
  assert.deepEqual([created.row.prefix, created.row.language], ['?', 'es'], 'what the join sets is kept next to the language');

  // A message made the row at the same moment: that row stays, and the join sees it was not the one that made it.
  raceRow = { guild_id: 'race-1', prefix: '!', language: 'es', language_source: 'auto', created_at: new Date() };
  created = await guildsDb.createGuildIfMissing('race-1', {}, { ...spanish, id: 'race-1' });
  assert.deepEqual([created.created, created.row.language], [false, 'es']);
  raceRow = { guild_id: 'race-2', prefix: '!', language: 'en', language_source: null, created_at: new Date() };
  assert.equal((await guildsDb.ensureGuild('race-2')).guild_id, 'race-2', 'ensureGuild also reads the row another part of Petto made at the same moment');

  // A database without the new column still gets its row (the plain one), instead of every command failing.
  failColumn = true;
  cache.set('spanish-2', { ...spanish, id: 'spanish-2' });
  row = await guildsDb.ensureGuild('spanish-2');
  assert.deepEqual([row.guild_id, row.language], ['spanish-2', 'en'], 'without the column the plain row is made');
  failColumn = false;
  logger.info = realInfo;

  // ----------------------------------------------------------------------------------------------- what guildCreate offers
  const { ownDetection } = require('../src/events/guildCreate');
  const detection = detectGuildLanguage(spanish);
  const fresh = { language: 'es', language_source: 'auto', created_at: new Date() };
  assert.deepEqual(ownDetection(fresh, true, detection), { language: 'es', source: 'words', words: detection.words }, 'a row the join just made: explained');
  assert.ok(ownDetection(fresh, false, detection), 'a row that a message made a moment before with the same language: explained too');
  assert.equal(ownDetection({ ...fresh, language_source: 'manual' }, false, detection), null, 'a language somebody chose is never offered for change');
  assert.equal(ownDetection({ ...fresh, language_source: null }, false, detection), null, 'neither one from before the column existed');
  assert.equal(ownDetection({ ...fresh, created_at: new Date(Date.now() - 3 * 3600_000) }, false, detection), null, 'neither a server that was here for hours (a repeated join event)');
  assert.equal(ownDetection({ ...fresh, language: 'en' }, false, detection), null, 'neither a row that says something else than what was found');
  assert.equal(ownDetection({ prefix: '!' }, false, detection), null, 'a join whose row could not be read offers nothing');

  // ----------------------------------------------------------------------------------------------- the setup message
  const { buildAdminSetupMessage, buildOwnerGuide } = require('../src/utils/onboarding');
  const { parseCustomId, customId } = require('../src/utils/languageChoice');
  const GUILD = '222222222222222222';
  const json = (payload) => payload.components.map((component) => component.toJSON());
  const text = (payload) => JSON.stringify(json(payload));
  const buttons = (payload) => JSON.stringify(json(payload)).match(/"custom_id":"plang:[^"]+"/g) ?? [];
  const base = { botId: '1', setupMention: '</setup:1>', reportConfigMention: '</report config:1>', prefix: '!', guildId: GUILD };
  const choice = { language: 'es', source: 'words', words: ['reglas', 'bienvenidas'] };

  let message = buildAdminSetupMessage({ ...base, languageChoice: choice, lang: 'es' });
  assert.deepEqual(buttons(message), ['en', 'es', 'pt-BR'].map((code) => `"custom_id":"plang:a:${GUILD}:${code}"`), 'a button for each language');
  assert.match(text(message), /Petto eligió \*\*Español\*\*/, 'it says what was chosen, in that language');
  assert.match(text(message), /`reglas`, `bienvenidas`/, 'and why: the words');
  assert.ok(['English', 'Español', 'Português'].every((label) => text(message).includes(`"label":"${label}"`)), 'the buttons are named in their own language');
  message = buildAdminSetupMessage({ ...base, languageChoice: { language: 'pt-BR', source: 'locale' }, lang: 'pt-BR' });
  assert.match(text(message), /O Petto escolheu \*\*Português \(Brasil\)\*\* porque o idioma preferido/);
  message = buildAdminSetupMessage({ ...base, languageChoice: { language: 'en', source: 'default', words: [] }, lang: 'en' });
  assert.match(text(message), /Petto chose \*\*English\*\* because nothing in this server pointed to another language/);
  assert.match(text(message), /only people with \*\*Manage Server\*\* can/);
  assert.equal(buttons(buildAdminSetupMessage({ ...base, languageChoice: choice, dm: true, guildName: 'X' }))[0], `"custom_id":"plang:d:${GUILD}:en"`, 'the direct message has its own kind');
  assert.equal(buttons(buildAdminSetupMessage({ ...base, languageChoice: choice, fallback: true }))[0], `"custom_id":"plang:f:${GUILD}:en"`);
  assert.equal(buttons(buildOwnerGuide({ guild: { id: GUILD, name: 'S' }, setupChannel: null, setupMention: '</setup:1>', prefix: '!', languageChoice: choice, lang: 'es' }))[2], `"custom_id":"plang:o:${GUILD}:pt-BR"`, 'the guide for the owner has them too');
  assert.equal(buttons(buildAdminSetupMessage({ ...base, languageChoice: null })).length, 0, 'a server whose language somebody chose gets nothing about it');
  assert.equal(buttons(buildAdminSetupMessage({ ...base, guildId: null, languageChoice: choice })).length, 0);
  assert.ok(text(buildAdminSetupMessage({ ...base, languageChoice: choice, languageDone: true, lang: 'es' })).includes('Listo: Petto ahora habla **Español**'), 'after a change it says it is done');
  for (const length of [customId('admin', GUILD, 'pt-BR'), customId('owner', GUILD, 'es')].map((id) => id.length)) assert.ok(length <= 100, 'a custom id fits Discord');
  assert.deepEqual(parseCustomId(`plang:o:${GUILD}:pt-BR`), { kind: 'owner', guildId: GUILD, language: 'pt-BR' });
  for (const bad of ['plang:x:1:es', `plang:a:${GUILD}:fr`, `plang:a:abc:es`, 'plang:a', '']) assert.equal(parseCustomId(bad), null, `${bad} is not one of them`);

  // ----------------------------------------------------------------------------------------------- the buttons
  const stub = (relative, exports) => {
    const resolved = require.resolve(path.join(ROOT, relative));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const saved = [];
  const redrawn = [];
  const row2 = { guild_id: GUILD, prefix: '?', language: 'es', language_source: 'auto', setup_channel_id: 'c' };
  stub('src/db/guilds.js', {
    ensureGuild: async () => row2,
    updateGuild: async (id, patch) => { saved.push([id, patch]); Object.assign(row2, patch); return row2; },
    findGuildLanguage: async () => row2.language, listGuildLanguages: async () => [],
  });
  stub('src/utils/panelRefresh.js', { refreshGuildPanels: async (guild, lang) => { redrawn.push([guild.id, lang]); return { total: 0 }; } });
  delete require.cache[require.resolve('../src/interactions/languageChoice')];
  const { handleButton } = require('../src/interactions/languageChoice');

  const makeGuild = (members = new Map()) => ({
    id: GUILD, name: 'Servidor',
    client: { user: { id: '1' }, guilds: { cache: new Map() } },
    commands: { fetch: async () => new Collection() },
    members: { fetch: async (id) => { const member = members.get(id); if (!member) throw new Error('unknown member'); return member; } },
  });
  const member = (canManage) => ({ permissions: { has: (flag) => canManage && flag === PermissionFlagsBits.ManageGuild } });
  const press = (guild, { id, inGuild = true, canManage = false, locale = 'en-US', guildId = GUILD } = {}) => {
    const calls = [];
    const interaction = {
      customId: id, client: guild.client, guildId: inGuild ? guildId : null, locale, user: { id: 'u1' }, member: inGuild ? member(canManage) : null, calls,
      reply: async (payload) => { calls.push(['reply', payload]); },
      deferUpdate: async () => { calls.push(['defer']); },
      editReply: async (payload) => { calls.push(['edit', payload]); },
      followUp: async (payload) => { calls.push(['followUp', payload]); },
    };
    return interaction;
  };
  const guild = makeGuild(new Map([['u1', member(true)]]));
  guild.client.guilds.cache.set(GUILD, guild);

  // Somebody without Manage Server gets a private refusal and nothing changes.
  require('../src/i18n').setCachedGuildLanguage(GUILD, 'es'); // what Petto detected a moment ago
  let click = press(guild, { id: customId('admin', GUILD, 'pt-BR'), canManage: false });
  await handleButton(click);
  assert.equal(click.calls.length, 1);
  assert.equal(click.calls[0][0], 'reply');
  assert.equal(click.calls[0][1].flags, 64, 'private (ephemeral)');
  assert.match(click.calls[0][1].content, /Gestionar servidor/, 'in the language of the server');
  assert.deepEqual(saved, [], 'nothing was saved');

  // Somebody with it changes the language: saved as chosen, and the message is rebuilt in the new language and says it is done.
  click = press(guild, { id: customId('admin', GUILD, 'pt-BR'), canManage: true });
  await handleButton(click);
  assert.deepEqual(click.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.deepEqual(saved, [[GUILD, { language: 'pt-BR', language_source: 'manual' }]], 'saved as chosen by a person');
  const edited = click.calls[1][1];
  assert.equal(edited.flags, 1 << 15, 'still a Components V2 message');
  assert.match(text(edited), /Pronto: o Petto agora fala \*\*Português \(Brasil\)\*\*/, 'done, in the new language');
  assert.match(text(edited), /Configuração do Petto/, 'and the whole setup message follows it');
  assert.match(text(edited), /`\?language`/, 'with the prefix of the server');
  assert.equal(await require('../src/i18n').guildLanguage(GUILD), 'pt-BR', 'used at once');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(redrawn, [[GUILD, 'pt-BR']], 'the panels already posted are redrawn like !language does');
  assert.equal(ownDetection({ ...row2, created_at: new Date() }, false, detectGuildLanguage(portuguese)), null, 'after that the language is chosen: it is never offered again');

  // The same buttons in a direct message (no server in the interaction): the person is looked up in the server.
  saved.length = 0;
  click = press(guild, { id: customId('dm', GUILD, 'en'), inGuild: false, locale: 'en-US' });
  await handleButton(click);
  assert.deepEqual(click.calls.map(([kind]) => kind), ['defer', 'edit'], 'the owner can change it from the direct message');
  assert.match(text(click.calls[1][1]), /Done: Petto now speaks \*\*English\*\*/);
  const stranger = makeGuild(new Map([['u1', member(false)]]));
  stranger.client.guilds.cache.set(GUILD, stranger);
  click = press(stranger, { id: customId('owner', GUILD, 'es'), inGuild: false });
  await handleButton(click);
  assert.equal(click.calls[0][0], 'reply', 'a person of the server without Manage Server is refused in a direct message too');
  assert.equal(saved.length, 1, 'and nothing else was saved');
  const outsider = makeGuild(new Map());
  outsider.client.guilds.cache.set(GUILD, outsider);
  click = press(outsider, { id: customId('owner', GUILD, 'es'), inGuild: false });
  await handleButton(click);
  assert.equal(click.calls[0][0], 'reply', 'somebody who is not in the server is refused');
  assert.equal(saved.length, 1);

  // Tied to one server: from another server, or after Petto left, they do nothing.
  click = press(guild, { id: customId('admin', GUILD, 'es'), canManage: true, guildId: '333333333333333333' });
  await handleButton(click);
  assert.equal(click.calls[0][0], 'reply');
  assert.equal(saved.length, 1);
  guild.client.guilds.cache.delete(GUILD);
  click = press(guild, { id: customId('admin', GUILD, 'es'), canManage: true });
  await handleButton(click);
  assert.equal(click.calls[0][0], 'reply');
  assert.match(click.calls[0][1].content, /no longer in that server/);
  click = press(guild, { id: 'plang:z:1:es', canManage: true });
  await handleButton(click);
  assert.equal(click.calls[0][0], 'reply', 'a made-up id is refused');
  assert.equal(saved.length, 1);

  // ----------------------------------------------------------------------------------------------- the hint of the first slash command
  stub('src/db/guilds.js', {
    ensureGuild: async () => row2,
    updateGuild: async (id, patch) => { saved.push([id, patch]); Object.assign(row2, patch); return row2; },
  });
  delete require.cache[require.resolve('../src/utils/languageHint')];
  const { maybeHintLanguage } = require('../src/utils/languageHint');
  const slash = (guildId, { locale = 'es-ES', canManage = true, replied = true } = {}) => {
    const calls = [];
    return { calls, guildId, locale, replied, deferred: false, member: member(canManage), followUp: async (payload) => { calls.push(payload); } };
  };
  const hintGuild = '444444444444444444';
  Object.assign(row2, { prefix: '!', language_source: 'auto' });
  require('../src/i18n').setCachedGuildLanguage(hintGuild, 'en');
  saved.length = 0;
  assert.equal(await maybeHintLanguage(slash(hintGuild, { locale: 'en-US' })), false, 'an English client hears nothing');
  assert.equal(await maybeHintLanguage(slash(hintGuild, { canManage: false })), false, 'neither does a member who cannot manage the server');
  assert.equal(await maybeHintLanguage(slash(hintGuild, { replied: false })), false, 'nor a command that was not answered');
  assert.equal(await maybeHintLanguage(slash(null)), false, 'nor a direct message');
  const first = slash(hintGuild);
  assert.equal(await maybeHintLanguage(first), true);
  assert.match(first.calls[0].content, /Petto habla English en este servidor y tu Discord está en Español\. `!language es` lo cambia/, 'in the language of the person');
  assert.equal(first.calls[0].flags, 64, 'private');
  assert.deepEqual(saved, [[hintGuild, { language_source: 'auto-hinted' }]], 'the database remembers it was said');
  assert.equal(await maybeHintLanguage(slash(hintGuild)), false, 'once for each server');
  const chosen = '555555555555555555';
  row2.language_source = 'manual';
  require('../src/i18n').setCachedGuildLanguage(chosen, 'en');
  assert.equal(await maybeHintLanguage(slash(chosen, { locale: 'pt-BR' })), false, 'a language somebody chose is never questioned');
  const same = '666666666666666666';
  row2.language_source = 'auto';
  require('../src/i18n').setCachedGuildLanguage(same, 'pt-BR');
  assert.equal(await maybeHintLanguage(slash(same, { locale: 'pt-BR' })), false, 'a client in the language of the server hears nothing');

  console.log('Checked the language of a new server: detection, the first row, the setup message and its buttons.');
})().catch((err) => { console.error(err); process.exit(1); });
