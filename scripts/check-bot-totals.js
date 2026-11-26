// The jobs that work on the whole bot when its shards are split between instances (utils/botTotals.ts): the totals, the names of the servers of other shards, the carousel of the home page, and the
// cleanup of the servers that Petto left (which must never take a server of another shard for one that left). A real Discord and a real database are not used: every piece is a fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/d';
process.env.DISCORD_SHARDS = '0,5'; // this process holds two of the six shards: the bot is split
process.env.DISCORD_SHARD_COUNT = '6';
const root = path.join(__dirname, '..');
const resolve = (file) => require.resolve(path.join(root, file));
const fake = (file, exports) => { require.cache[resolve(file)] = { id: resolve(file), filename: resolve(file), loaded: true, exports }; };

// The database: the copies of the servers that every instance saves.
const SNAPSHOTS = [
  { guild_id: '100', name: 'Mine', icon: 'a_abc', member_count: 900 },
  { guild_id: '200', name: 'Elsewhere', icon: 'def', member_count: 1200 },
  { guild_id: '300', name: 'Small elsewhere', icon: null, member_count: 40 },
  { guild_id: '400', name: 'Unknown size', icon: null, member_count: null },
];
// What the other shards say about themselves (table bot_status): shards 1 to 4 are in the other instances.
let STATUS = [1, 2, 3, 4].map((id) => ({ shard_id: id, guild_count: id * 10, member_count: id * 100 }));
const asId = ({ guild_id, ...rest }) => ({ id: guild_id, ...rest }); // the reads of the whole bot ask for `guild_id as id`
const queries = [];
let failing = false;
let statusFails = false;
fake('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql, params) => {
  queries.push({ sql, params });
  if (failing) throw new Error('database down');
  if (/from bot_status/.test(sql)) { if (statusFails) throw new Error('no table'); return { rows: STATUS.filter((row) => !params[0].includes(row.shard_id) && row.shard_id < params[1]) }; }
  if (/as without_members/.test(sql)) return { rows: [{ total: SNAPSHOTS.length, without_members: SNAPSHOTS.filter((row) => row.member_count === null).length }] };
  if (/count\(\*\)::int as servers/.test(sql)) return { rows: [{ servers: SNAPSHOTS.length, members: String(SNAPSHOTS.reduce((total, row) => total + (row.member_count ?? 0), 0)) }] };
  if (/guild_id = any/.test(sql)) return { rows: SNAPSHOTS.filter((row) => params[0].includes(row.guild_id)).map(asId) };
  if (/member_count >= /.test(sql)) return { rows: SNAPSHOTS.filter((row) => row.member_count >= params[0]).sort((a, b) => b.member_count - a.member_count).map(asId) };
  if (/select guild_id as id from discord_guild_snapshots/.test(sql)) return { rows: SNAPSHOTS.map((row) => ({ id: row.guild_id })) };
  throw new Error(`unexpected query: ${sql}`);
} }) });

const config = require('../src/config');
const totals = require('../src/utils/botTotals');
const guild = (id, memberCount = 10) => ({ id, memberCount });
const clientOf = (guilds) => ({ guilds: { cache: new Map(guilds.map((entry) => [entry.id, entry])) } });

(async () => {
  // ---- Is the bot split? ----------------------------------------------------------------------------------------------------------
  assert.deepEqual(config.shards, [0, 5]); assert.equal(config.shardCount, 6);
  assert.equal(totals.isSplit(), true, 'this process holds 2 of 6 shards');
  assert.equal(totals.isSplit([0, 1, 2, 3, 4, 5], 6), false, 'all the shards in one process is not split');
  assert.equal(totals.isSplit([0], 1), false); assert.equal(totals.isSplit('auto', undefined), false); assert.equal(totals.isSplit('auto', 6), false); assert.equal(totals.isSplit([0, 5], 0), false);

  // ---- The totals -----------------------------------------------------------------------------------------------------------------
  const client = clientOf([guild('100', 900), guild('500', 7)]);
  assert.deepEqual(totals.totalsFromCache(client), { servers: 2, members: 907, source: 'cache' });
  assert.deepEqual(await totals.readTotals(client, false), { servers: 2, members: 907, source: 'cache' }, 'not split: the cache, as it always was');
  // Split: this process (its cache) plus what the shards of the other instances say about themselves (10 + 20 + 30 + 40 servers, 1000 members).
  assert.deepEqual(await totals.readTotals(client, true), { servers: 102, members: 1907, source: 'shards' }, 'split: this process and what every other shard reports');
  assert.deepEqual(await totals.readTotals(client, true), await totals.readTotals(client, true), 'the same answer every time: the number does not jump');
  const bigger = clientOf(Array.from({ length: 9 }, (_, index) => guild(String(1000 + index), 100)));
  assert.deepEqual(await totals.readTotals(bigger, true), { servers: 109, members: 1900, source: 'shards' }, 'the other shards are added to whatever this process holds');
  const saved = STATUS;
  STATUS = STATUS.filter((row) => row.shard_id !== 3);
  assert.deepEqual(await totals.readTotals(client, true), { servers: 4, members: 2140, source: 'snapshots' }, 'a shard that never reported: the copies of the servers instead');
  assert.deepEqual(await totals.readTotals(bigger, true), { servers: 9, members: 2140, source: 'snapshots' }, 'never less than what this process sees by itself');
  STATUS = saved; statusFails = true;
  assert.deepEqual(await totals.readTotals(client, true), { servers: 4, members: 2140, source: 'snapshots' }, 'the reports unreadable: the copies of the servers');
  statusFails = false; failing = true;
  assert.deepEqual(await totals.readTotals(client, true), { servers: 2, members: 907, source: 'cache' }, 'with the database down: this process alone');
  failing = false;

  // ---- The servers of other shards ------------------------------------------------------------------------------------------------
  const known = await totals.readKnownGuilds(['200', '999', '200']);
  assert.deepEqual([...known.keys()], ['200']); assert.deepEqual(known.get('200'), { id: '200', name: 'Elsewhere', icon: 'def', members: 1200 });
  assert.equal((await totals.readKnownGuilds([])).size, 0, 'nothing to look for, nothing asked');
  assert.equal((await totals.readKnownGuilds(['400'])).get('400').members, null, 'a server with no member count says null');
  assert.deepEqual((await totals.readBigGuilds(500)).map((entry) => entry.id), ['200', '100'], 'the big servers, the biggest first');
  assert.deepEqual([...(await totals.readAllGuildIds())].sort(), ['100', '200', '300', '400']);
  assert.deepEqual(await totals.readSnapshotHealth(), { total: 4, withoutMembers: 1 }, 'how many copies do not know their members');
  assert.equal(totals.iconUrl('200', 'def'), 'https://cdn.discordapp.com/icons/200/def.png?size=64');
  assert.equal(totals.iconUrl('100', 'a_abc', 128, 'webp'), 'https://cdn.discordapp.com/icons/100/a_abc.gif?size=128', 'an animated icon is a GIF');
  assert.equal(totals.iconUrl('300', null), null);

  // ---- The carousel has the servers of the other shards ----------------------------------------------------------------------------
  const showcase = require('../src/utils/showcaseServers');
  showcase.resetShowcase();
  const fetched = [];
  const showClient = { guilds: { cache: new Map([['100', { id: '100', name: 'Mine', memberCount: 900, icon: null, features: ['COMMUNITY'], premiumSubscriptionCount: 0, premiumTier: 0 }]]),
    fetch: async ({ guild: id }) => { fetched.push(id); return { id, approximatePresenceCount: id === '200' ? 321 : 55, features: id === '200' ? ['PARTNERED'] : [], premiumSubscriptionCount: 0, premiumTier: 0 }; } } };
  const others = (await totals.readBigGuilds(500)).filter((entry) => entry.id !== '100');
  const built = await showcase.buildShowcase(showClient, new Set(), 1_000_000, others);
  assert.deepEqual(built.map((entry) => entry.id), ['200', '100'], 'the server of another shard is in, ordered by members with the ones of this process');
  assert.deepEqual(built[0], { id: '200', name: 'Elsewhere', icon: 'https://cdn.discordapp.com/icons/200/def.webp?size=128', animated: false, members: 1200, online: 321, badge: 'partnered' }, 'its badge and online members come from Discord');
  assert.equal(built[1].badge, 'community', 'a server of this process keeps its own data');
  const before = fetched.length;
  await showcase.buildShowcase(showClient, new Set(), 1_000_500, others);
  assert.equal(fetched.length, before, 'what Discord said is kept for five minutes');
  assert.deepEqual((await showcase.buildShowcase(showClient, new Set(['200']), 1_000_000, others)).map((entry) => entry.id), ['100'], 'a server that chose to be hidden is out, wherever its shard is');

  // ---- The cleanup of the servers Petto left ----------------------------------------------------------------------------------------
  const calls = { sync: [], erased: [], cleared: [] };
  const departures = { knownGuilds: async () => ['100', '200', '300', '777'], sync: async (missing, present) => { calls.sync.push({ missing: [...missing], present: [...present] }); },
    counts: async () => ({ waiting: 0, due: 0 }), due: async () => ['200', '777'], clear: async (id) => { calls.cleared.push(id); }, erase: async (id) => { calls.erased.push(id); } };
  fake('src/db/guildDepartures.js', departures);
  delete require.cache[resolve('src/jobs/guildPurgeJob.js')];
  const { purgeLeftGuilds } = require('../src/jobs/guildPurgeJob');
  const botClient = (guilds, expected) => ({ isReady: () => true, ...clientOf(guilds), application: { fetch: async () => (expected === 'fails' ? Promise.reject(new Error('no answer')) : { approximateGuildCount: expected }) } });
  const reset = () => { calls.sync.length = 0; calls.erased.length = 0; calls.cleared.length = 0; };

  // The bot is in 4 servers (the copies), this process has 1 of them: Discord says 4. The ones of other shards are NOT servers that left; only 777 is.
  reset();
  let result = await purgeLeftGuilds(botClient([guild('100')], 4));
  assert.deepEqual(calls.sync, [{ missing: ['777'], present: ['100', '200', '300'] }], 'a server of another shard is present, only the one nobody has is missing');
  assert.deepEqual(calls.cleared, ['200'], 'a server due that is in another shard is not deleted: it is cleared');
  assert.deepEqual(calls.erased, ['777'], 'only the server that nobody has is deleted'); assert.equal(result.noted, 1);

  // Discord says the bot is in far more servers than the list of the whole bot has: nothing is decided.
  reset();
  await purgeLeftGuilds(botClient([guild('100')], 280));
  assert.deepEqual(calls.sync, []); assert.deepEqual(calls.erased, [], 'a list clearly shorter than Discord says: skipped');
  // That warning is said once, not every minute: the same skip again goes to the plain log, so the alert channels are not filled.
  const logger = require('../src/utils/logger');
  const said = { warn: 0, info: 0 }; const originalWarn = logger.warn; const originalInfo = logger.info;
  logger.warn = () => { said.warn += 1; }; logger.info = () => { said.info += 1; };
  require('../src/jobs/guildPurgeJob').resetSkipped();
  for (let pass = 0; pass < 5; pass += 1) await purgeLeftGuilds(botClient([guild('100')], 280));
  logger.warn = originalWarn; logger.info = originalInfo;
  assert.deepEqual(said, { warn: 1, info: 4 }, 'five minutes of the same skip: one warning');

  // Discord does not answer how many servers there are: split between instances there is nothing to check the list against, so nothing is decided.
  reset();
  await purgeLeftGuilds(botClient([guild('100')], 'fails'));
  assert.deepEqual(calls.sync, []); assert.deepEqual(calls.erased, [], 'without Discord\'s number, nothing is deleted');

  // The saved list cannot be read: nothing is decided either.
  reset(); failing = true;
  await purgeLeftGuilds(botClient([guild('100')], 4));
  assert.deepEqual(calls.sync, []); assert.deepEqual(calls.erased, []); failing = false;

  // ---- Who runs what -------------------------------------------------------------------------------------------------------------
  const role = require('../src/utils/instanceRole');
  assert.equal(role.ONE_PER_BOT.has('startStatsCategoryJob'), true, 'the channels of the support server are for the instance that has that server: the primary');
  const read = (file) => fs.readFileSync(resolve(file), 'utf8');
  assert.match(read('src/jobs/globalStatsJob.js'), /botTotals\.readTotals\(client\)/, 'the public totals are the whole bot');
  assert.match(read('src/jobs/globalStatsJob.js'), /readKnownGuilds[\s\S]{0,200}describe/, 'the servers of the ranking are named from the copies when they are in another shard');
  assert.match(read('src/jobs/statsCategoryJob.ts'), /readTotals\(client\)/, 'the channels of "@ stats" show the whole bot');
  assert.match(read('src/commands/info/botinfo.js'), /readTotals\(client\)/, '/bot info says the servers of the whole bot');

  console.log('bot totals: ok');
})().catch((error) => { console.error(error); process.exit(1); });
