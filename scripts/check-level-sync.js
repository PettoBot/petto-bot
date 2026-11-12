// Checks `/levels manage sync`: what each `type` does (the reward roles of the levels of the messages, the ones of the voice, the levels calculated again from the XP, the counters of
// messages raised to the statistics, or everything, with the levels first so the roles follow them), that it only gives and never takes a role, that a member who left is skipped, what
// the answer says in the three languages, and that the old way of writing it (`!levels manage sync-roles`, `!lmsr`) still means roles.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');
const i18n = require('../src/i18n');
const usersDb = require('../src/db/levelUsers');
const levelConfigDb = require('../src/db/levelConfig');
const guildsDb = require('../src/db/guilds');
const actions = require('../src/utils/levelActions');
const statsRules = require('../src/db/statsRules');
const logger = require('../src/utils/logger');

const GUILD = '111111111111111111';
i18n.setCachedGuildLanguage(GUILD, 'en');
guildsDb.ensureGuild = async () => {};
const sync = require('../src/utils/levelSync');
const level = require('../src/commands/leveling/level');
const levels = require('../src/commands/leveling/levels');

(async () => {
  // ---- what a type stands for
  assert.deepEqual(sync.kindsOf('all'), ['levels', 'roles', 'voice-roles', 'messages'], 'everything, the levels first so the roles follow them');
  assert.deepEqual([sync.kindsOf('roles'), sync.kindsOf('voice-roles'), sync.kindsOf('levels'), sync.kindsOf('messages')], [['roles'], ['voice-roles'], ['levels'], ['messages']]);
  assert.deepEqual([sync.kindsOf(undefined), sync.kindsOf(null), sync.kindsOf('nothing'), sync.kindsOf('ALL')], [['roles'], ['roles'], ['roles'], sync.kindsOf('all')], 'no type, or a word that is not one, is what the command did before: roles');
  assert.deepEqual([...sync.SYNC_TYPES], ['roles', 'voice-roles', 'levels', 'messages', 'all']);

  // ---- the level that XP is worth
  const curve = { curve_a: 1, curve_b: 50, curve_c: 100, difficulty: 2.5, rounding: 50, max_level: 1000 };
  const { totalXpForLevel } = require('../src/utils/levelCurve');
  assert.equal(sync.levelOf(0, curve), 0);
  assert.equal(sync.levelOf(totalXpForLevel(3, curve), curve), 3, 'exactly the XP of a level is that level');
  assert.equal(sync.levelOf(totalXpForLevel(3, curve) - 1, curve), 2, 'one XP short is the level before');
  assert.equal(sync.levelOf(totalXpForLevel(30, curve), { ...curve, max_level: 10 }), 10, 'never above the maximum level');
  assert.equal(sync.levelOf(undefined, curve), 0);
  assert.equal(sync.levelOf(-50, curve), 0);

  // ---- a server with its members: what is saved, what Discord has and what the sync does
  const X3 = totalXpForLevel(3, curve);
  const X5 = totalXpForLevel(5, curve);
  const rows = [
    { user_id: 'a', xp: X3, level: 0, voice_xp: 0, voice_level: 0 }, // the level saved is old
    { user_id: 'b', xp: X3, level: 3, voice_xp: X5, voice_level: 2 }, // the voice level is old
    { user_id: 'c', xp: X3, level: 3, voice_xp: 0, voice_level: 0 }, // all right
    { user_id: 'gone', xp: X5, level: 1, voice_xp: 0, voice_level: 0 }, // left the server
    { user_id: 'd', xp: totalXpForLevel(7, curve), level: 9, voice_xp: 0, voice_level: 0 }, // a curve that got harder: the level is lower now
  ];
  const calls = { list: [], setLevel: [], setVoice: [], raise: 0, rewards: [], fetched: [] };
  let withLevels = rows.filter((row) => row.level > 0 || row.voice_level > 0);
  usersDb.listForSync = async (guildId, { offset, limit }) => { calls.list.push(['all', guildId, offset]); return rows.slice(offset, offset + limit); };
  usersDb.listWithLevels = async (guildId, { offset, limit }) => { calls.list.push(['with-level', guildId, offset]); return withLevels.slice(offset, offset + limit); };
  usersDb.setLevel = async (guildId, userId, value) => { calls.setLevel.push([userId, value]); };
  usersDb.setVoiceLevel = async (guildId, userId, value) => { calls.setVoice.push([userId, value]); };
  usersDb.raiseMessagesFromStats = async () => { calls.raise += 1; return 4; };
  let given = true;
  actions.checkRewards = async (guild, member, value, config, source) => { calls.rewards.push([member.id, value, source, config.max_level]); return given ? { id: 'role' } : null; };
  logger.warn = () => {};
  const members = new Collection(['a', 'b', 'c', 'd'].map((id) => [id, { id }]));
  const guild = { id: GUILD, members: { fetch: async ({ user }) => { calls.fetched.push(user); return members; } } };
  const config = { ...curve, voice_max_level: 1000 };
  const reset = () => { for (const key of ['list', 'setLevel', 'setVoice', 'rewards', 'fetched']) calls[key].length = 0; calls.raise = 0; given = true; statsRules.setForTests({ configs: new Map(), optedOut: new Set() }); };
  const noPause = { pause: async () => {} };

  // roles: only the members with a level are looked at, the members who left are skipped, and no level is touched
  reset();
  let result = await sync.runSync(guild, config, ['roles'], noPause);
  assert.deepEqual(calls.list.map((call) => call[0]), ['with-level'], 'roles look only at who has a level');
  assert.deepEqual(calls.rewards.map((call) => [call[0], call[1], call[2]]), [['b', 3, 'text'], ['c', 3, 'text'], ['d', 9, 'text']], 'the roles of the levels of the messages, with the level that was saved');
  assert.deepEqual([calls.setLevel, calls.setVoice, calls.raise], [[], [], 0], 'nothing else is touched');
  assert.deepEqual([result.checked, result.roles, result.voiceRoles, result.levels, result.messages, result.limited], [3, 3, 0, 0, 0, false], 'the member who left is not counted');
  given = false;
  calls.rewards.length = 0;
  result = await sync.runSync(guild, config, ['roles'], noPause);
  assert.equal(result.roles, 0, 'a member who already has the roles is not counted');

  // voice roles: the voice level, with the settings of the voice
  reset();
  result = await sync.runSync(guild, config, ['voice-roles'], noPause);
  assert.deepEqual(calls.rewards.map((call) => [call[0], call[1], call[2]]), [['b', 2, 'voice']], 'only the voice levels, as a voice reward');
  assert.deepEqual([result.voiceRoles, result.roles], [1, 0]);

  // levels: calculated again from the XP, for the text and the voice, and only the ones that differ are written
  reset();
  result = await sync.runSync(guild, config, ['levels'], noPause);
  assert.deepEqual(calls.list.map((call) => call[0]), ['all'], 'levels look at everybody with a row');
  assert.deepEqual(calls.setLevel, [['a', 3], ['gone', 5], ['d', 7]], 'the level that was old is fixed, up or down, and the ones that were right are left alone');
  assert.deepEqual(calls.setVoice, [['b', 5]], 'and the same for the voice');
  assert.deepEqual([calls.fetched.length, calls.rewards.length], [0, 0], 'no member is asked for and no role is given: the database only');
  assert.deepEqual([result.levels, result.checked, result.roles], [4, 5, 0], 'a member counts once even with two levels fixed');

  // messages: one statement of the database, nothing else, and not when the statistics are off
  reset();
  result = await sync.runSync(guild, config, ['messages'], noPause);
  assert.deepEqual([calls.raise, calls.list.length, calls.fetched.length, result.messages, result.checked], [1, 0, 0, 4, 0], 'the counters are raised without listing anybody');
  reset();
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  result = await sync.runSync(guild, config, ['messages'], noPause);
  assert.deepEqual([calls.raise, result.messages, result.skipped.messages], [0, 0, 'statsOff'], 'a server with statistics off has nothing to read');
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: true, members: false, content: true }]]), optedOut: new Set() });
  result = await sync.runSync(guild, config, ['messages'], noPause);
  assert.equal(result.skipped.messages, 'membersOff', 'and a server that keeps statistics without members');

  // everything: the levels first, so the roles are given for the new levels
  reset();
  result = await sync.runSync(guild, config, sync.kindsOf('all'), noPause);
  assert.deepEqual(calls.rewards.filter((call) => call[2] === 'text').map((call) => [call[0], call[1]]), [['a', 3], ['b', 3], ['c', 3], ['d', 7]], 'the roles follow the level that was just calculated, not the old one');
  assert.deepEqual(calls.rewards.filter((call) => call[2] === 'voice').map((call) => [call[0], call[1]]), [['b', 5]]);
  assert.deepEqual([result.levels, result.roles, result.voiceRoles, result.messages, calls.raise], [3, 4, 1, 4, 1], 'with roles in the mix, a member who left is not touched (levels alone does reach them)');

  // a pause after some roles, so a server with many does not hit the limits of Discord
  reset();
  const pauses = [];
  await sync.runSync(guild, config, ['roles'], { pause: async (ms) => { pauses.push(ms); } });
  assert.deepEqual(pauses, [], 'three roles need no pause');
  members.clear();
  for (let index = 0; index < 12; index += 1) { const id = `m${index}`; members.set(id, { id }); rows.push({ user_id: id, xp: X3, level: 3, voice_xp: 0, voice_level: 0 }); }
  withLevels = rows.filter((row) => row.level > 0 || row.voice_level > 0);
  reset();
  pauses.length = 0;
  await sync.runSync(guild, config, ['roles'], { pause: async (ms) => { pauses.push(ms); } });
  assert.ok(pauses.length >= 2 && pauses.every((ms) => ms === 400), 'a short wait after every five roles given');

  // ---- the command
  const replies = [];
  levelConfigDb.ensureConfig = async () => config;
  const interaction = (type, lang = 'en') => {
    i18n.setCachedGuildLanguage(GUILD, lang);
    return {
      guild, guildId: GUILD, locale: 'en-US', guildLocale: 'en-US', user: { id: 'u' }, deferred: false, replied: false,
      options: { getSubcommandGroup: () => 'manage', getSubcommand: () => 'sync', getString: (name) => (name === 'type' ? type : null) },
      deferReply: async function defer() { this.deferred = true; },
      editReply: async (payload) => { replies.push(payload); },
    };
  };
  const said = (payload) => JSON.stringify(payload.components[0].toJSON());
  const ask = async (type, lang) => { replies.length = 0; await level.execute(interaction(type, lang)); assert.equal(replies.length, 1, `one answer for ${type}`); assert.equal(replies[0].flags, MessageFlags.IsComponentsV2); return said(replies[0]); };
  reset();
  members.clear(); rows.length = 5; withLevels = rows.filter((row) => row.level > 0 || row.voice_level > 0);
  for (const id of ['a', 'b', 'c', 'd']) members.set(id, { id });
  let text = await ask(null);
  assert.ok(text.includes('Synced the reward roles') && text.includes('Checked **3** members') && text.includes('Roles: **3** reward roles given'), 'no type is roles, as the command was before');
  assert.ok(text.includes('never takes one away'), 'and says it never takes a role away');
  assert.ok(!text.includes('Levels:') && !text.includes('Messages:'), 'and says nothing of what it did not do');
  text = await ask('levels');
  assert.ok(text.includes('Synced the levels') && text.includes('Levels: **4** members had a level that did not match their XP and were fixed'), 'levels');
  text = await ask('voice-roles');
  assert.ok(text.includes('Voice roles: **1** reward role given') && text.includes('the voice reward roles'), 'voice roles, singular');
  text = await ask('messages');
  assert.ok(text.includes('Synced the message counters.') && text.includes('Messages: **4** counters raised') && !text.includes('Checked') && !text.includes('never takes one away'), 'messages: nobody is checked');
  text = await ask('all');
  assert.ok(text.includes('Synced everything') && ['Levels:', 'Roles:', 'Voice roles:', 'Messages:'].every((word) => text.includes(word)), 'everything says each part');
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  text = await ask('all');
  assert.ok(text.includes('Messages: skipped, this server turned its statistics off'), 'what could not be done is said');
  reset();
  assert.ok((await ask('all', 'es')).includes('Sincronizado: todo') && (await ask('levels', 'es')).includes('Niveles: **4** miembros tenían un nivel que no coincidía con su XP y se corrigieron'), 'Spanish');
  assert.ok((await ask('all', 'pt-BR')).includes('Sincronizado: tudo') && (await ask('voice-roles', 'pt-BR')).includes('Cargos de voz: **1** cargo de recompensa entregue'), 'Portuguese');

  // ---- the options and the old way of writing it
  const group = level.data.toJSON().options.find((option) => option.name === 'manage');
  const syncOption = group.options.find((option) => option.name === 'sync');
  const type = syncOption.options.find((option) => option.name === 'type');
  assert.ok(type && !type.required, 'an optional type');
  assert.deepEqual(type.choices.map((choice) => choice.value), ['roles', 'voice-roles', 'levels', 'messages', 'all'], 'every thing to sync');
  assert.ok(syncOption.description.length <= 100, 'a description that fits Discord');
  const manage = levels.data.toJSON().options.find((option) => option.name === 'manage');
  assert.ok(manage.options.some((option) => option.name === 'sync') && !manage.options.some((option) => option.name === 'sync-roles'), '/levels manage sync is the command, sync-roles is not in the menu any more');
  assert.equal(levels.prefixPathAliases['manage sync-roles'], 'manage sync', '`!levels manage sync-roles` still reads as the command');
  const { normalizeTokens } = require('../src/handlers/prefixInteraction');
  assert.deepEqual(normalizeTokens(levels, ['manage', 'sync-roles']), ['manage', 'sync'], 'and the prefix turns it into the new name');
  assert.deepEqual(normalizeTokens(levels, ['manage', 'sync', 'all']), ['manage', 'sync', 'all'], 'the new name is left as it is');
  const shorts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/utils/short-aliases.json'), 'utf8'));
  assert.equal(shorts.lmsr, 'levels manage sync', 'the published short word `!lmsr` still gives the roles (the default type)');

  console.log('Level sync checks passed (each type, the order, roles never taken, who left, the answers in three languages, the options and the old words).');
})().catch((error) => { console.error(error); process.exit(1); });
