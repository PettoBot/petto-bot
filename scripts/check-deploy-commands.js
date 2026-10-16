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
  // Several test servers: one registration for each, and a bad id is left out.
  const config = require('../src/config');
  config.devGuildIds = ['293504726505357312', '257181659865153539'];
  const routes = [];
  const restMany = { put: async (route, { body }) => { routes.push(route); return body; }, get: async () => [] };
  current = [{ name: 'multi' }];
  await deployCommands({ rest: restMany, settings, force: true });
  assert.equal(routes.length, 2, 'each test server gets the commands');
  assert.ok(routes[0].includes('293504726505357312') && routes[1].includes('257181659865153539') && routes.every((r) => !r.includes(',')), 'one id in each route');
  config.devGuildIds = [];
  // The report that reaches the log: what was created, what was removed, and why it failed.
  const { announceDeployReport, getDeployReport } = require('../src/handlers/deployCommands');
  const logs = [];
  const logger = require('../src/utils/logger');
  const realInfo = logger.info; const realWarn = logger.warn;
  logger.info = (text) => logs.push(['info', text]); logger.warn = (text) => logs.push(['warn', text]);
  config.devGuildIds = [];
  const store2 = new Map();
  const settings2 = { getSetting: async (key) => store2.get(key) ?? null, setSetting: async (key, value) => { store2.set(key, value); } };
  let discordHas = [{ name: 'ping' }, { name: 'old' }];
  const restReport = { put: async (_route, { body }) => body, get: async () => discordHas };
  current = [{ name: 'ping' }, { name: 'vanity' }, { name: 'guildtag' }];
  await deployCommands({ rest: restReport, settings: settings2 });
  assert.deepEqual(getDeployReport().targets[0].created, ['vanity', 'guildtag'], 'the report names the commands that are new');
  assert.deepEqual(getDeployReport().targets[0].removed, ['old'], 'and the ones that are gone');
  announceDeployReport();
  assert.ok(logs.some(([level, text]) => level === 'info' && /Created: vanity, guildtag/.test(text) && /Removed: old/.test(text)), 'the log says it');
  logs.length = 0;
  await deployCommands({ rest: restReport, settings: settings2 });
  announceDeployReport();
  assert.ok(logs.some(([, text]) => /unchanged/.test(text)), 'a start with nothing new says so');
  logs.length = 0;
  current = [{ name: 'other' }];
  const refusing = { put: async () => { throw Object.assign(new Error('Invalid Form Body'), { status: 400, rawError: { errors: { 0: { description: { _errors: [{ code: 'BASE_TYPE_MAX_LENGTH' }] } } } } }); }, get: async () => [] };
  await deployCommands({ rest: refusing, settings: settings2 });
  announceDeployReport();
  assert.ok(logs.some(([level, text]) => level === 'warn' && /NOT registered/.test(text) && /Invalid Form Body/.test(text) && /BASE_TYPE_MAX_LENGTH/.test(text)), 'a refusal is said with the reason Discord gave');
  logger.info = realInfo; logger.warn = realWarn;

  console.log('Checked that the commands are registered only when they change and a failure does not stop the start.');
})();
