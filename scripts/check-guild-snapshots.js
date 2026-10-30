// Checks the saved copy of each server the dashboard reads: its shape, that unchanged servers are not saved again, that
// removed servers are forgotten, and that nothing is forgotten when only some shards run in this process.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const config = { shards: undefined };
stub('src/config.js', config);
const infoLines = [];
const warnLines = [];
stub('src/utils/logger.js', { info: (...args) => { infoLines.push(args.join(' ')); }, warn: (...args) => { warnLines.push(args.join(' ')); }, error() {} });

const table = new Map();
let writes = 0;
stub('src/db/database.js', {
  from(name) {
    assert.equal(name, 'discord_guild_snapshots');
    const query = {
      upsert: async (row, options) => {
        assert.equal(options.onConflict, 'guild_id');
        // The driver would turn an array into a PostgreSQL array and refuse it as JSON: the lists must arrive as JSON text.
        assert.equal(typeof row.channels, 'string', 'channels go in as JSON text'); assert.equal(typeof row.roles, 'string', 'roles go in as JSON text');
        assert.equal(typeof row.emojis, 'string', 'emojis go in as JSON text');
        assert.ok(Array.isArray(JSON.parse(row.channels)) && Array.isArray(JSON.parse(row.roles)) && Array.isArray(JSON.parse(row.emojis)));
        assert.ok(!Number.isNaN(Date.parse(row.updated_at)), 'the row carries when it was saved');
        writes += 1; table.set(row.guild_id, { ...row, channels: JSON.parse(row.channels), roles: JSON.parse(row.roles), emojis: JSON.parse(row.emojis) }); return { error: null };
      },
      select: () => Promise.resolve({ data: [...table.keys()].map((guild_id) => ({ guild_id })), error: null }),
      delete: () => ({ in: async (_column, ids) => { for (const id of ids) table.delete(id); return { error: null }; } }),
    };
    return query;
  },
});

const { buildSnapshot, saveGuildSnapshot, removeGuildSnapshot, syncAllGuildSnapshots, scheduleGuildSnapshot, botAccess } = require('../src/utils/guildSnapshots');

const channel = (id, name, type, extra = {}) => ({ id, name, type, rawPosition: Number(id) % 10, parentId: null, topic: null, nsfw: false, isThread: () => false, isTextBased: () => type === 0, isDMBased: () => false, permissionsFor: () => ({ has: () => true }), ...extra });
const guild = (id, overrides = {}) => ({
  id, name: `Server ${id}`, icon: 'abc123', ownerId: '99', memberCount: 42, banner: 'ban1', premiumTier: 2, premiumSubscriptionCount: 9,
  emojis: { cache: new Map([['e1', { id: 'e1', name: 'wave', animated: false }], ['e2', { id: 'e2', name: 'party', animated: true, extra: 'x' }]]) }, members: { me: { nickname: 'Petto Pet', avatar: 'av1' } },
  channels: { cache: new Map([['1', channel('1', 'general', 0, { topic: 'hello', parentId: '5' })], ['2', channel('2', 'voice', 2)], ['3', { ...channel('3', 'a thread', 11), isThread: () => true }]]) },
  roles: { cache: new Map([['10', { id: '10', name: '@everyone', color: 0, rawPosition: 0, managed: false, permissions: { bitfield: 1024n }, icon: null, hoist: false, mentionable: false }], ['11', { id: '11', name: 'Mods', color: 255, rawPosition: 3, managed: false, permissions: { bitfield: 8n }, icon: 'x', hoist: true, mentionable: true }]]) },
  ...overrides,
});

(async () => {
  const row = buildSnapshot(guild('1000'));
  assert.equal(row.guild_id, '1000'); assert.equal(row.name, 'Server 1000'); assert.equal(row.icon, 'abc123'); assert.equal(row.member_count, 42); assert.equal(row.owner_id, '99');
  assert.equal(row.channels.length, 2, 'threads are not saved');
  assert.deepEqual([row.banner, row.emoji_count, row.premium_tier, row.boost_count, row.bot_nick, row.bot_avatar], ['ban1', 2, 2, 9, 'Petto Pet', 'av1'], 'banner, emojis, boosts and how the bot looks in the server');
  assert.deepEqual(row.channels[0], { id: '1', name: 'general', type: 0, position: 1, parent_id: '5', topic: 'hello', nsfw: false, bot_can_send: true, bot_can_view: true }, 'channels have the shape of Discord answers, and say whether the bot can see and write in them');
  assert.deepEqual([row.channels[1].bot_can_send, row.channels[1].bot_can_view], [null, null], 'a voice channel is not one to post in');
  const closed = buildSnapshot(guild('1001', { channels: { cache: new Map([['1', channel('1', 'staff', 0, { permissionsFor: () => ({ has: () => false }) })]]) } }));
  assert.equal(closed.channels[0].bot_can_send, false, 'a channel where the bot cannot see or write says so');
  assert.equal(closed.channels[0].bot_can_view, false, 'a channel the bot cannot see says so');
  const { PermissionFlagsBits } = require('discord.js');
  const readOnly = buildSnapshot(guild('1002', { channels: { cache: new Map([['1', channel('1', 'news', 0, { permissionsFor: () => ({ has: (flags) => flags === PermissionFlagsBits.ViewChannel }) })]]) } }));
  assert.deepEqual([readOnly.channels[0].bot_can_view, readOnly.channels[0].bot_can_send], [true, false], 'a channel the bot sees but cannot write in says which');
  assert.equal(row.roles.length, 2);
  assert.equal(row.roles[1].permissions, '8', 'permissions are a string like Discord sends them');
  assert.equal(row.roles[1].color, 255);
  assert.deepEqual(row.emojis, [{ id: 'e1', name: 'wave', animated: false }, { id: 'e2', name: 'party', animated: true }], 'emojis are saved as { id, name, animated }');
  assert.deepEqual(buildSnapshot(guild('1001', { emojis: undefined })).emojis, [], 'a server without emojis in memory has an empty list');
  JSON.stringify(row); // BigInt must not leak into the row

  const g = guild('1000');
  assert.equal(await saveGuildSnapshot(g), true); assert.equal(writes, 1);
  assert.equal(await saveGuildSnapshot(g), false, 'nothing changed, nothing saved'); assert.equal(writes, 1);
  g.name = 'Renamed';
  assert.equal(await saveGuildSnapshot(g), true); assert.equal(table.get('1000').name, 'Renamed');
  assert.deepEqual(table.get('1000').emojis.map((emoji) => emoji.name), ['wave', 'party']);
  g.emojis.cache.set('e3', { id: 'e3', name: 'new', animated: false });
  assert.equal(await saveGuildSnapshot(g), true, 'a new emoji is a change');
  g.emojis.cache.set('e3', { id: 'e3', name: 'renamed', animated: false });
  assert.equal(await saveGuildSnapshot(g), true, 'a renamed emoji is a change');
  assert.equal(table.get('1000').emojis[2].name, 'renamed');

  // --- Whether the bot can post: never "cannot" when it does not know ----------------------------------------------------------------------------
  {
    const { PermissionsBitField, ChannelType } = require('discord.js');
    const F = PermissionFlagsBits;
    const bits = (...flags) => new PermissionsBitField(flags);
    const member = (...flags) => ({ nickname: null, avatar: null, permissions: bits(...flags) });
    // A channel as discord.js gives it: the bot's permissions there come from `permissionsFor`.
    const room = (id, name, type, perms, extra = {}) => channel(id, name, type, { isTextBased: () => [0, 2, 5, 13, 11, 12].includes(type), permissionsFor: () => perms, ...extra });
    const access = (ch, me) => { const out = botAccess(ch, me); return [out.send, out.view, out.missing]; };

    // An Administrator can see and post everywhere, also where an overwrite denies it (a rules channel, a moderators' channel, an announcement channel).
    const admin = member(F.Administrator);
    const denied = bits(); // what permissionsFor would answer if it counted a denying overwrite and nothing else
    for (const type of [0, 5, 2, 13]) assert.deepEqual(access(room('1', 'rules', type, denied), admin), [true, true, null], `an Administrator posts in a channel of type ${type} that denies it`);
    const adminSnapshot = buildSnapshot(guild('2000', { members: { me: admin }, channels: { cache: new Map([['1', room('1', 'rules', 0, denied)], ['2', room('2', 'mods', 0, denied)], ['3', room('3', 'news', 5, denied)], ['4', room('4', 'talk', 2, denied)]]) } }));
    assert.deepEqual(adminSnapshot.channels.map((c) => [c.bot_can_send, c.bot_can_view]), [[true, true], [true, true], [true, true], [true, true]], 'true in every channel for an Administrator');
    assert.deepEqual(access(room('1', 'rules', 0, bits(F.Administrator)), member()), [true, true, null], 'and so does a permissionsFor that says Administrator');

    // The bot's member is not loaded: not known (null), never false; nothing is said about a channel.
    const unknown = buildSnapshot(guild('2001', { members: { me: null }, channels: { cache: new Map([['1', room('1', 'general', 0, bits(F.ViewChannel, F.SendMessages)) ], ['2', room('2', 'news', 5, bits())]]) } }));
    assert.deepEqual(unknown.channels.map((c) => [c.bot_can_send, c.bot_can_view]), [[null, null], [null, null]], 'a bot that is not loaded gives null');
    assert.deepEqual(unknown.bot_nick, null);
    assert.deepEqual(access(room('1', 'x', 0, null), member()), [null, null, null], 'a channel whose permissions cannot be computed is not known either');
    assert.deepEqual(access(room('1', 'x', 0, bits()), undefined), [null, null, null]);

    // A real missing permission is still false, and it says which one and tells apart seeing from writing.
    const plain = member(F.SendMessages);
    assert.deepEqual(access(room('1', 'read-only', 0, bits(F.ViewChannel)), plain), [false, true, 'SendMessages']);
    assert.deepEqual(access(room('1', 'hidden', 0, bits(F.SendMessages)), plain), [false, false, 'ViewChannel']);
    assert.deepEqual(access(room('1', 'open', 0, bits(F.ViewChannel, F.SendMessages)), plain), [true, true, null]);

    // The kinds of channel: an announcement channel needs SendMessages; the text chat of a voice or stage channel too; a thread needs SendMessagesInThreads; a forum or media channel is not one to post in.
    assert.deepEqual(access(room('1', 'announcements', ChannelType.GuildAnnouncement, bits(F.ViewChannel, F.SendMessages)), plain), [true, true, null]);
    assert.deepEqual(access(room('1', 'announcements', ChannelType.GuildAnnouncement, bits(F.ViewChannel)), plain), [false, true, 'SendMessages']);
    assert.deepEqual(access(room('1', 'voice', ChannelType.GuildVoice, bits(F.ViewChannel, F.SendMessages)), plain), [true, true, null]);
    assert.deepEqual(access(room('1', 'stage', ChannelType.GuildStageVoice, bits(F.ViewChannel)), plain), [false, true, 'SendMessages']);
    const thread = (perms) => room('9', 'a thread', ChannelType.PublicThread, perms, { isThread: () => true });
    assert.deepEqual(access(thread(bits(F.ViewChannel, F.SendMessages)), plain), [false, true, 'SendMessagesInThreads'], 'SendMessages is not what a thread asks for');
    assert.deepEqual(access(thread(bits(F.ViewChannel, F.SendMessagesInThreads)), plain), [true, true, null]);
    for (const type of [ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.GuildCategory]) {
      assert.deepEqual(access(room('1', 'forum', type, bits(), { isTextBased: () => type !== ChannelType.GuildCategory }), plain), [null, null, null], `a channel of type ${type} is not known, not "cannot"`);
    }
    assert.deepEqual(access(room('1', 'forum', ChannelType.GuildForum, bits(), { isTextBased: () => true }), admin), [null, null, null], 'a forum is not postable even for an Administrator');
    assert.deepEqual(access({ ...room('1', 'dm', 1, bits()), isDMBased: () => true }, plain), [null, null, null]);

    // The bot's member is loaded when it is missing: asked from Discord, and when it cannot be had the answer is still "not known".
    infoLines.length = 0; warnLines.length = 0;
    const loaded = member(F.Administrator);
    const lazy = guild('2002', { members: { me: null, fetchMe: async () => { lazy.members.me = loaded; return loaded; } }, channels: { cache: new Map([['1', room('1', 'rules', 0, denied)]]) } });
    assert.equal(await saveGuildSnapshot(lazy), true);
    assert.deepEqual([table.get('2002').channels[0].bot_can_send, table.get('2002').channels[0].bot_can_view], [true, true], 'a bot that was not in memory is fetched, and then it is an Administrator');
    const broken = guild('2003', { members: { me: null, fetchMe: async () => { throw new Error('Unknown Member'); } }, channels: { cache: new Map([['1', room('1', 'rules', 0, denied)]]) } });
    assert.equal(await saveGuildSnapshot(broken), true);
    assert.deepEqual([table.get('2003').channels[0].bot_can_send, table.get('2003').channels[0].bot_can_view], [null, null], 'when it cannot be fetched it is not known, never false');
    assert.match(warnLines.join('\n'), /could not load the bot's member of 2003: Unknown Member/);
    assert.deepEqual(infoLines, [], 'not knowing is not a closed channel');

    // A copy of the bot's roles that is behind (the usual reason an Administrator is told "cannot" in some channels): when a channel looks closed
    // the bot's member is read from Discord again, once an hour at most, and the copy says what Discord says now.
    infoLines.length = 0;
    let fetched = [];
    const stale = guild('2004', {
      members: { me: member(), fetchMe: async (options) => { fetched.push(options); stale.members.me = admin; return admin; } },
      channels: { cache: new Map([['1', room('1', 'rules', 0, denied)], ['2', room('2', 'general', 0, bits(F.ViewChannel, F.SendMessages))]]) },
    });
    assert.equal(await saveGuildSnapshot(stale), true);
    assert.deepEqual(fetched, [{ force: true }], 'the roles of the bot are read from Discord because a channel looked closed');
    assert.deepEqual(table.get('2004').channels.map((c) => c.bot_can_send), [true, true]);
    assert.deepEqual(infoLines, []);
    // A channel that is really closed: the roles are checked once, the copy says false, and the log says which permission is missing.
    fetched = [];
    const closedGuild = guild('2005', {
      members: { me: member(), fetchMe: async (options) => { fetched.push(options); return closedGuild.members.me; } },
      channels: { cache: new Map([['1', room('1', 'rules', 0, bits(F.ViewChannel))], ['2', room('2', 'staff', 0, bits())], ['3', room('3', 'general', 0, bits(F.ViewChannel, F.SendMessages))]]) },
    });
    assert.equal(await saveGuildSnapshot(closedGuild), true);
    assert.deepEqual(table.get('2005').channels.map((c) => [c.bot_can_send, c.bot_can_view]), [[false, true], [false, false], [true, true]]);
    assert.equal(fetched.length, 1);
    assert.deepEqual(infoLines, ['[snapshots] Server 2005 (2005): Petto cannot post in 2 channel(s), missing permission: #rules (SendMessages), #staff (ViewChannel).']);
    await saveGuildSnapshot(closedGuild);
    assert.equal(fetched.length, 1, 'a closed channel is checked against Discord once an hour, not at every pass');
    assert.equal(infoLines.length, 1, 'and the log says it only when it changes');
    closedGuild.channels.cache.get('1').permissionsFor = () => bits(F.ViewChannel, F.SendMessages);
    await saveGuildSnapshot(closedGuild);
    assert.match(infoLines.at(-1), /#staff \(ViewChannel\)\.$/);
    assert.equal(infoLines.length, 2);
    // A change of the bot's roles or permissions (an event, or the dashboard's resync) reads its member again at once.
    fetched = [];
    await saveGuildSnapshot(closedGuild, { refreshMe: true });
    assert.deepEqual(fetched, [{ force: true }]);
    closedGuild.channels.cache.get('2').permissionsFor = () => bits(F.ViewChannel, F.SendMessages);
    await saveGuildSnapshot(closedGuild);
    assert.match(infoLines.at(-1), /Petto can post in every channel again\.$/);
    for (const id of ['2002', '2003', '2004', '2005']) table.delete(id); // not servers of the client below
  }

  // Full sync: saves new servers, forgets the ones the bot left.
  table.set('gone', { guild_id: 'gone' });
  const client = { guilds: { cache: new Map([['1000', g], ['2000', guild('2000')]]) } };
  const result = await syncAllGuildSnapshots(client);
  assert.deepEqual(result, { saved: 1, removed: 1, total: 2 });
  assert.ok(table.has('2000') && !table.has('gone'));

  // With some shards in this process nothing is forgotten.
  config.shards = [0];
  table.set('other-shard', { guild_id: 'other-shard' });
  const partial = await syncAllGuildSnapshots(client);
  assert.equal(partial.removed, 0); assert.ok(table.has('other-shard'));
  config.shards = undefined;

  // Not a single server in memory (the bot is still starting): nothing is forgotten either.
  const empty = await syncAllGuildSnapshots({ guilds: { cache: new Map() } });
  assert.equal(empty.removed, 0); assert.ok(table.has('other-shard'));

  await removeGuildSnapshot('2000'); assert.ok(!table.has('2000'));

  // A burst of changes is one save.
  const before = writes;
  const busy = guild('3000');
  for (let n = 0; n < 5; n += 1) scheduleGuildSnapshot(busy);
  await new Promise((resolve) => setTimeout(resolve, 3300));
  assert.equal(writes, before + 1, 'five changes in a row make one save');

  console.log('guild snapshots ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
