// The dashboard's change stamp (petto:ver:<guildId>): a write to a table of settings raises it once (a burst becomes one raise) and
// announces it on petto:ver; other tables, reads, and the dashboard's own route (which raises it itself) do not.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
delete process.env.REDIS_URL;
delete process.env.DISCLOUD_REDIS_URL;

const store = new Map();
const published = [];
const handlers = {};
const fake = {
  on(event, fn) { handlers[event] = fn; },
  async connect() { handlers.ready?.(); },
  async ping() { return 'PONG'; },
  async get(key) { return store.get(key) ?? null; },
  async incr(key) { const next = Number(store.get(key) ?? 0) + 1; store.set(key, String(next)); return next; },
  async expire() { return true; },
  async publish(channel, message) { published.push([channel, message]); return 1; },
  duplicate() { return fake; },
  async subscribe() {},
};
const redisModulePath = require.resolve('redis');
require.cache[redisModulePath] = { id: redisModulePath, filename: redisModulePath, loaded: true, exports: { createClient: () => fake } };

(async () => {
  const version = require('../src/utils/dashboardVersion');
  const redis = require('../src/utils/redis');
  const { createPostgresClient } = require('../src/db/postgres');
  const G = '111111111111111111';

  assert.equal(version.isSettingsTable('level_config'), true);
  assert.equal(version.isSettingsTable('ticket_settings'), true);
  assert.equal(version.isSettingsTable('antinuke_rules'), true);
  assert.equal(version.isSettingsTable('custom_commands'), true);
  assert.equal(version.isSettingsTable('level_users'), false, 'XP changes all the time');
  assert.equal(version.isSettingsTable('activity_stats'), false);
  assert.equal(version.isSettingsTable('mod_actions'), false);

  // Without Redis nothing is raised.
  assert.equal(version.noteDashboardChange(G), false);

  require('../src/config').redisUrl = 'redis://fake';
  redis.start();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const queries = [];
  const pool = { query: async (text, values) => { queries.push(text); return { rows: [] }; } };
  const db = createPostgresClient(pool);
  await db.from('level_config').upsert({ guild_id: G, enabled: true }, { onConflict: 'guild_id' });
  await db.from('level_config').update({ enabled: false }).eq('guild_id', G);
  await db.from('level_users').upsert({ guild_id: '222222222222222222', user_id: '1', xp: 5 });
  await db.from('level_config').select('*').eq('guild_id', '333333333333333333');
  await createPostgresClient(pool, { announce: false }).from('guilds').update({ prefix: '?' }).eq('guild_id', '444444444444444444');
  assert.equal(published.length, 0, 'raised a moment later, not at once');
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.deepEqual(published, [['petto:ver', `${G}:1`]], 'two writes in a row raise the stamp once; other tables, reads and the dashboard route do not');
  assert.equal(store.get(`petto:ver:${G}`), '1');

  await db.from('guilds').delete().eq('guild_id', G);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.deepEqual(published[1], ['petto:ver', `${G}:2`]);

  console.log('dashboard version: settings writes raise petto:ver:<id> once per burst; other writes do not.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
