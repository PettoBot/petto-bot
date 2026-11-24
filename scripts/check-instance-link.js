// Checks the link between the primary and a worker (src/utils/instanceLink.ts, linkRuntime.ts): which shard a server lives on, the signed hello, a real WebSocket between a hub and a client (a request sent through,
// an event each way, a wrong secret, a worker that does not answer, a worker that goes away, a reconnect), the door of the primary for the routes with a `:guildId`, the worker's own copy of the routes, and
// what a job of a split instance can read from the database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { WebSocketServer } = require('ws');
const link = require('../src/utils/instanceLink');
const runtime = require('../src/utils/linkRuntime');
const role = require('../src/utils/instanceRole');

const SECRET = 'k'.repeat(40);
// Two servers: one on shard 0 and one on shard 1 of 2 (the shard is `(id >> 22) % 2`).
const onShard = (shard, count) => { for (let n = 0n; ; n += 1n) { const id = String((1414452131850879080n + n * 4194304n)); if (link.shardOfGuild(id, count) === shard) return id; } };
const GUILD0 = onShard(0, 2); const GUILD1 = onShard(1, 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await sleep(10); } return false; };

(async () => {
  // ---- The shard of a server ----------------------------------------------------------------------------------------------------------
  assert.equal(link.shardOfGuild('1414452131850879080', 2), Number((1414452131850879080n >> 22n) % 2n));
  assert.equal(link.shardOfGuild(GUILD0, 2), 0); assert.equal(link.shardOfGuild(GUILD1, 2), 1);
  assert.equal(link.shardOfGuild(GUILD1, 1), 0, 'with one shard everything is shard 0');
  assert.equal(link.shardOfGuild('abc', 2), -1); assert.equal(link.shardOfGuild('123', 2), -1); assert.equal(link.shardOfGuild(GUILD0, 0), -1); assert.equal(link.shardOfGuild(null, 2), -1);
  assert.deepEqual(link.parseShards('0, 1,1'), [0, 1]); assert.equal(link.parseShards('auto'), null); assert.equal(link.parseShards(''), null); assert.equal(link.parseShards('x'), null);
  const mine = { shards: [0], count: 2 };
  assert.equal(link.owns(mine, GUILD0), true); assert.equal(link.owns(mine, GUILD1), false);
  assert.equal(link.owns(null, GUILD1), true, 'without a split every server is ours');
  assert.equal(link.owns({ shards: [], count: 2 }, GUILD1), true); assert.equal(link.owns(mine, 'not-a-guild'), true, 'what is not a server is never refused');
  assert.deepEqual(runtime.ownership({ DISCORD_SHARDS: '1', DISCORD_SHARD_COUNT: '2' }), { shards: [1], count: 2 });
  assert.equal(runtime.ownership({ DISCORD_SHARDS: 'auto', DISCORD_SHARD_COUNT: '2' }), null); assert.equal(runtime.ownership({ DISCORD_SHARDS: '0' }), null);
  assert.equal(runtime.linkUrl('https://bot.example/api/bridge/db'), 'wss://bot.example/api/bridge/link');
  assert.equal(runtime.linkUrl('http://127.0.0.1:8787/api/bridge/db/'), 'ws://127.0.0.1:8787/api/bridge/link');
  assert.equal(role.isGlobalJob('guildPurgeJob'), true); assert.equal(role.isGlobalJob('guildPurgeJob@60s'), true); assert.equal(role.isGlobalJob('reminderJob'), false); assert.equal(role.isGlobalJob(undefined), false);

  // ---- The hello ----------------------------------------------------------------------------------------------------------------------
  const hello = { worker: 'vps-1', shards: [1], count: 2 };
  const headers = link.helloHeaders(SECRET, hello, 1_000_000);
  assert.deepEqual(link.verifyHello(SECRET, headers, 1_000_000), hello);
  assert.equal(link.verifyHello('z'.repeat(40), headers, 1_000_000), null, 'another secret');
  assert.equal(link.verifyHello(SECRET, headers, 1_000_000 + 120_000), null, 'an old hello');
  assert.equal(link.verifyHello(SECRET, { ...headers, 'x-bridge-hello': Buffer.from(JSON.stringify({ ...hello, shards: [0] })).toString('base64') }, 1_000_000), null, 'a hello that was changed');
  assert.equal(link.verifyHello(SECRET, {}, 1_000_000), null);
  const bad = link.helloHeaders(SECRET, { worker: 'bad name!', shards: [1], count: 2 }, 1_000_000);
  assert.equal(link.verifyHello(SECRET, bad, 1_000_000), null, 'a name that is not a name');

  // ---- A real hub and a real client over a WebSocket on localhost ----------------------------------------------------------------------------------------
  const events = [];
  const hub = runtime.startHub(SECRET, (event) => events.push(event));
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== link.LINK_PATH) { socket.destroy(); return; }
    if (!link.verifyHello(SECRET, req.headers)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, (ws) => { if (!hub.accept(ws, req.headers)) ws.close(1008, 'refused'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `ws://127.0.0.1:${port}${link.LINK_PATH}`;

  const received = []; const clientEvents = [];
  const handle = async (request) => {
    received.push(request);
    if (request.path.includes('slow')) { await sleep(2000); }
    if (request.path.includes('boom')) throw new Error('route failed');
    return { status: 201, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' }, body: Buffer.from(JSON.stringify({ ok: true, echo: request.body ? request.body.toString() : null, method: request.method })) };
  };
  const client = require('../src/utils/instanceLink').createLinkClient({ url, secret: SECRET, worker: 'vps-1', shards: [1], count: 2, handle, onEvent: (event) => clientEvents.push(event), backoffMs: [50, 100] });
  client.start();
  assert.ok(await until(() => client.isConnected() && hub.workersConnected().length === 1), 'the worker connected');
  assert.deepEqual(hub.workersConnected(), [{ worker: 'vps-1', shards: [1], count: 2 }]);
  assert.equal(hub.workerFor(GUILD1), 'vps-1'); assert.equal(hub.workerFor(GUILD0), null, 'the other shard is the primary\'s'); assert.equal(hub.workerFor('nope'), null);

  const answer = await hub.forward('vps-1', { method: 'POST', path: `/api/dashboard/guild/${GUILD1}/counters/save?x=1`, headers: { 'x-petto-dashboard-key': 'secret', 'content-type': 'application/json' }, body: Buffer.from('{"a":1}') });
  assert.equal(answer.status, 201); assert.equal(JSON.parse(answer.body).echo, '{"a":1}'); assert.equal(answer.headers['content-type'], 'application/json');
  assert.equal(received[0].path, `/api/dashboard/guild/${GUILD1}/counters/save?x=1`); assert.equal(received[0].headers['x-petto-dashboard-key'], 'secret'); assert.equal(received[0].method, 'POST');
  const failed = await hub.forward('vps-1', { method: 'GET', path: '/api/boom', headers: {} });
  assert.equal(failed.status, 502, 'a route that throws is a 502, not a hang');
  await assert.rejects(hub.forward('nobody', { method: 'GET', path: '/', headers: {} }), /not connected/);

  // Events both ways.
  assert.equal(hub.broadcast('invalidate', '{"table":"x"}'), 1);
  assert.ok(await until(() => clientEvents.length === 1)); assert.deepEqual(clientEvents[0], { channel: 'invalidate', message: '{"table":"x"}' });
  assert.equal(hub.broadcast('invalidate', 'm', 'vps-1'), 0, 'not sent back to the one that said it');
  assert.equal(client.sendEvent('sticky', '55'), true);
  assert.ok(await until(() => events.length === 1)); assert.deepEqual(events[0], { channel: 'sticky', message: '55', worker: 'vps-1' });
  client.sendEvent('bad channel!', 'x'); await sleep(50); assert.equal(events.length, 1, 'a channel that is not a channel is dropped');

  // A worker that does not answer in time.
  const impatient = link.createLinkHub({ secret: SECRET, requestTimeoutMs: 100 });
  const sockets2 = new WebSocketServer({ noServer: true });
  const server2 = http.createServer(); server2.on('upgrade', (req, socket, head) => { if (!link.verifyHello(SECRET, req.headers)) { socket.destroy(); return; } sockets2.handleUpgrade(req, socket, head, (ws) => { if (!impatient.accept(ws, req.headers)) ws.close(); }); });
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const slowClient = link.createLinkClient({ url: `ws://127.0.0.1:${server2.address().port}${link.LINK_PATH}`, secret: SECRET, worker: 'slow-1', shards: [1], count: 2, handle, backoffMs: [50] });
  slowClient.start();
  assert.ok(await until(() => impatient.workersConnected().length === 1));
  await assert.rejects(impatient.forward('slow-1', { method: 'GET', path: '/api/slow', headers: {} }), /in time/);
  slowClient.stop(); impatient.close();

  // A wrong secret never connects.
  const intruder = link.createLinkClient({ url, secret: 'x'.repeat(40), worker: 'intruder', shards: [0], count: 2, handle, backoffMs: [50] });
  intruder.start(); await sleep(300);
  assert.equal(intruder.isConnected(), false); assert.equal(hub.workersConnected().length, 1, 'only the real worker is there'); intruder.stop();
  // The same hello twice is a replay.
  const replay = require('ws'); const replayHeaders = link.helloHeaders(SECRET, { worker: 'replayed', shards: [0], count: 2 });
  const accepted = []; for (let i = 0; i < 2; i += 1) { const ws = new replay(url, { headers: replayHeaders }); await new Promise((resolve) => { ws.on('open', () => { accepted.push(true); resolve(); }); ws.on('error', () => { accepted.push(false); resolve(); }); ws.on('unexpected-response', () => { accepted.push(false); resolve(); }); }); if (i === 1) ws.terminate(); }
  assert.equal(accepted[0], true); await sleep(100);

  // A worker that goes away: its waiting requests fail at once, and it comes back by itself.
  const waiting = hub.forward('vps-1', { method: 'GET', path: '/api/slow', headers: {} });
  await sleep(50);
  const lost = assert.rejects(waiting, /disconnected|connected again/);
  for (const ws of sockets.clients) if (ws !== undefined) ws.terminate();
  await lost;
  assert.ok(await until(() => client.isConnected() && hub.workersConnected().some((w) => w.worker === 'vps-1')), 'the worker reconnected by itself');

  // ---- The door of the primary for a route with :guildId --------------------------------------------------------------------------------
  const res = () => { const out = { code: 200, headers: {}, body: null, headersSent: false }; out.status = (code) => { out.code = code; return out; }; out.set = (name, value) => { out.headers[name] = value; return out; }; out.send = (body) => { out.body = body; out.headersSent = true; return out; }; out.json = (body) => { out.body = body; out.headersSent = true; return out; }; return out; };
  const req = (extra = {}) => ({ method: 'POST', originalUrl: `/api/dashboard/guild/${GUILD1}/x`, headers: { 'x-petto-dashboard-key': 'k', host: 'primary', 'content-length': '7' }, body: { a: 1 }, is: (type) => type === 'json', on() {}, get(name) { return this.headers[name.toLowerCase()]; }, ...extra });
  const out1 = res();
  assert.equal(await link.routeGuildRequest(hub, mine, req(), out1, GUILD1), true, 'a server of the worker goes through the link');
  assert.equal(out1.code, 201); assert.equal(JSON.parse(out1.body).echo, '{"a":1}'); assert.equal(out1.headers['content-type'], 'application/json');
  assert.equal(received.at(-1).headers[link.FORWARDED_HEADER], '1'); assert.equal(received.at(-1).headers.host, undefined, 'hop headers do not travel');
  const out2 = res();
  assert.equal(await link.routeGuildRequest(hub, mine, req({ originalUrl: `/api/dashboard/guild/${GUILD0}/x` }), out2, GUILD0), false, 'a server of the primary stays here');
  const out3 = res();
  assert.equal(await link.routeGuildRequest(hub, mine, req({ headers: { [link.FORWARDED_HEADER]: '1' }, get(name) { return this.headers[name.toLowerCase()]; } }), out3, GUILD1), false, 'a request that came through the link is never sent again');
  const lonely = link.createLinkHub({ secret: SECRET });
  const out4 = res();
  assert.equal(await link.routeGuildRequest(lonely, mine, req(), out4, GUILD1), true); assert.equal(out4.code, 503); assert.equal(out4.body.error, 'shard_unavailable', 'a server whose shard nobody holds');
  assert.equal(await link.routeGuildRequest(lonely, null, req(), res(), GUILD1), false, 'without a split everything is ours');
  assert.equal(await link.routeGuildRequest(lonely, mine, req({ originalUrl: '/x' }), res(), 'not-a-guild'), false);
  const raw = res(); // a body that is not JSON is read from the stream
  const streamed = req({ is: () => false, body: undefined, on(event, listener) { if (event === 'data') setImmediate(() => listener(Buffer.from('file-bytes'))); if (event === 'end') setImmediate(() => setImmediate(listener)); } });
  await link.routeGuildRequest(hub, mine, streamed, raw, GUILD1);
  assert.equal(JSON.parse(raw.body).echo, 'file-bytes');
  const down = res(); const slowHub = { workerFor: () => 'w', forward: async () => { throw new Error('the worker did not answer in time'); } };
  assert.equal(await link.routeGuildRequest(slowHub, mine, req(), down, GUILD1), true); assert.equal(down.code, 503); assert.equal(down.body.error, 'shard_timeout', 'a worker that does not answer');

  // ---- The worker's own copy of the routes -------------------------------------------------------------------------------------------
  const local = http.createServer((request, response) => { const parts = []; request.on('data', (c) => parts.push(c)); request.on('end', () => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ url: request.url, forwarded: request.headers[link.FORWARDED_HEADER], body: Buffer.concat(parts).toString(), key: request.headers['x-petto-dashboard-key'] })); }); });
  await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
  const viaLocal = await link.localHandler(local.address().port)({ method: 'POST', path: '/api/dashboard/guild/1/x?y=2', headers: { 'x-petto-dashboard-key': 'k' }, body: Buffer.from('payload') });
  assert.equal(viaLocal.status, 200); assert.deepEqual(JSON.parse(viaLocal.body), { url: '/api/dashboard/guild/1/x?y=2', forwarded: '1', body: 'payload', key: 'k' });
  local.close();

  // ---- A job of a split instance reads only its own servers (in a child process: the shards are read once) ------------------------------------
  const child = (env, code) => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: '1', DISCLOUD_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/d', DISCORD_SHARDS: '', DISCORD_SHARD_COUNT: '', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const probe = `
    const perf = require('./src/utils/perf'); const pg = require('./src/db/postgres');
    const sent = []; const pool = { query: async (t, v) => { sent.push(t); return { command: 'SELECT', rows: [{ guild_id: '${GUILD0}' }, { guild_id: '${GUILD1}' }, { guild_id: 'global' }], rowCount: 3 }; } };
    const client = pg.createPostgresClient(pool);
    const inJob = (name, fn) => perf.runWith(perf.newContext({ kind: 'job', name }), fn);
    (async () => {
      const out = {};
      await inJob('reminderJob', async () => { await client.from('reminders').select('*'); await client.from('guilds').select('*'); });
      out.jobSql = sent.slice(0, 2).map((t) => /CASE WHEN "guild_id"/.test(t));
      sent.length = 0;
      await inJob('guildPurgeJob', async () => { await client.from('reminders').select('*'); });
      await perf.runWith(perf.newContext({ kind: 'event', name: 'x' }), async () => { await client.from('reminders').select('*'); });
      await inJob('reminderJob', async () => { await client.from('ceramos_wallets').select('*'); }); // a table without servers
      out.untouched = sent.map((t) => /CASE WHEN/.test(t));
      const values = []; out.claim = [await inJob('codeScheduleJob', async () => pg.ownedShardsSql('guild_id', values)), values.length];
      out.claimGlobal = await inJob('guildPurgeJob', async () => pg.ownedShardsSql('guild_id', []));
      console.log(JSON.stringify(out)); process.exit(0);
    })();`;
  const split = JSON.parse(child({ DISCORD_SHARDS: '0', DISCORD_SHARD_COUNT: '2' }, probe));
  assert.deepEqual(split.jobSql, [true, true], 'a job read of a table with servers is limited to the shards of this instance');
  assert.deepEqual(split.untouched, [false, false, false], 'a global job, an event and a table without servers read everything');
  assert.match(split.claim[0], /CASE WHEN guild_id::text/); assert.equal(split.claim[1], 1); assert.equal(split.claimGlobal, '');
  const single = JSON.parse(child({}, probe));
  assert.deepEqual(single.jobSql, [false, false], 'a single instance reads everything, as always');
  assert.equal(single.claim[0], '');
  // Raw SQL read by a job: the rows of other shards are dropped from the answer, the rows without a server are kept, and a claim (for update) is left alone.
  const raw2 = child({ DISCORD_SHARDS: '0', DISCORD_SHARD_COUNT: '2' }, `
    const perf = require('./src/utils/perf'); const pg = require('./src/db/postgres');
    const rows = [{ guild_id: '${GUILD0}' }, { guild_id: '${GUILD1}' }, { guild_id: 'global' }];
    const fake = { query: async () => ({ command: 'SELECT', rows, rowCount: 3 }), connect: async () => ({}) };
    (async () => {
      const wrapped = require('./src/db/postgres').__wrapForCheck(fake);
      const run = (name, text) => perf.runWith(perf.newContext({ kind: 'job', name }), async () => (await wrapped.query(text)).rows.map((r) => r.guild_id));
      console.log(JSON.stringify({ job: await run('reminderJob', 'select guild_id from t'), claim: await run('reminderJob', 'select guild_id from t for update skip locked'), global: await run('guildPurgeJob', 'select guild_id from t') })); process.exit(0);
    })();`);
  const rawResult = JSON.parse(raw2);
  assert.deepEqual(rawResult.job, [GUILD0, 'global']); assert.equal(rawResult.claim.length, 3); assert.equal(rawResult.global.length, 3);

  client.stop(); hub.close(); server.close(); server2.close(); runtime.stopAll();
  console.log('instance link ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
