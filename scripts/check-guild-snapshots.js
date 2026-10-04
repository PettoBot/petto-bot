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
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const table = new Map();
let writes = 0;
stub('src/db/database.js', {
  from(name) {
    assert.equal(name, 'discord_guild_snapshots');
    const query = {
      upsert: async (row, options) => { assert.equal(options.onConflict, 'guild_id'); writes += 1; table.set(row.guild_id, row); return { error: null }; },
      select: () => Promise.resolve({ data: [...table.keys()].map((guild_id) => ({ guild_id })), error: null }),
      delete: () => ({ in: async (_column, ids) => { for (const id of ids) table.delete(id); return { error: null }; } }),
    };
    return query;
  },
});

const { buildSnapshot, saveGuildSnapshot, removeGuildSnapshot, syncAllGuildSnapshots, scheduleGuildSnapshot } = require('../src/utils/guildSnapshots');

const channel = (id, name, type, extra = {}) => ({ id, name, type, rawPosition: Number(id) % 10, parentId: null, topic: null, nsfw: false, isThread: () => false, ...extra });
const guild = (id, overrides = {}) => ({
  id, name: `Server ${id}`, icon: 'abc123', ownerId: '99', memberCount: 42,
  channels: { cache: new Map([['1', channel('1', 'general', 0, { topic: 'hello', parentId: '5' })], ['2', channel('2', 'voice', 2)], ['3', { ...channel('3', 'a thread', 11), isThread: () => true }]]) },
  roles: { cache: new Map([['10', { id: '10', name: '@everyone', color: 0, rawPosition: 0, managed: false, permissions: { bitfield: 1024n }, icon: null, hoist: false, mentionable: false }], ['11', { id: '11', name: 'Mods', color: 255, rawPosition: 3, managed: false, permissions: { bitfield: 8n }, icon: 'x', hoist: true, mentionable: true }]]) },
  ...overrides,
});

(async () => {
  const row = buildSnapshot(guild('1000'));
  assert.equal(row.guild_id, '1000'); assert.equal(row.name, 'Server 1000'); assert.equal(row.icon, 'abc123'); assert.equal(row.member_count, 42); assert.equal(row.owner_id, '99');
  assert.equal(row.channels.length, 2, 'threads are not saved');
  assert.deepEqual(row.channels[0], { id: '1', name: 'general', type: 0, position: 1, parent_id: '5', topic: 'hello', nsfw: false }, 'channels have the shape of Discord answers');
  assert.equal(row.roles.length, 2);
  assert.equal(row.roles[1].permissions, '8', 'permissions are a string like Discord sends them');
  assert.equal(row.roles[1].color, 255);
  JSON.stringify(row); // BigInt must not leak into the row

  const g = guild('1000');
  assert.equal(await saveGuildSnapshot(g), true); assert.equal(writes, 1);
  assert.equal(await saveGuildSnapshot(g), false, 'nothing changed, nothing saved'); assert.equal(writes, 1);
  g.name = 'Renamed';
  assert.equal(await saveGuildSnapshot(g), true); assert.equal(table.get('1000').name, 'Renamed');

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
