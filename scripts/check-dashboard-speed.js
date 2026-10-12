// Checks what the bot does so the dashboard stops asking Discord on every page: the members route (access, validation, shape,
// one gateway fetch, the 10 minute cache), the Redis copy of each saved server and its announcements (petto:snap, petto:guilds),
// and the caches forgetting a server when the dashboard says on petto:invalidate that it changed a table.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const express = require('express');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
delete process.env.REDIS_URL;
delete process.env.DISCLOUD_REDIS_URL;

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });

// A stand-in for the `redis` package with the calls used here, including a subscriber made with duplicate().
const store = new Map();
const sets = [];
const published = [];
const subscribers = new Map();
function fakeClient() {
  const handlers = {};
  const read = (key) => { const e = store.get(key); return e && e.until > Date.now() ? e.value : null; };
  return {
    on(event, fn) { handlers[event] = fn; },
    async connect() { handlers.ready?.(); },
    async ping() { return 'PONG'; },
    async get(key) { return read(key); },
    async mGet(keys) { return keys.map(read); },
    async set(key, value, options = {}) { sets.push({ key, options }); store.set(key, { value: String(value), until: Date.now() + (options.PX ?? 1e9) }); return 'OK'; },
    async del(key) { store.delete(key); },
    async publish(channel, message) {
      published.push([channel, message]);
      for (const listener of subscribers.get(channel) ?? []) listener(message);
      return subscribers.get(channel)?.size ?? 0;
    },
    async subscribe(channel, listener) { if (!subscribers.has(channel)) subscribers.set(channel, new Set()); subscribers.get(channel).add(listener); },
    duplicate() { return fakeClient(); },
  };
}
const redisModulePath = require.resolve('redis');
require.cache[redisModulePath] = { id: redisModulePath, filename: redisModulePath, loaded: true, exports: { createClient: () => fakeClient() } };

// The saved servers table, in memory.
const snapshotRows = new Map();
stub('src/db/guildSnapshots.js', {
  saveSnapshot: async (row) => { snapshotRows.set(row.guild_id, row); },
  deleteSnapshots: async (ids) => { for (const id of ids) snapshotRows.delete(String(id)); },
  listSnapshotIds: async () => [...snapshotRows.keys()],
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

function call(port, method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, json: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const GUILD = '111111111111111111';
const MANAGER = '222222222222222222';
const KEY = 'secret-key';
const id = (n) => String(300000000000000000n + BigInt(n));

function fakeMember(userId, { username, globalName = null, nick = null, avatar = null, guildAvatar = null, bot = false } = {}) {
  const user = { id: userId, username: username ?? `user${userId.slice(-3)}`, globalName, bot, avatarURL: () => (avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp` : null) };
  return {
    id: userId, partial: false, nickname: nick, user,
    displayName: nick ?? globalName ?? user.username,
    avatarURL: () => (guildAvatar ? `https://cdn.discordapp.com/guilds/${GUILD}/users/${userId}/avatars/${guildAvatar}.webp` : null),
  };
}

(async () => {
  const redis = require('../src/utils/redis');
  const { registerMemberRoutes } = require('../src/web/memberRoutes');
  const members = require('../src/utils/dashboardMembers');

  // ---- The members route -------------------------------------------------------------------------------------------------
  {
    const inCache = fakeMember(id(1), { username: 'alice', globalName: 'Alice', nick: 'Ali', guildAvatar: 'g1', avatar: 'a1' });
    const fetchable = {
      [id(2)]: fakeMember(id(2), { username: 'bob', avatar: 'b1' }),
      [id(3)]: fakeMember(id(3), { username: 'petto', bot: true }),
    };
    const fetchCalls = [];
    let fetchFails = false;
    const guild = {
      id: GUILD,
      members: {
        cache: new Map([[id(1), inCache]]),
        fetch: async (options) => {
          fetchCalls.push(options);
          if (fetchFails) throw new Error('Members didn\'t arrive in time.');
          return new Map(options.user.filter((userId) => fetchable[userId]).map((userId) => [userId, fetchable[userId]]));
        },
      },
    };
    let authorizations = 0;
    const app = express();
    app.use(express.json());
    let limited = 0;
    registerMemberRoutes(app, {
      isAuthorized: (req) => req.get('x-petto-dashboard-key') === KEY,
      // As dashboardCardAccess: the person (user_id) must manage the server.
      authorize: async (req, res) => {
        authorizations += 1;
        const userId = String(req.query.user_id || req.body?.user_id || '');
        if (req.params.guildId !== GUILD) { res.status(404).json({ ok: false, error: 'guild_unavailable' }); return null; }
        if (userId !== MANAGER) { res.status(403).json({ ok: false, error: 'no_access' }); return null; }
        return { guild, userId };
      },
      limiter: (_req, _res, next) => { limited += 1; next(); },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const url = `/api/dashboard/guild/${GUILD}/members?user_id=${MANAGER}`;
    const auth = { 'x-petto-dashboard-key': KEY };

    let res = await call(port, 'POST', url, { body: { ids: [id(1)] } });
    assert.equal(res.status, 401, 'no key, no answer');
    res = await call(port, 'POST', url, { body: { ids: [id(1)] }, headers: { 'x-petto-dashboard-key': 'wrong' } });
    assert.equal(res.status, 401);
    assert.equal(authorizations, 0, 'a request without the key never reaches Discord');

    for (const [body, error] of [
      [{}, 'invalid_ids'], [{ ids: id(1) }, 'invalid_ids'], [{ ids: [Number(id(1))] }, 'invalid_ids'], [{ ids: ['abc'] }, 'invalid_ids'],
      [{ ids: ['123'] }, 'invalid_ids'], [{ ids: [id(1), null] }, 'invalid_ids'], [{ ids: Array.from({ length: 101 }, (_, n) => id(n)) }, 'too_many_ids'],
    ]) {
      res = await call(port, 'POST', url, { body, headers: auth });
      assert.equal(res.status, 400, `rejected: ${JSON.stringify(body).slice(0, 40)}`);
      assert.deepEqual(res.json, { ok: false, error });
    }
    assert.equal(authorizations, 0, 'a bad body never reaches Discord');

    res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/members?user_id=${id(99)}`, { body: { ids: [id(1)] }, headers: auth });
    assert.equal(res.status, 403, 'someone who does not manage the server is refused');
    res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/members`, { body: { ids: [id(1)], user_id: MANAGER }, headers: auth });
    assert.equal(res.status, 200, 'user_id may come in the body too');

    res = await call(port, 'POST', url, { body: { ids: [] }, headers: auth });
    assert.deepEqual(res.json, { ok: true, members: {} }, 'no ids, no members');

    const asked = [id(1), id(2), id(3), id(4), id(2)];
    limited = 0;
    res = await call(port, 'POST', url, { body: { ids: asked }, headers: auth });
    assert.equal(res.status, 200);
    assert.equal(limited, 1, 'one call counts once against the limit');
    assert.deepEqual(Object.keys(res.json.members).sort(), [id(1), id(2), id(3)], 'someone who is not in the server is left out');
    assert.deepEqual(res.json.members[id(1)], {
      id: id(1), username: 'alice', globalName: 'Alice', displayName: 'Ali',
      avatar: `https://cdn.discordapp.com/guilds/${GUILD}/users/${id(1)}/avatars/g1.webp`, bot: false,
    }, 'the server avatar comes first');
    assert.deepEqual(res.json.members[id(2)], { id: id(2), username: 'bob', globalName: null, displayName: 'bob', avatar: `https://cdn.discordapp.com/avatars/${id(2)}/b1.webp`, bot: false });
    assert.deepEqual(res.json.members[id(3)], { id: id(3), username: 'petto', globalName: null, displayName: 'petto', avatar: null, bot: true }, 'no avatar is null');
    assert.equal(fetchCalls.length, 1, 'the missing members are asked for in one fetch');
    assert.deepEqual(fetchCalls[0].user, [id(2), id(3), id(4)], 'only the ones not in memory, once each, as an array (the gateway, not REST)');

    res = await call(port, 'POST', url, { body: { ids: [id(2), id(3), id(4)] }, headers: auth });
    assert.deepEqual(Object.keys(res.json.members).sort(), [id(2), id(3)]);
    assert.equal(fetchCalls.length, 1, 'the next call is answered from the cache, and the missing one is not asked again for a while');

    fetchFails = true;
    res = await call(port, 'POST', url, { body: { ids: [id(1), id(5)] }, headers: auth });
    assert.equal(res.status, 200, 'a gateway that does not answer still gives what there is');
    assert.deepEqual(Object.keys(res.json.members), [id(1)]);
    fetchFails = false;

    // With Redis the members are kept there for 10 minutes, under petto:members:<guild>:<user>.
    const config = require('../src/config');
    config.redisUrl = 'redis://fake';
    redis.start();
    assert.equal(redis.available(), true);
    fetchable[id(6)] = fakeMember(id(6), { username: 'carol', globalName: 'Carol' });
    res = await call(port, 'POST', url, { body: { ids: [id(6)] }, headers: auth });
    assert.equal(res.json.members[id(6)].displayName, 'Carol');
    const memberSet = sets.find((entry) => entry.key === `petto:members:${GUILD}:${id(6)}`);
    assert.ok(memberSet, 'the member is written to Redis');
    assert.equal(memberSet.options.PX, 10 * 60_000, 'for 10 minutes');
    assert.equal(JSON.parse(store.get(`petto:members:${GUILD}:${id(6)}`).value).username, 'carol');
    // A new process (empty memory) reads it from Redis instead of asking Discord.
    members._local.clear();
    const before = fetchCalls.length;
    res = await call(port, 'POST', url, { body: { ids: [id(6)] }, headers: auth });
    assert.equal(res.json.members[id(6)].username, 'carol');
    assert.equal(fetchCalls.length, before, 'read from Redis, no fetch');

    assert.match(fs.readFileSync(path.join(__dirname, '../src/web/server.js'), 'utf8'),
      /registerMemberRoutes\(app, \{ isAuthorized: dashboardAuthorized, authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter \}\)/,
      'the server mounts the route with the access check of the other dashboard routes');
    server.close();
  }

  // ---- The Redis copy of each saved server ------------------------------------------------------------------------------
  {
    const { saveGuildSnapshot, removeGuildSnapshot, announceGuildChange } = require('../src/utils/guildSnapshots');
    const guild = {
      id: '444444444444444444', name: 'Snap', icon: null, ownerId: '1', memberCount: 3, premiumTier: 0, premiumSubscriptionCount: 0,
      emojis: { cache: new Map([['555555555555555555', { id: '555555555555555555', name: 'wave', animated: true }]]) },
      members: { me: { nickname: null, avatar: null, roles: { cache: new Map() } } },
      channels: { cache: new Map([['1', { id: '1', name: 'general', type: 0, rawPosition: 0, parentId: null, isThread: () => false }]]) },
      roles: { cache: new Map([['2', { id: '2', name: '@everyone', color: 0, rawPosition: 0, permissions: { bitfield: 0n } }]]) },
    };
    published.length = 0;
    assert.equal(await saveGuildSnapshot(guild), true);
    const key = `petto:snap:${guild.id}`;
    const copy = JSON.parse(store.get(key).value);
    assert.deepEqual(copy, snapshotRows.get(guild.id), 'Redis holds the same row as the table');
    assert.deepEqual(copy.emojis, [{ id: '555555555555555555', name: 'wave', animated: true }]);
    assert.ok(Array.isArray(copy.channels) && Array.isArray(copy.roles) && copy.updated_at, 'with the lists and when it was saved');
    assert.equal(sets.filter((entry) => entry.key === key).at(-1).options.PX, 600_000, 'for 10 minutes (EX 600)');
    assert.deepEqual(published, [['petto:snap', guild.id]], 'and the change is announced on petto:snap');

    published.length = 0;
    store.delete(key);
    assert.equal(await saveGuildSnapshot(guild), false, 'nothing changed');
    assert.deepEqual(JSON.parse(store.get(key).value), copy, 'the Redis copy is written again so it does not expire');
    assert.deepEqual(published, [], 'but nothing is announced');

    await removeGuildSnapshot(guild.id);
    assert.equal(store.has(key), false, 'a server the bot left is forgotten in Redis too');
    await announceGuildChange(guild.id);
    assert.deepEqual(published.at(-1), ['petto:guilds', guild.id]);

    // The job: emojis created, edited or deleted refresh the copy; joining or leaving a server is announced on petto:guilds.
    const { Events } = require('discord.js');
    const { startGuildSnapshotJob } = require('../src/jobs/guildSnapshotJob');
    const client = new EventEmitter();
    client.user = { id: '9' };
    startGuildSnapshotJob(client);
    for (const event of [Events.GuildEmojiCreate, Events.GuildEmojiUpdate, Events.GuildEmojiDelete]) {
      assert.equal(client.listenerCount(event), 1, `${event} refreshes the saved server`);
    }
    published.length = 0;
    client.emit(Events.GuildCreate, { ...guild, id: '666666666666666666' });
    client.emit(Events.GuildDelete, { id: '777777777777777777', available: true });
    client.emit(Events.GuildDelete, { id: '888888888888888888', available: false });
    await tick(); await tick();
    assert.deepEqual(published.filter(([channel]) => channel === 'petto:guilds'), [['petto:guilds', '666666666666666666'], ['petto:guilds', '777777777777777777']],
      'joins and leaves are announced (not an outage)');
  }

  // ---- Invalidation from the dashboard ----------------------------------------------------------------------------------
  {
    const invalidation = require('../src/utils/cacheInvalidation');
    const modules = ['automod', 'uploads', 'responders', 'xpEvents', 'sanctionTemplates', 'ticketSettings', 'levelConfig', 'partners', 'stickyMessages', 'levelMultipliers'];
    for (const name of modules) require(`../src/db/${name}`);
    assert.deepEqual(invalidation.registeredTables(), [...invalidation.INVALIDATION_TABLES].sort(), 'every documented table has a cache, and every cache table is documented');
    assert.throws(() => require('../src/utils/expiringCache').createExpiringCache(1000, { invalidateOn: ['not_a_table'] }), /INVALIDATION_TABLES/);

    // Each module's cache really reads the table it registered for (the table name appears next to it in the source).
    for (const name of modules) {
      const source = fs.readFileSync(path.join(__dirname, `../src/db/${name}.js`), 'utf8');
      for (const [, tables] of source.matchAll(/invalidateOn: \[([^\]]+)\]/g)) {
        for (const table of tables.match(/'([a-z_]+)'/g).map((t) => t.slice(1, -1))) {
          assert.ok(source.includes(`from('${table}')`) || source.includes(`from ${table}`), `${name}.js reads ${table}`);
        }
      }
    }

    const { createExpiringCache } = require('../src/utils/expiringCache');
    const G = '123456789012345678';
    const OTHER = '876543210987654321';
    const byGuild = createExpiringCache(60_000, { name: 'check-level', invalidateOn: ['level_config'] });
    const byChannel = createExpiringCache(60_000, { name: 'check-sticky', invalidateOn: ['sticky_messages'], match: 'prefix' });
    const byRow = createExpiringCache(60_000, { name: 'check-responders', invalidateOn: ['button_responders'], match: (_key, row, guildId) => row?.guild_id === guildId });
    let loads = 0;
    const load = (value) => async () => { loads += 1; return value; };
    await byGuild.get(G, load({ v: 1 })); await byGuild.get(OTHER, load({ v: 1 }));
    await byChannel.get(`${G}:1`, load({ v: 1 })); await byChannel.get(`${G}:2`, load({ v: 1 })); await byChannel.get(`${OTHER}:1`, load({ v: 1 }));
    await byRow.get('41', load({ guild_id: G })); await byRow.get('42', load({ guild_id: OTHER }));
    assert.ok(store.has(`petto:cache:check-level:${G}`) && store.has(`petto:cache:check-sticky:${G}:1`), 'the second level is in Redis');

    // The message arrives on petto:invalidate through the subscriber connection.
    assert.equal(invalidation.startCacheInvalidation(), true);
    await tick(); await tick();
    assert.ok(subscribers.has('petto:invalidate'), 'subscribed on petto:invalidate');
    const send = async (message) => { await redis.publish('invalidate', typeof message === 'string' ? message : JSON.stringify(message)); await tick(); };

    loads = 0;
    await send({ table: 'level_config', guildId: G });
    assert.equal(store.has(`petto:cache:check-level:${G}`), false, 'the Redis copy is forgotten');
    assert.ok(store.has(`petto:cache:check-level:${OTHER}`), 'other servers are kept');
    assert.deepEqual(await byGuild.get(G, load({ v: 2 })), { v: 2 }, 'the next read goes to the database');
    assert.deepEqual(await byGuild.get(OTHER, load({ v: 2 })), { v: 1 });
    assert.equal(loads, 1);

    await send({ table: 'sticky_messages', guildId: G });
    assert.equal(store.has(`petto:cache:check-sticky:${G}:1`) || store.has(`petto:cache:check-sticky:${G}:2`), false);
    assert.deepEqual(await byChannel.get(`${G}:1`, load({ v: 2 })), { v: 2 }, 'every channel of the server is forgotten');
    assert.deepEqual(await byChannel.get(`${OTHER}:1`, load({ v: 2 })), { v: 1 });

    await send({ table: 'button_responders', guildId: G });
    assert.deepEqual(await byRow.get('41', load({ guild_id: G, v: 2 })), { guild_id: G, v: 2 }, 'responders of the server are forgotten by their row');
    assert.deepEqual(await byRow.get('42', load({ guild_id: OTHER, v: 2 })), { guild_id: OTHER });

    // Broken, unknown or partial messages change nothing.
    loads = 0;
    for (const message of ['not json', '"text"', 'null', { table: 'level_config' }, { table: 'level_config', guildId: 'abc' }, { table: 'nope', guildId: G }, { guildId: OTHER }]) {
      await send(message);
    }
    await byGuild.get(OTHER, load({ v: 3 }));
    assert.equal(loads, 0, 'nothing was forgotten');
    assert.equal(invalidation.invalidate('level_config', OTHER), 2, 'the real level cache and this check\'s one are both told');
    assert.equal(invalidation.handleInvalidationMessage('{"table":"unknown","guildId":"123456789012345678"}'), 0);

    assert.match(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), /startCacheInvalidation\(\)/, 'the bot listens at start');
  }

  console.log('dashboard speed checks passed (members route, Redis server copies, invalidation)');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
