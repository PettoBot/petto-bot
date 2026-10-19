// Checks the stats Petto posts to Omniplex: the body, the auth header and the status mapping.
const assert = require('assert');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
process.env.OMNIPLEX_TOKEN = 'omni_check_token';
const { postStats, statsOf, listStatus } = require('../src/jobs/omniplexStatsJob');

const guilds = new Map([['1', { memberCount: 120 }], ['2', { memberCount: 30 }], ['3', {}]]);
const client = { guilds: { cache: guilds }, ws: { shards: new Map([[0, {}]]) }, shard: null };

assert.deepStrictEqual(statsOf(client, 'online'), { servers: 3, shards: 1, users: 150, shard_list: [0], status: 'online' });
assert.strictEqual(listStatus('invisible'), 'offline');
assert.strictEqual(listStatus('dnd'), 'dnd');

(async () => {
  let sent = null;
  const ok = await postStats(client, 'idle', async (url, init) => { sent = { url, init }; return { ok: true }; });
  assert.strictEqual(ok, true);
  assert.strictEqual(sent.url, 'https://api.omniplex.gg/bots/stats');
  assert.strictEqual(sent.init.method, 'POST');
  assert.strictEqual(sent.init.headers.Authorization, 'Bot omni_check_token');
  assert.strictEqual(JSON.parse(sent.init.body).status, 'idle');

  await assert.rejects(
    postStats(client, 'online', async () => ({ ok: false, status: 401, text: async () => 'Authentication is required.' })),
    /401/,
  );
  console.log('omniplex stats ok');
})().catch((err) => { console.error(err); process.exit(1); });
