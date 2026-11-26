// The status messages of the team channels (utils/discordOps.js): with the bot split between instances they list every shard that any instance reports (with its servers, ping and the instance that
// holds it) and the totals of the whole bot, not only what the primary has in memory. A fake Discord and a fake database: nothing real.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/d';
process.env.DISCORD_SHARDS = '0,5';
process.env.DISCORD_SHARD_COUNT = '6';
const root = path.join(__dirname, '..');
const resolve = (file) => require.resolve(path.join(root, file));
const fake = (file, exports) => { require.cache[resolve(file)] = { id: resolve(file), filename: resolve(file), loaded: true, exports }; };

const now = Date.now();
const ago = (ms) => new Date(now - ms).toISOString();
let rows = [
  { shard_id: 0, status: 'Ready', guild_count: 38, member_count: 9000, ping_ms: 25, updated_at: ago(3000), cluster_name: 'Discloud', cluster_location: null },
  { shard_id: 1, status: 'Ready', guild_count: 52, member_count: 11000, ping_ms: 61, updated_at: ago(4000), cluster_name: 'Miami', cluster_location: 'Florida, US' },
  { shard_id: 2, status: 'Ready', guild_count: 44, member_count: 10000, ping_ms: 78, updated_at: ago(4000), cluster_name: 'Miami', cluster_location: 'Florida, US' },
  { shard_id: 3, status: 'Ready', guild_count: 49, member_count: 12000, ping_ms: 142, updated_at: ago(5000), cluster_name: 'Ashburn', cluster_location: 'Virginia, US' },
  { shard_id: 4, status: 'Disconnected', guild_count: 50, member_count: 9500, ping_ms: null, updated_at: ago(5000), cluster_name: 'Ashburn', cluster_location: 'Virginia, US' },
  { shard_id: 5, status: 'Ready', guild_count: 48, member_count: 8800, ping_ms: 23, updated_at: ago(2000), cluster_name: 'Discloud', cluster_location: null },
  { shard_id: 9, status: 'Ready', guild_count: 1, member_count: 1, ping_ms: 1, updated_at: ago(1000), cluster_name: 'Old', cluster_location: null }, // a shard that does not exist (an old row)
];
let failing = false;
fake('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql) => {
  if (failing) throw new Error('database down');
  if (/count\(\*\)::int as servers/.test(sql)) return { rows: [{ servers: 281, members: '60300' }] };
  if (/from bot_status/.test(sql)) return { rows };
  throw new Error(`unexpected query: ${sql}`);
} }) });

const ops = require('../src/utils/discordOps');
const { Status } = require('discord.js');
const client = {
  user: { id: '9' },
  guilds: { cache: new Map([['1', { id: '1', shardId: 0, memberCount: 5 }], ['2', { id: '2', shardId: 5, memberCount: 7 }]]) },
  ws: { ping: 20, shards: new Map([[0, { id: 0, status: Status.Ready, ping: 25 }], [5, { id: 5, status: Status.Ready, ping: 23 }]]) },
};
const textOf = (card) => { const out = []; const walk = (n) => { if (!n || typeof n !== 'object') return; if (typeof n.content === 'string') out.push(n.content); Object.values(n).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v))); }; walk(card.toJSON()); return out.join('\n'); };

(async () => {
  // Split between instances: every shard of the whole bot, from what the instances reported.
  const whole = await ops.readWholeBot(client);
  assert.equal(whole.shards.length, 6, 'a row of a shard that does not exist is left out');
  assert.equal(whole.totals.servers, 281);
  const internal = textOf(ops.internalStatusCard(client));
  assert.match(internal, /\*\*Discord\*\* 281 servers · 60300 members \(the whole bot, 6 shards\)/, 'the totals of the whole bot, not the 2 servers of this process');
  assert.match(internal, /This process \(primary\)/);
  for (const [n, text] of [[1, /Shard 1\*\* · Online · 38 servers · 25 ms · Discloud/], [2, /Shard 2\*\* · Online · 52 servers · 61 ms · Miami · Florida, US/], [4, /Shard 4\*\* · Online · 49 servers · 142 ms · Ashburn · Virginia, US/],
    [5, /Shard 5\*\* · Disconnected · 50 servers · Ashburn · Virginia, US/], [6, /Shard 6\*\* · Online · 48 servers · 23 ms · Discloud/]]) assert.match(internal, text, `shard ${n}`);
  assert.doesNotMatch(internal, /Shard 5\*\*[^\n]*ms/, 'a shard that is down has no ping');
  assert.equal((internal.match(/\*\*Shard \d\*\*/g) ?? []).length, 6);
  const pub = textOf(ops.publicStatusCard(client));
  assert.match(pub, /\*\*Servers\*\* 281/); assert.match(pub, /Some services|degraded|outage|recover/i, 'one shard down: the public card does not say everything is fine');

  // A shard that has not reported for a while counts as down.
  rows = rows.map((row) => (row.shard_id === 4 ? { ...row, status: 'Ready', updated_at: ago(12 * 60_000) } : row));
  await ops.readWholeBot(client);
  assert.match(textOf(ops.internalStatusCard(client)), /Shard 5\*\* · No data for 12 min · 50 servers/, 'silent for 12 minutes');

  // Everything reports and runs: the public card is the good one.
  rows = rows.map((row) => ({ ...row, status: 'Ready', updated_at: ago(2000) }));
  await ops.readWholeBot(client);
  assert.match(textOf(ops.publicStatusCard(client)), /Petto is online and serving Discord communities/);

  // The database does not answer: this process alone, as before (its own shards, from its own cache).
  failing = true;
  await ops.readWholeBot(client);
  const alone = textOf(ops.internalStatusCard(client));
  assert.match(alone, /\*\*Discord\*\* 2 servers · 12 cached members/, 'the totals fall back to this process alone');
  assert.equal((alone.match(/\*\*Shard \d\*\*/g) ?? []).length, 2, 'and so do the shards');
  failing = false;

  console.log('status cards: ok');
})().catch((error) => { console.error(error); process.exit(1); });
