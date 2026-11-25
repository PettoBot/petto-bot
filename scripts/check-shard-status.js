// What each instance says about its own shards (utils/shardReport.ts, db/botStatus.ts, jobs/statusHeartbeatJob.ts) and the shard line of /ping. A real Discord and a real database are not used: every piece is a fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const resolve = (file) => require.resolve(path.join(root, file));
const report = require('../src/utils/shardReport');
const role = require('../src/utils/instanceRole');

// ---- The name and the place of the instance ---------------------------------------------------------------------------------------
assert.deepEqual(report.clusterOf({}), { name: null, location: null });
assert.deepEqual(report.clusterOf({ PETTO_CLUSTER_NAME: '  Miami ', PETTO_CLUSTER_LOCATION: 'Florida,\n US' }), { name: 'Miami', location: 'Florida, US' });
assert.equal(report.clusterOf({ PETTO_CLUSTER_NAME: '   ' }).name, null, 'a blank name is no name');
assert.equal(report.clusterOf({ PETTO_CLUSTER_NAME: 'x'.repeat(100) }).name.length, 40, 'at most 40 characters');
assert.equal(report.clusterOf({ PETTO_CLUSTER_NAME: 'a\u0000b\u001fc' }).name, 'a b c', 'no control characters');

// ---- One row for each shard of this instance ---------------------------------------------------------------------------------------
const guild = (shardId, memberCount) => ({ shardId, memberCount });
const client = {
  guilds: { cache: new Map([['a', guild(1, 10)], ['b', guild(1, 5)], ['c', guild(2, 7)], ['d', { shardId: 2 }], ['e', { memberCount: 3 }]]) },
  ws: { shards: new Map([[2, { status: 0, ping: 23.4 }], [1, { status: 5, ping: -1 }]]) },
  options: { shardCount: 6 },
};
assert.deepEqual(report.collectShards(client), [
  { shardId: 1, status: 'Disconnected', guildCount: 2, memberCount: 15, pingMs: null },
  { shardId: 2, status: 'Ready', guildCount: 2, memberCount: 7, pingMs: 23 },
], 'the rows come sorted, with the servers and members of each shard, and a shard without ping says null');
assert.equal(report.statusLabel(0), 'Ready'); assert.equal(report.statusLabel(99), 'Unknown');

// ---- The shard line of /ping ------------------------------------------------------------------------------------------------------
assert.deepEqual(report.shardForPing(client, { shardId: 2 }), { shard: 3, shardCount: 6, guilds: 2 }, 'the shard of the server where it was used, counted from 1, out of all the shards');
assert.deepEqual(report.shardForPing(client, null), { shard: 2, shardCount: 6, guilds: 2 }, 'in a direct message: the first shard of the instance');
assert.equal(report.shardForPing({ ...client, options: undefined }, { shardId: 4 }).shardCount, 5, 'without a configured count it is never smaller than the shard shown');
assert.deepEqual(report.shardForPing({ guilds: { cache: new Map() }, ws: { shards: new Map() } }, null), { shard: 1, shardCount: 1, guilds: 0 }, 'a bot with nothing says 1/1');
const ping = fs.readFileSync(resolve('src/commands/info/ping.js'), 'utf8');
assert.match(ping, /shardForPing\(client, interaction\.guild\)/, '/ping asks for the shard of the server');
assert.doesNotMatch(ping, /client\.shard\b/, '/ping does not read client.shard, which does not exist here');

// ---- Who reports ------------------------------------------------------------------------------------------------------------------
assert.equal(role.ONE_PER_BOT.has('startStatusHeartbeatJob'), false, 'every instance reports its shards');
assert.equal(role.ONE_PER_BOT.has('startStatusProbeJob'), true, 'the probe of the services is still one for the whole bot');
assert.equal(role.shouldRun('startStatusHeartbeatJob', { PETTO_ROLE: 'worker' }), true, 'a worker reports its shards');
assert.equal(role.shouldRun('startStatusHeartbeatJob', {}), true);

// ---- The row that is saved --------------------------------------------------------------------------------------------------------
function load(file, env, fakes) {
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(root, 'src'))) delete require.cache[key];
  for (const [name, exports] of Object.entries(fakes)) require.cache[resolve(name)] = { id: resolve(name), filename: resolve(name), loaded: true, exports };
  for (const key of ['PETTO_ROLE', 'PETTO_CLUSTER_NAME', 'PETTO_CLUSTER_LOCATION']) delete process.env[key];
  Object.assign(process.env, env);
  return require(resolve(file));
}

(async () => {
  const saved = [];
  const database = { from: (table) => ({ upsert: async (row, options) => { saved.push({ table, row, options }); return { error: null }; } }) };
  const botStatus = load('src/db/botStatus.js', {}, { 'src/db/database.js': database });
  await botStatus.upsertShardStatus(3, 'Ready', 47, 21, { memberCount: 1234.6, clusterName: 'Virginia', clusterLocation: 'Ashburn, US' });
  await botStatus.upsertShardStatus(0, 'Ready', 3, null);
  assert.equal(saved.length, 2); assert.equal(saved[0].table, 'bot_status'); assert.deepEqual(saved[0].options, { onConflict: 'shard_id' });
  assert.deepEqual({ ...saved[0].row, updated_at: undefined }, { shard_id: 3, status: 'Ready', guild_count: 47, ping_ms: 21, member_count: 1235, cluster_name: 'Virginia', cluster_location: 'Ashburn, US', updated_at: undefined });
  assert.deepEqual({ ...saved[1].row, updated_at: undefined }, { shard_id: 0, status: 'Ready', guild_count: 3, ping_ms: null, member_count: 0, cluster_name: null, cluster_location: null, updated_at: undefined }, 'an instance with no name says null');
  assert.ok(!Number.isNaN(Date.parse(saved[0].row.updated_at)), 'the row says when it was written');

  // ---- The heartbeat: a worker reports its shards but not the host, the primary reports both -------------------------------------
  async function beat(env) {
    const shards = []; const hosts = [];
    const job = load('src/jobs/statusHeartbeatJob.js', env, {
      'src/db/botStatus.js': { upsertShardStatus: async (...args) => { shards.push(args); } },
      'src/db/botHost.js': { upsertHost: async (...args) => { hosts.push(args); } },
      'src/utils/logger.js': { info() {}, warn() {}, error() {} },
    });
    job.startStatusHeartbeatJob({ ...client, guilds: { cache: new Map([['a', guild(1, 10)]]) }, ws: { shards: new Map([[1, { status: 0, ping: 18 }]]) } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    return { shards, hosts };
  }
  const worker = await beat({ PETTO_ROLE: 'worker', PETTO_CLUSTER_NAME: 'Miami', PETTO_CLUSTER_LOCATION: 'Florida, US' });
  assert.equal(worker.shards.length, 1, 'a worker reports the shards it holds');
  assert.deepEqual(worker.shards[0], [1, 'Ready', 1, 18, { memberCount: 10, clusterName: 'Miami', clusterLocation: 'Florida, US' }]);
  assert.equal(worker.hosts.length, 0, 'a worker never writes the row of the host: it is one for the whole bot');
  const primary = await beat({});
  assert.equal(primary.shards.length, 1); assert.equal(primary.hosts.length, 1, 'the primary writes the row of the host');
  assert.deepEqual(primary.shards[0].slice(0, 4), [1, 'Ready', 1, 18]); assert.deepEqual(primary.shards[0][4], { memberCount: 10, clusterName: null, clusterLocation: null });

  // ---- The table has the new columns ------------------------------------------------------------------------------------------------
  const schema = fs.readFileSync(resolve('src/db/schema.sql'), 'utf8');
  for (const column of ['member_count integer not null default 0', 'cluster_name text', 'cluster_location text']) {
    assert.ok(schema.includes(`alter table bot_status add column if not exists ${column};`), `schema.sql adds ${column}`);
  }
  const docs = fs.readFileSync(resolve('docs/SECOND_INSTANCE.md'), 'utf8');
  assert.match(docs, /PETTO_CLUSTER_NAME/, 'the docs tell how to name an instance');

  console.log('shard status: ok');
})().catch((error) => { console.error(error); process.exit(1); });
