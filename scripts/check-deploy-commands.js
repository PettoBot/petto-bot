// Registering the slash commands: only when they changed, and a failure never stops the bot from starting.
const assert = require('node:assert/strict');
const path = require('node:path');
const handlerPath = path.resolve(__dirname, '../src/handlers/commandHandler.js');
let current = [{ name: 'ping' }];
require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: { collectCommandData: () => current, collectPrivateGuildCommandData: () => [] } };
const configPath = path.resolve(__dirname, '../src/config.js');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { token: 't', clientId: '1', devGuildId: null } };
const { deployCommands } = require('../src/handlers/deployCommands');

(async () => {
  const store = new Map();
  const settings = { getSetting: async (key) => store.get(key) ?? null, setSetting: async (key, value) => { store.set(key, value); } };
  let puts = 0; let failWith = null;
  const rest = { put: async (_route, { body }) => { puts += 1; if (failWith) throw failWith; return body; }, get: async () => [] };

  await deployCommands({ rest, settings });
  assert.equal(puts, 1, 'the first start registers them');
  await deployCommands({ rest, settings });
  assert.equal(puts, 1, 'the same commands are not registered again');
  current = [{ name: 'ping' }, { name: 'summary' }];
  await deployCommands({ rest, settings });
  assert.equal(puts, 2, 'a change is registered');
  await deployCommands({ rest, settings, force: true });
  assert.equal(puts, 3, 'force registers anyway');

  current = [{ name: 'new' }];
  failWith = Object.assign(new Error('You are being rate limited.'), { status: 429, retryAfter: 120 });
  await deployCommands({ rest, settings });
  assert.equal(puts, 4, 'it tried');
  assert.notEqual(store.get('commands_hash:global'), undefined, 'the old hash is kept');
  await deployCommands({ rest, settings });
  assert.equal(puts, 5, 'a failed registration is tried again on the next start');
  await assert.rejects(() => deployCommands({ rest, settings, strict: true }), /rate limited/, 'the manual script still fails loudly');
  console.log('Checked that the commands are registered only when they change and a failure does not stop the start.');
})();
