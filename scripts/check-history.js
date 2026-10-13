// Checks the history of avatars, names and nicknames: a value is saved only when it changes, nothing is saved for bots or for
// someone who turned it off, the avatar picture, and how the commands are typed with the prefix. The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

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
const { renderAvatarSheet, MAX_TILES } = require('../src/utils/avatarSheet');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

(async () => {
  const db = memoryDb();
  const user = { id: '111111111111111111', bot: false, avatar: 'abc', globalName: 'Liam', username: 'ft8d' };
  assert.deepEqual(await identity.noteUser(user, db), ['avatar', 'name'], 'the first time everything is saved');
  assert.deepEqual(await identity.noteUser(user, db), [], 'the same values are not saved again');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: 'def' }, db), ['avatar'], 'a new avatar is saved');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: 'def', globalName: null }, db), ['name'], 'without a display name the username is the name');
  assert.deepEqual(db.rows.filter((r) => r.kind === 'name').map((r) => r.value), ['Liam', 'ft8d']);
  assert.deepEqual(await identity.noteUser({ ...user, id: '2', bot: true }, db), [], 'bots have no history');
  assert.deepEqual(await identity.noteUser({ ...user, avatar: null, globalName: null, username: '' }, db), [], 'the default avatar and an empty name are not saved');

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
  assert.deepEqual(await identity.noteUser(private_, db), ['avatar', 'name'], 'and again once it is turned on');

  // The picture: one PNG with every avatar (up to 48), a tile for one that could not be loaded.
  const tile = createCanvas(64, 64);
  const rows = Array.from({ length: 50 }, (_, i) => ({ value: `hash${i}`, seen_at: new Date(Date.UTC(2026, 9, 1 + (i % 27))) }));
  const requested = [];
  const sheet = await renderAvatarSheet(user.id, rows, { loader: async (link) => { requested.push(link); return requested.length === 2 ? null : tile; } });
  assert.equal(sheet.shown, MAX_TILES, 'the picture holds the newest 48');
  assert.ok(requested[0].startsWith(`https://cdn.discordapp.com/avatars/${user.id}/hash0.png`), 'avatars come from the Discord CDN');
  assert.deepEqual([...sheet.buffer.subarray(1, 4)], [80, 78, 71], 'a PNG');
  assert.ok(sheet.width > sheet.height / 2 && sheet.height > 200);
  const small = await renderAvatarSheet(user.id, rows.slice(0, 2), { loader: async () => tile });
  assert.ok(small.width < sheet.width, 'a short list makes a narrower picture');

  // The commands with the prefix.
  const command = require('../src/commands/utility/profilehistory.js');
  const message = { guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } }, author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '' };
  const parse = (text) => buildInteractionFromMessage(message, command, text);
  assert.deepEqual(command.data.toJSON().options.map((o) => o.name), ['avatars', 'names', 'nicknames', 'clear', 'record']);
  let i = await parse('avatars <@123456789012345678>');
  assert.equal(i.options.getSubcommand(), 'avatars');
  i = await parse('clear nicknames');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('what')], ['clear', 'nicknames']);
  i = await parse('record false');
  assert.equal(i.options.getBoolean('enabled'), false);
  const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
  assert.deepEqual(['avatars', 'names', 'nicknames', 'nicks'].map((alias) => DEFAULT_PREFIX_ROUTES.find((r) => r.alias === alias)?.command), ['profilehistory', 'profilehistory', 'profilehistory', 'profilehistory']);
  console.log('Checked the history: what is saved and when, opting out, the avatar picture and the commands.');
})().catch((error) => { console.error(error); process.exit(1); });
