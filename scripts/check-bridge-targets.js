// The databases a worker reaches through the SQL bridge (src/db/bridgeTargets.js): asked to the primary at start, and asked again by itself when the primary did not answer
// (it was restarting), so the Vault does not stay "not configured" until the next start of the worker. A fake bridge: nothing real.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
delete process.env.DISCLOUD_DATABASE_URL;
process.env.PETTO_ROLE = 'worker';
process.env.PETTO_DB_BRIDGE_URL = 'https://primary.example/api/bridge/db';
process.env.PETTO_BRIDGE_SECRET = 'secret';
const root = path.join(__dirname, '..');
const resolve = (file) => require.resolve(path.join(root, file));
let answers = [new Error('primary is restarting'), new Error('still restarting'), ['main', 'vault', 'code']];
let asked = 0;
const vaultQueries = [];
require.cache[resolve('src/db/postgres.js')] = { id: resolve('src/db/postgres.js'), filename: resolve('src/db/postgres.js'), loaded: true, exports: {
  getPrimaryPool: () => ({ info: async () => { asked += 1; const next = answers.shift(); if (next instanceof Error) throw next; return next; } }),
  makeBridgePool: (target) => ({ target, query: async (sql) => { vaultQueries.push(String(sql)); return { rows: [], rowCount: 0 }; } }),
} };
const lines = [];
const logger = require('../src/utils/logger');
logger.warn = (text) => lines.push(['warn', String(text)]); logger.info = (text) => lines.push(['info', String(text)]);

const targets = require('../src/db/bridgeTargets');
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

(async () => {
  assert.equal(targets.active(), true, 'a worker with a bridge goes through the bridge');
  assert.deepEqual(await targets.load({ retryMs: 20 }), [], 'the first answer failed: nothing is known yet');
  assert.equal(targets.has('vault'), false, 'the Vault is off while the primary has not answered');
  await wait(120);
  assert.equal(targets.has('vault'), true, 'asked again by itself, the Vault is on without restarting the worker');
  assert.equal(targets.has('code'), true); assert.equal(targets.has('data2'), false, 'a database the primary does not have stays off');
  assert.equal(asked, 3, 'two failures and one answer');
  await wait(60);
  assert.equal(asked, 3, 'it stops asking once it was answered');
  assert.equal(lines.filter(([level]) => level === 'warn').length, 1, 'the failure is one warning, not one every minute');
  assert.ok(lines.some(([, text]) => /answered after failing before/.test(text)));
  // The backups of a worker go through that bridge: every function of the Vault uses the pool it gives, not a connection of its own (before, listing the due schedules failed with
  // "Cannot read properties of undefined (reading 'query')" on a worker).
  const vault = require('../src/db/vault');
  assert.equal(vault.isConfigured(), true, 'with the Vault reached through the bridge, backups are configured');
  assert.deepEqual(await vault.listDueSchedules(), [], 'the due schedules are read through the bridge');
  assert.ok(vaultQueries.some((sql) => /petto_vault_schedules where next_run_at <= now\(\)/.test(sql)), 'and the query went through the bridge pool');
  await vault.advanceSchedule('1', 24);
  assert.ok(vaultQueries.some((sql) => /update petto_vault_schedules/.test(sql)));
  console.log('bridge targets: ok');
})().catch((error) => { console.error(error); process.exit(1); });
