// Checks the category "@ stats" of the support server: the names (whole numbers, never 12K), that the category and the two voice channels are made with
// everybody seeing and nobody joining, that only a channel whose number changed is renamed, that a deleted channel is made again, and that nothing
// happens (and nothing breaks) when no server is set or Petto cannot manage channels there.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');
const stats = require('../src/utils/statsCategory');

// Names and numbers.
assert.equal(stats.CATEGORY_NAME, '@ stats');
assert.equal(stats.channelName('members', 108), 'Members • 108');
assert.equal(stats.channelName('members', 12480), 'Members • 12,480', 'the number is whole, with a comma, never 12K');
assert.equal(stats.channelName('servers', 7), 'Servers • 7');
assert.equal(stats.channelName('servers', -3), 'Servers • 0');
assert.equal(stats.channelName('members', 99.9), 'Members • 99');
assert.equal(stats.keyOfName('Members • 108'), 'members');
assert.equal(stats.keyOfName('servers • 12'), 'servers');
assert.equal(stats.keyOfName('general'), null);
assert.equal(stats.STATS_EVERY_MS, 10 * 60_000, 'Discord lets a channel be renamed twice in 10 minutes');
const sample = { guilds: { cache: new Map([['1', { memberCount: 100 }], ['2', { memberCount: 8 }], ['3', {}]]) } };
assert.deepEqual(stats.readNumbers(sample), { servers: 3, members: 108 });

function world({ manage = true, existing = [] } = {}) {
  const calls = { create: [], rename: [] };
  let next = 100;
  const make = (options) => {
    const channel = { id: String(next++), name: options.name, type: options.type, parentId: options.parent ?? null, permissionOverwrites: options.permissionOverwrites,
      setName: async (name) => { calls.rename.push([channel.name, name]); channel.name = name; return channel; } };
    cache.set(channel.id, channel);
    return channel;
  };
  const cache = new Collection();
  for (const item of existing) make(item);
  calls.create.length = 0;
  const guild = {
    id: 'g1',
    roles: { everyone: { id: 'g1' } },
    members: { me: { permissions: { has: (flag) => manage && flag === PermissionFlagsBits.ManageChannels } }, fetchMe: async () => null },
    channels: { cache, fetch: async () => cache, create: async (options) => { calls.create.push(options); return make(options); } },
  };
  const client = { guilds: { cache: new Collection([['g1', guild]]), fetch: async () => null } };
  return { client, guild, calls };
}

(async () => {
  // Nothing to do.
  assert.equal((await stats.updateStatsCategory({ guilds: { cache: new Collection() } }, null)).skipped, 'no support server set (PETTO_SUPPORT_GUILD_ID)');
  assert.match((await stats.updateStatsCategory({ guilds: { cache: new Collection(), fetch: async () => null } }, 'nope')).skipped, /not reachable/);
  const noPermission = world({ manage: false });
  assert.match((await stats.updateStatsCategory(noPermission.client, 'g1', { members: 1, servers: 1 })).skipped, /cannot manage channels/);
  assert.equal(noPermission.calls.create.length, 0);

  // First time: the category and the two channels, locked.
  const fresh = world();
  const first = await stats.updateStatsCategory(fresh.client, 'g1', { members: 108, servers: 12 });
  assert.deepEqual(first.created, ['@ stats', 'Members • 108', 'Servers • 12']);
  assert.equal(fresh.calls.create[0].type, ChannelType.GuildCategory);
  const category = [...fresh.guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildCategory);
  for (const options of fresh.calls.create) {
    const overwrite = options.permissionOverwrites[0];
    assert.equal(overwrite.id, 'g1', 'the rule is for @everyone');
    assert.deepEqual(overwrite.allow, [PermissionFlagsBits.ViewChannel], 'everybody sees it');
    assert.deepEqual(overwrite.deny, [PermissionFlagsBits.Connect], 'nobody joins it');
  }
  for (const options of fresh.calls.create.slice(1)) { assert.equal(options.type, ChannelType.GuildVoice); assert.equal(options.parent, category.id); }

  // Same numbers: nothing is touched. A new number: only that channel is renamed.
  const calls = fresh.calls;
  calls.create.length = 0;
  const same = await stats.updateStatsCategory(fresh.client, 'g1', { members: 108, servers: 12 });
  assert.deepEqual([same.created, same.renamed], [[], []]);
  assert.equal(calls.rename.length, 0);
  const grown = await stats.updateStatsCategory(fresh.client, 'g1', { members: 109, servers: 12 });
  assert.deepEqual(grown.renamed, ['Members • 109']);
  assert.deepEqual(calls.rename, [['Members • 108', 'Members • 109']]);

  // A deleted channel is made again, and a category written in another case is found.
  const lost = world({ existing: [{ name: '@ Stats', type: ChannelType.GuildCategory }] });
  const catId = [...lost.guild.channels.cache.values()][0].id;
  lost.guild.channels.cache.set('200', { id: '200', name: 'Servers • 3', type: ChannelType.GuildVoice, parentId: catId, setName: async () => {} });
  const again = await stats.updateStatsCategory(lost.client, 'g1', { members: 50, servers: 3 });
  assert.deepEqual(again.created, ['Members • 50'], 'the category and the servers channel were there; the members channel is made again');
  console.log('Checked the category @ stats: the names, the locked channels, the renames only when a number changed, the channels made again and what is skipped.');
})().catch((error) => { console.error(error); process.exit(1); });
