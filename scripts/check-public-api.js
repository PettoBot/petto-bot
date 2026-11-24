// The read-only API: keys are made once (only the hash is kept), at most three, removed by their owner, and a key reads only its own person.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const stored = []; // { id, user, hash, label }
let nextId = 1;
stub('apiKeys', {
  MAX_KEYS: 3,
  listKeys: async (user) => stored.filter((k) => k.user === user).map((k) => ({ id: k.id, label: k.label, createdAt: '2026-01-01T00:00:00.000Z', lastUsed: null })),
  addKey: async (user, hash, label) => { if (stored.filter((k) => k.user === user).length >= 3) return null; stored.push({ id: nextId, user, hash, label }); return nextId++; },
  removeKey: async (user, id) => { const i = stored.findIndex((k) => k.user === user && k.id === id); if (i < 0) return false; stored.splice(i, 1); return true; },
  userOfKey: async (hash) => stored.find((k) => k.hash === hash)?.user ?? null,
});
stub('ceramos', { getWallet: async (user) => ({ balance: user === 'A' ? 70 : 5, lastDaily: null }), lastMovements: async () => [{ delta: 5, reason: 'daily', ref: null, createdAt: new Date('2026-01-02T00:00:00Z') }] });
stub('userPlans', { getPlan: async (user) => (user === 'A' ? { plan: 'gold', active: true, endsAt: null } : null) });
const api = require('../src/utils/publicApiActions');
(async () => {
  const made = await api.create('A', { label: '  my bot  ' });
  assert.equal(made.ok, true);
  assert.match(made.key, /^petto_[A-Za-z0-9_-]{43}$/);
  assert.equal(stored[0].hash, api.hashKey(made.key), 'the hash is kept');
  assert.ok(!JSON.stringify(stored).includes(made.key), 'the key itself is never kept');
  assert.equal(stored[0].label, 'my bot');
  await api.create('A', {}); await api.create('A', {});
  assert.deepEqual(await api.create('A', {}), { ok: false, error: 'too_many' });
  assert.equal((await api.list('A')).keys.length, 3);
  assert.equal((await api.list('B')).keys.length, 0);
  // A key reads only its own person.
  const me = await api.read(made.key, 'me');
  assert.equal(me.ok, true); assert.equal(me.balance, 70); assert.equal(me.plan, 'gold'); assert.equal(me.dailyAmount, 20);
  const moves = await api.read(made.key, 'movements');
  assert.equal(moves.movements[0].amount, 5);
  const other = await api.create('B', {});
  assert.equal((await api.read(other.key, 'me')).balance, 5);
  assert.equal((await api.read(other.key, 'me')).plan, 'free');
  // Bad keys.
  assert.equal((await api.read('nope', 'me')).error, 'bad_key');
  assert.equal((await api.read(undefined, 'me')).error, 'bad_key');
  assert.equal((await api.read(`petto_${'x'.repeat(43)}`, 'me')).error, 'bad_key');
  // Removing: only the owner's key.
  assert.deepEqual(await api.remove('B', { id: stored[0].id }), { ok: false, error: 'not_found' });
  assert.deepEqual(await api.remove('A', { id: stored[0].id }), { ok: true });
  assert.equal((await api.read(made.key, 'me')).error, 'bad_key', 'a removed key stops working');
  assert.equal((await api.remove('A', { id: 'x' })).error, 'bad_request');
  // 60 reads a minute for each key.
  let last; for (let i = 0; i < 70; i += 1) last = await api.read(other.key, 'me');
  assert.equal(last.error, 'rate_limited');
  // What anyone can read.
  const info = api.publicInfo();
  assert.equal(info.packs.length, 4); assert.equal(info.packs[0].priceUsd, 2.99); assert.equal(info.daily.gold, 20);
  console.log('public api: ok');
})().catch((error) => { console.error(error); process.exit(1); });
