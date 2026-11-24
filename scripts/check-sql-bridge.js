// Checks the SQL bridge (src/db/sqlBridge.ts), the role of an instance (src/utils/instanceRole.ts) and how the bot picks its pool: the signature, replays and old requests, what travels (dates, buffers,
// errors with their code), a lost answer that is asked again, a transaction kept on the other side, and the jobs a worker leaves to the primary.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const bridge = require('../src/db/sqlBridge');
const role = require('../src/utils/instanceRole');

const SECRET = 'a'.repeat(40);

// A pool that answers like pg does: rows with Date, Buffer, jsonb objects and bigint strings; an error with a code.
function fakePool() {
  const state = { queries: [], clients: 0, released: 0, rolledBack: 0, inTransaction: false };
  const answer = async (text, values) => {
    state.queries.push({ text, values });
    if (text === 'ROLLBACK') { state.rolledBack += 1; return { rows: [], rowCount: null, command: 'ROLLBACK', fields: [] }; }
    if (text.startsWith('BEGIN')) { state.inTransaction = true; return { rows: [], rowCount: null, command: 'BEGIN', fields: [] }; }
    if (text.includes('duplicate')) throw Object.assign(new Error('duplicate key value violates unique constraint "t_pkey"'), { code: '23505', constraint: 't_pkey', table: 't', detail: 'Key (id)=(1) already exists.' });
    if (text.includes('typed')) return { rows: [{ at: new Date('2026-11-24T10:00:00.000Z'), blob: Buffer.from([1, 2, 3, 255]), doc: { a: [1, { $weird: true }], b: null }, big: '9007199254740993', n: 7 }], rowCount: 1, command: 'SELECT', fields: [{ name: 'at', dataTypeID: 1184 }] };
    if (text.includes('echo')) return { rows: [{ values }], rowCount: 1, command: 'SELECT', fields: [] };
    return { rows: [{ ok: 1 }], rowCount: 1, command: 'SELECT', fields: [] };
  };
  return {
    state,
    query: (text, values) => answer(text, values),
    connect: async () => { state.clients += 1; return { query: (text, values) => answer(text, values), release: () => { state.released += 1; } }; },
  };
}

(async () => {
  // ---- What travels ---------------------------------------------------------------------------------------------------------------------
  const sample = { at: new Date('2026-01-02T03:04:05.678Z'), blob: Buffer.from('hello'), nested: [{ d: new Date(0) }], weird: { $d: 'not a date', $o: 1 }, none: undefined, nul: null, text: 'x', n: 1.5, flag: false, nan: NaN, inf: -Infinity };
  const back = bridge.decode(JSON.parse(JSON.stringify(bridge.encode(sample))));
  assert.ok(back.at instanceof Date && back.at.getTime() === sample.at.getTime());
  assert.ok(Buffer.isBuffer(back.blob) && back.blob.toString() === 'hello');
  assert.ok(back.nested[0].d instanceof Date && back.nested[0].d.getTime() === 0);
  assert.deepEqual(back.weird, { $d: 'not a date', $o: 1 }, 'an object that already uses keys with $ comes back the same');
  assert.equal('none' in back && back.none, undefined);
  assert.equal(back.nul, null);
  assert.ok(Number.isNaN(back.nan) && back.inf === -Infinity);
  assert.equal(bridge.encode(10n), '10');
  assert.ok(Number.isNaN(bridge.decode(bridge.encode(new Date('x'))).getTime()), 'an invalid date stays invalid');

  // ---- The secret and the signature ----------------------------------------------------------------------------------------------
  assert.equal(bridge.validSecret('short'), false);
  assert.equal(bridge.validSecret(SECRET), true);
  assert.throws(() => bridge.createBridgeServer({ pool: fakePool(), secret: 'short' }), /at least 32/);
  assert.throws(() => bridge.createBridgePool({ url: 'https://x', secret: 'short' }), /at least 32/);
  assert.throws(() => bridge.createBridgePool({ url: 'ftp://x', secret: SECRET }), /http/);

  let clock = 1_800_000_000_000;
  const now = () => clock;
  const pool = fakePool();
  const server = bridge.createBridgeServer({ pool, secret: SECRET, now });
  const signed = (payload, { id = 'ab'.repeat(8), time = clock, secret = SECRET, tamper = false } = {}) => {
    const body = JSON.stringify(payload);
    return { headers: { 'x-bridge-time': String(time), 'x-bridge-id': id, 'x-bridge-signature': bridge.sign(secret, time, id, tamper ? body + ' ' : body) }, body };
  };
  const ask = (request) => server.handle(request);

  assert.equal((await ask({ headers: {}, body: '{}' })).status, 401, 'no headers');
  assert.equal((await ask(signed({ op: 'query', text: 'select 1' }, { secret: 'b'.repeat(40) }))).status, 401, 'wrong secret');
  assert.equal((await ask(signed({ op: 'query', text: 'select 1' }, { tamper: true }))).status, 401, 'body changed after signing');
  assert.equal((await ask(signed({ op: 'query', text: 'select 1' }, { time: clock - 120_000 }))).status, 401, 'an old request');
  assert.equal((await ask(signed({ op: 'query', text: 'select 1' }, { time: clock + 120_000 }))).status, 401, 'a request from the future');
  assert.equal((await ask(signed({ op: 'query', text: 'select 1' }, { id: 'zz' }))).status, 401, 'a bad id');
  assert.equal(pool.state.queries.length, 0, 'nothing refused ran');
  const big = { headers: signed({ op: 'query', text: 'x' }).headers, body: 'x'.repeat(bridge.MAX_BODY_BYTES + 1) };
  assert.equal((await ask(big)).status, 413);

  const first = await ask(signed({ op: 'query', text: 'select 1' }, { id: 'cd'.repeat(8) }));
  assert.equal(first.status, 200); assert.equal(first.json.ok, true);
  const again = await ask(signed({ op: 'query', text: 'select 1' }, { id: 'cd'.repeat(8) }));
  assert.deepEqual(again.json, first.json, 'the same id gets the answer it already had');
  assert.equal(pool.state.queries.length, 1, 'and does not run twice');
  assert.equal((await ask(signed({ op: 'nope' }, { id: 'ef'.repeat(8) }))).status, 400);
  assert.equal((await ask(signed({ op: 'query', text: '' }, { id: '01'.repeat(8) }))).status, 400);

  // ---- Client and server together, through a fetch that calls the server -----------------------------------------------------------
  const wire = (srv, { failFirst = 0, lose = 0 } = {}) => {
    const stats = { calls: 0 };
    const fetcher = async (url, init) => {
      stats.calls += 1;
      if (stats.calls <= failFirst) throw new Error('network down');
      const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const answer = await srv.handle({ headers, body: init.body });
      if (stats.calls <= failFirst + lose) throw new Error('the answer got lost'); // it ran, but the client never saw it
      return { status: answer.status, json: async () => answer.json };
    };
    return { fetcher, stats };
  };
  const pool2 = fakePool();
  const server2 = bridge.createBridgeServer({ pool: pool2, secret: SECRET });
  const { fetcher, stats } = wire(server2);
  const remote = bridge.createBridgePool({ url: 'https://bot.example/api/bridge/db', secret: SECRET, fetcher, wait: async () => {} });

  const typed = await remote.query('select typed');
  assert.ok(typed.rows[0].at instanceof Date && typed.rows[0].at.toISOString() === '2026-11-24T10:00:00.000Z', 'a date comes back as a Date');
  assert.deepEqual([...typed.rows[0].blob], [1, 2, 3, 255], 'bytes come back as bytes');
  assert.deepEqual(typed.rows[0].doc, { a: [1, { $weird: true }], b: null });
  assert.equal(typed.rows[0].big, '9007199254740993'); assert.equal(typed.rowCount, 1); assert.equal(typed.command, 'SELECT');

  const echoed = await remote.query('select echo', [new Date('2026-05-05T05:05:05.000Z'), Buffer.from('b'), { k: 1 }, null, undefined, 'x']);
  const sent = pool2.state.queries.at(-1).values;
  assert.ok(sent[0] instanceof Date && sent[0].toISOString() === '2026-05-05T05:05:05.000Z' && Buffer.isBuffer(sent[1]) && sent[3] === null && sent[4] === undefined, 'the values reach the pool as they were');
  assert.equal(echoed.rows.length, 1);
  assert.deepEqual((await remote.query({ text: 'select echo', values: [1] })).rows.length, 1, 'the object form works too');

  // A database error keeps its code, which Petto reads (23505 is a duplicate).
  await assert.rejects(remote.query('insert duplicate'), (error) => error.code === '23505' && error.constraint === 't_pkey' && error.table === 't' && /duplicate key/.test(error.message));

  // A lost answer: the client asks again with the same id and the query ran once.
  const lost = fakePool();
  const serverL = bridge.createBridgeServer({ pool: lost, secret: SECRET });
  const w = wire(serverL, { lose: 1 });
  const remoteL = bridge.createBridgePool({ url: 'https://x', secret: SECRET, fetcher: w.fetcher, wait: async () => {} });
  await remoteL.query('insert once');
  assert.equal(w.stats.calls, 2, 'it asked twice'); assert.equal(lost.state.queries.length, 1, 'but it ran once');
  // The network down for a while: it tries again, and gives up after the retries.
  const w2 = wire(serverL, { failFirst: 2 });
  await bridge.createBridgePool({ url: 'https://x', secret: SECRET, fetcher: w2.fetcher, wait: async () => {} }).query('select 1');
  assert.equal(w2.stats.calls, 3);
  const w3 = wire(serverL, { failFirst: 10 });
  await assert.rejects(bridge.createBridgePool({ url: 'https://x', secret: SECRET, fetcher: w3.fetcher, wait: async () => {}, retries: 2 }).query('select 1'), /network down/);
  assert.equal(w3.stats.calls, 3);

  // A server that is too busy says so and the client waits and tries again.
  const busyPool = { query: () => new Promise(() => {}), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };
  const busy = bridge.createBridgeServer({ pool: busyPool, secret: SECRET, maxRunning: 1, now });
  const hold = busy.handle(signed({ op: 'query', text: 'select hang' }, { id: '11'.repeat(8) }));
  const refused = await busy.handle(signed({ op: 'query', text: 'select 2' }, { id: '22'.repeat(8) }));
  assert.equal(refused.status, 429); void hold;

  // ---- A transaction kept on the other side ---------------------------------------------------------------------------------------
  const tx = await remote.connect();
  await tx.query('BEGIN');
  await tx.query('select 1');
  assert.equal(server2.openSessions(), 1);
  await tx.release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server2.openSessions(), 0); assert.ok(pool2.state.rolledBack >= 1, 'what was left open is rolled back before the connection goes back');
  assert.equal(pool2.state.released, 1);
  await assert.rejects(tx.query('select 1'), /released/);

  // A transaction nobody closes is rolled back after the time limit, and its session is gone.
  clock = 1_900_000_000_000;
  const pool3 = fakePool();
  const server3 = bridge.createBridgeServer({ pool: pool3, secret: SECRET, now, sessionTtlMs: 30_000 });
  const remote3 = bridge.createBridgePool({ url: 'https://x', secret: SECRET, fetcher: wire(server3).fetcher, wait: async () => {}, now });
  const stale = await remote3.connect();
  await stale.query('BEGIN');
  clock += 31_000;
  await remote3.query('select 1'); // any request makes the server look at the old sessions
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server3.openSessions(), 0); assert.equal(pool3.state.released, 1); assert.equal(pool3.state.rolledBack, 1);
  await assert.rejects(stale.query('select 1'), /session expired/);
  // Only a few transactions at once.
  const server4 = bridge.createBridgeServer({ pool: fakePool(), secret: SECRET, now, maxSessions: 2 });
  const remote4 = bridge.createBridgePool({ url: 'https://x', secret: SECRET, fetcher: wire(server4).fetcher, wait: async () => {}, retries: 0, now });
  await remote4.connect(); await remote4.connect();
  await assert.rejects(remote4.connect(), /too many sessions|bridge answered 429/);
  server4.close(); assert.equal(server4.openSessions(), 0);

  // ---- The role of an instance ----------------------------------------------------------------------------------------------------
  assert.equal(role.roleOf({}), 'primary'); assert.equal(role.roleOf({ PETTO_ROLE: 'Worker' }), 'worker'); assert.equal(role.roleOf({ PETTO_ROLE: 'junk' }), 'primary');
  assert.equal(role.workerJobsOf({}), 'essential'); assert.equal(role.workerJobsOf({ PETTO_WORKER_JOBS: 'GUILD' }), 'guild'); assert.equal(role.workerJobsOf({ PETTO_WORKER_JOBS: 'x' }), 'essential');
  const primary = {}; const worker = { PETTO_ROLE: 'worker' }; const workerGuild = { PETTO_ROLE: 'worker', PETTO_WORKER_JOBS: 'guild' }; const workerAll = { PETTO_ROLE: 'worker', PETTO_WORKER_JOBS: 'all' };
  for (const name of ['startStreakJob', 'startGuildPurgeJob', 'startActivityStatsJob']) assert.equal(role.shouldRun(name, primary), true, `the primary runs ${name}`);
  assert.equal(role.shouldRun('startActivityStatsJob', worker), true, 'a worker keeps what it buffers');
  assert.equal(role.shouldRun('startVoiceXpJob', worker), true);
  assert.equal(role.shouldRun('startStreakJob', worker), false);
  assert.equal(role.shouldRun('startGuildPurgeJob', worker), false);
  assert.equal(role.shouldRun('startStreakJob', workerGuild), true);
  assert.equal(role.shouldRun('startGuildPurgeJob', workerGuild), false, 'what must run once never runs on a worker');
  assert.equal(role.shouldRun('startGuildPurgeJob', workerAll), true);
  for (const name of role.ESSENTIAL_JOBS) assert.equal(role.ONE_PER_BOT.has(name), false, `${name} is not both essential and one per bot`);
  // Every job that index.js starts is known by name, so none is renamed by mistake.
  const fs = require('node:fs');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const started = [...index.matchAll(/runsJob\('(start\w+)'\)/g)].map((match) => match[1]);
  assert.ok(started.length > 30);
  for (const name of [...role.ESSENTIAL_JOBS, ...role.ONE_PER_BOT]) assert.ok(started.includes(name), `${name} is started by index.js`);

  // ---- How the bot picks its pool (in a child process, because the settings are read once) ---------------------------------------
  const probe = (env, code) => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, DISCLOUD_DATABASE_URL: '', PETTO_DB_BRIDGE_URL: '', PETTO_BRIDGE_SECRET: '', PETTO_ROLE: '', DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: '1', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(probe({ PETTO_DB_BRIDGE_URL: 'https://bot.example/api/bridge/db', PETTO_BRIDGE_SECRET: SECRET, PETTO_ROLE: 'worker' }, "const p=require('./src/db/postgres').getPrimaryPool();console.log(Boolean(p.isBridge), require('./src/config').instanceRole)"), 'true worker');
  assert.equal(probe({ DISCLOUD_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/d' }, "const p=require('./src/db/postgres').getPrimaryPool();console.log(Boolean(p.isBridge), require('./src/config').instanceRole);process.exit(0)"), 'false primary');
  assert.throws(() => probe({}, "require('./src/config')"), /DISCLOUD_DATABASE_URL is required/);
  assert.throws(() => probe({ PETTO_DB_BRIDGE_URL: 'https://x/api/bridge/db' }, "require('./src/config')"), /DISCLOUD_DATABASE_URL is required/, 'the bridge needs its secret too');

  // The read-only copy: with its address the statistics read from another pool, without it from the main one.
  assert.equal(probe({ DISCLOUD_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/d' }, "const p=require('./src/db/postgres');console.log(p.getReadPool()===p.getPrimaryPool());process.exit(0)"), 'true');
  assert.equal(probe({ DISCLOUD_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/d', PETTO_READ_DATABASE_URL: 'postgres://u:p@127.0.0.1:2/r' }, "const p=require('./src/db/postgres');console.log(p.getReadPool()!==p.getPrimaryPool());process.exit(0)"), 'true');

  console.log('sql bridge ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
