// Checks the history of names and nicknames: a value is saved only when it changes, nothing is saved for bots or for
// someone who turned it off, an avatar is never saved, and how the commands are typed with the prefix. The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/userResolve.js', { cleanUserQuery: (v) => v, exactUserMatch: () => null, resolveUsers: async () => [], resolveUser: async (client, token) => ({ id: String(token).replace(/\D/g, ''), username: 'someone' }) });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: '', DENY: '' } });

function memoryDb() {
  const rows = [];
  const out = new Set();
  return {
    rows,
    latest: async (userId, kind, guildId = null) => rows.filter((r) => r.user_id === userId && r.kind === kind && (r.guild_id ?? null) === guildId).at(-1)?.value ?? null,
    add: async (userId, kind, value, guildId = null) => { rows.push({ user_id: userId, kind, value, guild_id: guildId, seen_at: new Date() }); },
    trim: async () => {},
    isOptedOut: async (userId) => out.has(userId),
    setOptOut: async (userId, value) => { if (value) out.add(userId); else out.delete(userId); },
  };
}

const identity = require('../src/utils/identityHistory');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

(async () => {
  const db = memoryDb();
  const user = { id: '111111111111111111', bot: false, avatar: 'abc', globalName: 'Liam', username: 'ft8d' };
  assert.deepEqual(await identity.noteUser(user, db), ['name'], 'the first time the name is saved');
  assert.deepEqual(await identity.noteUser(user, db), [], 'the same values are not saved again');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: 'def' }, db), [], 'a new avatar is not saved');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: 'def', globalName: null }, db), ['name'], 'without a display name the username is the name');
  assert.ok(db.rows.every((r) => r.kind !== 'avatar'), 'no avatar is ever written to the history');
  assert.equal(identity.avatarUrl, undefined, 'there is no helper that points at stored avatars any more');
  assert.deepEqual(db.rows.filter((r) => r.kind === 'name').map((r) => r.value), ['Liam', 'ft8d']);
  assert.deepEqual(await identity.noteUser({ ...user, id: '2', bot: true }, db), [], 'bots have no history');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: null, globalName: null, username: '' }, db), [], 'an empty name is not saved');

  const member = { user, nickname: '! liam', guild: { id: 'g1' } };
  assert.deepEqual(await identity.noteMember(member, db), ['nickname']);
  assert.deepEqual(await identity.noteMember(member, db), []);
  assert.deepEqual(await identity.noteMember({ ...member, nickname: null }, db), [], 'removing a nickname saves nothing');
  assert.equal(db.rows.find((r) => r.kind === 'nickname').guild_id, 'g1', 'a nickname belongs to its server');

  // Someone who turned it off is not saved (the answer is remembered for a while, so forget it first).
  const private_ = { ...user, id: '333333333333333333' };
  await db.setOptOut(private_.id, true);
  identity.forgetOptOut(private_.id);
  assert.deepEqual(await identity.noteUser(private_, db), []);
  await db.setOptOut(private_.id, false);
  identity.forgetOptOut(private_.id);
  assert.deepEqual(await identity.noteUser(private_, db), ['name'], 'and again once it is turned on');

  // The event: a change of the avatar alone writes nothing; a change of the display name or the username does.
  const noted = [];
  const realNoteUser = identity.noteUser;
  identity.noteUser = async (u) => { noted.push(u.id); return []; };
  const userUpdate = require('../src/events/identityHistoryUser');
  await userUpdate.execute({ id: '5', avatar: 'a', globalName: 'N', username: 'n' }, { id: '5', avatar: 'b', globalName: 'N', username: 'n' });
  assert.deepEqual(noted, [], 'a new avatar is not recorded');
  await userUpdate.execute({ id: '5', avatar: 'a', globalName: 'N', username: 'n' }, { id: '5', avatar: 'b', globalName: 'M', username: 'n' });
  await userUpdate.execute({ id: '6', avatar: 'a', globalName: 'N', username: 'n' }, { id: '6', avatar: 'a', globalName: 'N', username: 'm' });
  assert.deepEqual(noted, ['5', '6'], 'a new display name or username is');
  identity.noteUser = realNoteUser;

  // The commands with the prefix.
  const command = require('../src/commands/utility/profilehistory.js');
  const message = { guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } }, author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '' };
  const parse = (text) => buildInteractionFromMessage(message, command, text);
  assert.deepEqual(command.data.toJSON().options.map((o) => o.name), ['names', 'nicknames', 'clear', 'record'], 'there is no avatars subcommand');
  assert.deepEqual(command.data.toJSON().options.find((o) => o.name === 'clear').options[0].choices.map((c) => c.value), ['names', 'nicknames', 'all']);
  let i = await parse('names <@123456789012345678>');
  assert.equal(i.options.getSubcommand(), 'names');
  i = await parse('clear nicknames');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('what')], ['clear', 'nicknames']);
  i = await parse('record false');
  assert.equal(i.options.getBoolean('enabled'), false);
  const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
  assert.deepEqual(['names', 'nicknames', 'nicks'].map((alias) => DEFAULT_PREFIX_ROUTES.find((r) => r.alias === alias)?.command), ['profilehistory', 'profilehistory', 'profilehistory']);
  assert.equal(DEFAULT_PREFIX_ROUTES.find((r) => r.alias === 'avatars'), undefined, '!avatars is not a route to the history any more');
  console.log('Checked the history of names and nicknames: what is saved and when, opting out, no avatars, and the commands.');
})().catch((error) => { console.error(error); process.exit(1); });
