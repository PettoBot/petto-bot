// The optional Redis: nothing changes without it, and with it the caches, the cooldowns and the request limit are shared.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
delete process.env.REDIS_URL;
delete process.env.DISCLOUD_REDIS_URL;

// A small stand-in for the `redis` package: the same calls the bot makes, kept in memory.
const store = new Map();
const handlers = {};
const fake = {
  on(event, fn) { handlers[event] = fn; },
  async connect() { handlers.ready?.(); },
  async ping() { return 'PONG'; },
  async get(key) { const e = store.get(key); return e && e.until > Date.now() ? e.value : null; },
  async set(key, value, options = {}) {
    const e = store.get(key);
    if (options.NX && e && e.until > Date.now()) return null;
    store.set(key, { value: String(value), until: Date.now() + (options.PX ?? 1e9) });
    return 'OK';
  },
  async del(key) { store.delete(key); },
  async pTTL(key) { const e = store.get(key); return e ? e.until - Date.now() : -2; },
  async incr(key) { const e = store.get(key); const next = (e && e.until > Date.now() ? Number(e.value) : 0) + 1; store.set(key, { value: String(next), until: e?.until ?? Date.now() + 1e9 }); return next; },
  async expire(key, seconds) { const e = store.get(key); if (e) e.until = Date.now() + seconds * 1000; },
};
const redisModulePath = require.resolve('redis');
require.cache[redisModulePath] = { id: redisModulePath, filename: redisModulePath, loaded: true, exports: { createClient: () => fake } };

(async () => {
  const redis = require('../src/utils/redis');
  const { createExpiringCache } = require('../src/utils/expiringCache');
  const { getRemainingCooldownShared } = require('../src/utils/sharedCooldown');
  const { attachSharedRestLimit } = require('../src/utils/sharedRestLimit');

  // Without Redis: every helper answers at once with its fallback, and the cache is the usual one.
  assert.equal(redis.enabled(), false);
  assert.deepEqual(await redis.getJson('x'), { hit: false });
  assert.equal(await redis.claim('x', 1000), 0);
  assert.equal(await redis.countThisSecond('rest'), 0);
  let loads = 0;
  const plain = createExpiringCache(1000, { name: 'plain' });
  assert.equal(await plain.get('a', async () => { loads += 1; return { n: 1 }; }).then((v) => v.n), 1);
  await plain.get('a', async () => { loads += 1; return { n: 2 }; });
  assert.equal(loads, 1, 'the memory cache still works');

  // With Redis.
  const config = require('../src/config');
  config.redisUrl = 'redis://fake';
  redis.start();
  assert.equal(redis.available(), true);

  loads = 0;
  const first = createExpiringCache(5000, { name: 'sticky' });
  assert.deepEqual(await first.get('g:c', async () => { loads += 1; return { id: 1, text: 'hi' }; }), { id: 1, text: 'hi' });
  const afterRestart = createExpiringCache(5000, { name: 'sticky' }); // an empty memory, as after a restart
  assert.deepEqual(await afterRestart.get('g:c', async () => { loads += 1; return { id: 2 }; }), { id: 1, text: 'hi' });
  assert.equal(loads, 1, 'a restart reads the cache from Redis, not the database');
  afterRestart.delete('g:c');
  assert.deepEqual(await afterRestart.get('g:c', async () => { loads += 1; return { id: 3 }; }), { id: 3 }, 'deleting forgets it in Redis too');
  afterRestart.set('g:c', { id: 4 });
  const another = createExpiringCache(5000, { name: 'sticky' });
  assert.deepEqual(await another.get('g:c', async () => { loads += 1; return { id: 9 }; }), { id: 4 }, 'what is set is shared');

  assert.equal(await getRemainingCooldownShared('ping', 'u1', 1500), 0, 'the first use is free');
  store.delete('petto:cooldown:ping:u1');
  const memory = require('../src/utils/cooldown');
  assert.ok(memory.getRemainingCooldown('ping', 'u1', 1500) > 0, 'and it is counted in memory too');
  assert.equal(await redis.claim('cooldown:ban:u2', 1500), 0);
  const left = await redis.claim('cooldown:ban:u2', 1500);
  assert.ok(left > 0 && left <= 1500, 'a second use waits what is left');

  // The shared request limit: two a second, so the third waits for the next second.
  const calls = [];
  const rest = { request: async (options) => { calls.push(options.n); return options.n; } };
  attachSharedRestLimit(rest, 2);
  const started = Date.now();
  const alignedWait = 1_005 - (started % 1_000);
  const results = await Promise.all([1, 2, 3].map((n) => rest.request({ n })));
  assert.deepEqual(results.sort(), [1, 2, 3]);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 0 && elapsed <= alignedWait + 1500, 'the requests all go through');

  // A Redis that fails is skipped, and the answers fall back at once.
  fake.get = async () => { throw new Error('down'); };
  assert.deepEqual(await redis.getJson('x'), { hit: false });
  assert.equal(redis.available(), false, 'a failing Redis is left alone for a while');
  assert.equal(await redis.claim('x', 1000), 0);

  void path;
  console.log('redis checks passed');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
