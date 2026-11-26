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
fake('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql, params) => {
  if (failing) throw new Error('database down');
  // The totals of the whole bot: this process (2 servers, 12 members) plus what the shards of the other instances report (1 to 4: 195 servers, 42500 members).
  if (/select shard_id, guild_count, member_count from bot_status/.test(sql)) return { rows }; // all of them: the code leaves out the shards of this process and the one that does not exist
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
  const localIds = new Set(client.ws.shards.keys());
  const check = async () => { const whole = await ops.readWholeBot(client); return ops.evaluateRemoteShards(whole.shards, localIds); };
  const fresh = () => rows.map((row) => ({ ...row, status: 'Ready', updated_at: ago(2000) }));

  // Split between instances: every shard of the whole bot, from what the instances reported.
  const whole = await ops.readWholeBot(client);
  assert.equal(whole.shards.length, 6, 'a row of a shard that does not exist is left out');
  assert.equal(whole.totals.servers, 197); assert.equal(whole.totals.members, 42512);
  const internal = textOf(ops.internalStatusCard(client));
  assert.match(internal, /\*\*Discord\*\* 197 servers · 42512 members \(the whole bot, 6 shards\)/, 'the totals of the whole bot, not the 2 servers of this process');
  assert.match(internal, /This process \(primary\)/);
  for (const [n, text] of [[1, /Shard 1\*\* · Online · 38 servers · 25 ms · Discloud/], [2, /Shard 2\*\* · Online · 52 servers · 61 ms · Miami · Florida, US/], [4, /Shard 4\*\* · Online · 49 servers · 142 ms · Ashburn · Virginia, US/],
    [5, /Shard 5\*\* · Disconnected · 50 servers · Ashburn · Virginia, US/], [6, /Shard 6\*\* · Online · 48 servers · 23 ms · Discloud/]]) assert.match(internal, text, `shard ${n}`);
  assert.doesNotMatch(internal, /Shard 5\*\*[^\n]*ms/, 'a shard that is down has no ping');
  assert.equal((internal.match(/\*\*Shard \d\*\*/g) ?? []).length, 6);
  assert.match(textOf(ops.publicStatusCard(client)), /\*\*Servers\*\* 197/);

  // ---- The shards of the workers are watched: a shard that is down is announced, once, after two checks in a row ----------------------------------
  ops.resetRemoteShards();
  let result = await check(); // the shard 5 (Ashburn) says Disconnected
  assert.deepEqual(result, { events: [], downIds: [] }, 'one check could be a reconnect of a few seconds: nothing yet');
  assert.match(textOf(ops.publicStatusCard(client)), /Petto is online and serving Discord communities/, 'and the public card has not changed its mind');
  result = await check();
  assert.equal(result.events.length, 1); assert.equal(result.events[0].kind, 'down'); assert.deepEqual(result.downIds, [4]);
  assert.equal(ops.remoteMessage(result.events[0], result.downIds), 'Shard **5** (Ashburn · Virginia, US) is **Disconnected**. Its **50** servers may not answer until it recovers. The instance reconnects on its own.');
  assert.match(textOf(ops.publicStatusCard(client)), /Partial outage detected/, 'two checks: the public card says it');
  assert.equal(ops.aggregateGatewayState(client), 'outage');
  assert.deepEqual((await check()).events, [], 'it is not announced again every minute');

  // It comes back.
  rows = fresh();
  result = await check();
  assert.equal(result.events.length, 1); assert.equal(result.events[0].kind, 'up'); assert.deepEqual(result.downIds, []);
  assert.equal(ops.remoteMessage(result.events[0], result.downIds), 'Shard **5** (Ashburn · Virginia, US) is back. **All services are restored.**');
  assert.match(textOf(ops.publicStatusCard(client)), /Petto is online and serving Discord communities/);
  assert.equal(ops.aggregateGatewayState(client), 'online');

  // A blip (bad once, then fine) is never announced.
  ops.resetRemoteShards();
  rows = fresh().map((row) => (row.shard_id === 2 ? { ...row, status: 'Reconnecting' } : row));
  assert.deepEqual((await check()).events, []);
  rows = fresh();
  assert.deepEqual(await check(), { events: [], downIds: [] }, 'and nothing is said when it recovers either');

  // A whole instance that stops talking (the VPS is off): its shards are silent for more than 2 minutes.
  ops.resetRemoteShards();
  rows = fresh().map((row) => (row.cluster_name === 'Miami' ? { ...row, updated_at: ago(7 * 60_000) } : row));
  await check();
  result = await check();
  assert.deepEqual(result.downIds, [1, 2], 'both shards of the instance');
  assert.deepEqual(result.events.map((event) => event.kind), ['down', 'down']);
  assert.match(ops.remoteMessage(result.events[0], result.downIds), /Shard \*\*2\*\* \(Miami · Florida, US\) has not reported for \*\*7 minutes\*\*: its instance may be off or restarting\. Its \*\*52\*\* servers/);
  assert.match(textOf(ops.internalStatusCard(client)), /Shard 2\*\* · No data for 7 min · 52 servers/);

  // One of the two comes back: it says what is still down.
  rows = fresh().map((row) => (row.shard_id === 2 ? { ...row, updated_at: ago(7 * 60_000) } : row));
  result = await check();
  assert.equal(result.events.length, 1); assert.equal(result.events[0].kind, 'up'); assert.deepEqual(result.downIds, [2]);
  assert.equal(ops.remoteMessage(result.events[0], result.downIds), 'Shard **2** (Miami · Florida, US) is back. Still down: shard **3**.');

  // The shards of this process have their own events: a row of one of them is never judged here, and a row that disappears is forgotten.
  ops.resetRemoteShards();
  rows = fresh().map((row) => (row.shard_id === 0 ? { ...row, status: 'Disconnected' } : row));
  await check();
  assert.deepEqual((await check()).events, [], 'a local shard is the business of its own events');
  rows = fresh(); rows.splice(2, 1);
  rows = rows.map((row) => (row.shard_id === 3 ? { ...row, status: 'Disconnected' } : row));
  await check(); await check();
  rows = rows.filter((row) => row.shard_id !== 3);
  assert.deepEqual((await check()).downIds, [], 'a shard that is not in the table any more is forgotten');

  // The database does not answer: this process alone, as before (its own shards, from its own cache).
  failing = true;
  await ops.readWholeBot(client);
  const alone = textOf(ops.internalStatusCard(client));
  assert.match(alone, /\*\*Discord\*\* 2 servers · 12 cached members/, 'the totals fall back to this process alone');
  assert.equal((alone.match(/\*\*Shard \d\*\*/g) ?? []).length, 2, 'and so do the shards');
  failing = false;

  // The log of a server that joins or leaves is sent from whichever instance saw it, and the channels of the team are in the support server, which only one instance holds: asked for
  // without `allowUnknownGuild`, discord.js answers nothing for a channel whose server is not in this process (that was why nothing reached the log channels from a worker).
  const sentTo = [];
  const worker = { channels: { fetch: async (id, options) => (options?.allowUnknownGuild ? { isTextBased: () => true, messages: {}, send: async () => { sentTo.push(id); return {}; } } : undefined) } };
  await ops.sendGuildLifecycleLog(worker, { kind: 'join', guild: { id: '5', name: 'New server', memberCount: 12, iconURL: () => null }, ownerId: '1' });
  assert.ok(sentTo.length >= 1, 'the join log reaches its channel even when the support server is held by another instance');
  const sentBefore = sentTo.length;
  await ops.sendGuildLifecycleLog(worker, { kind: 'leave', guild: { id: '5', name: 'New server', memberCount: 12, iconURL: () => null } });
  assert.ok(sentTo.length > sentBefore, 'and so does the leave log');

  // An instance with another environment cannot reach the channels of the team: it is said (the join log, and a check after start), not skipped without a word.
  const config = require('../src/config');
  const logger = require('../src/utils/logger');
  const said = []; const originalWarn = logger.warn; const originalInfo = logger.info;
  logger.warn = (text) => said.push(['warn', String(text)]); logger.info = (text) => said.push(['info', String(text)]);
  const blind = { channels: { fetch: async () => undefined } };
  await ops.sendGuildLifecycleLog(blind, { kind: 'join', guild: { id: '7', name: 'Lost', memberCount: 3, iconURL: () => null }, ownerId: '1' });
  assert.ok(said.some(([level, text]) => level === 'warn' && /join log of 7 could not be posted in channel \d+/.test(text)), 'a join log that cannot be posted is a warning with the channel');
  said.length = 0;
  const joinId = config.opsChannels.joinLog;
  const partial = { channels: { fetch: async (id, options) => (id === joinId && options?.allowUnknownGuild ? { isTextBased: () => true, messages: {} } : undefined) } };
  const verdict = await ops.verifyTeamChannels(partial, {});
  assert.equal(verdict.reachable, 1, 'only the join channel is reachable');
  assert.ok(verdict.unreachable.some((line) => /^leave log: \d+ \(built-in default, the variable is not set here\)$/.test(line)), 'the channel it cannot reach is named with where its id comes from');
  assert.ok(said.some(([level, text]) => level === 'warn' && /Team channels this instance cannot reach/.test(text)));
  said.length = 0;
  const all = { channels: { fetch: async () => ({ isTextBased: () => true, messages: {} }) } };
  assert.equal((await ops.verifyTeamChannels(all, {})).unreachable.length, 0);
  assert.ok(said.some(([level, text]) => level === 'info' && /Team channels: \d+ reachable/.test(text)), 'all reachable: one line, no warning');
  logger.warn = originalWarn; logger.info = originalInfo;

  console.log('status cards: ok');
})().catch((error) => { console.error(error); process.exit(1); });
