// Registering the slash commands: only when they changed, and a failure never stops the bot from starting.
const assert = require('node:assert/strict');
const path = require('node:path');
const handlerPath = path.resolve(__dirname, '../src/handlers/commandHandler.js');
let current = [{ name: 'ping' }];
let privateCommands = [];
require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: { collectCommandData: () => current, collectPrivateGuildCommandData: () => privateCommands } };
const configPath = path.resolve(__dirname, '../src/config.js');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { token: 't', clientId: '1', devGuildId: null } };
const { deployCommands } = require('../src/handlers/deployCommands');

(async () => {
  const store = new Map();
  const settings = { getSetting: async (key) => store.get(key) ?? null, setSetting: async (key, value) => { store.set(key, value); } };
  let puts = 0; let failWith = null; let live = [];
  const rest = { put: async (_route, { body }) => { puts += 1; if (failWith) throw failWith; live = body; return body; }, get: async () => live };

  await deployCommands({ rest, settings });
  assert.equal(puts, 1, 'the first start registers them');
  await deployCommands({ rest, settings });
  assert.equal(puts, 1, 'the same commands are not registered again');
  current = [{ name: 'ping' }, { name: 'summary' }];
  await deployCommands({ rest, settings });
  assert.equal(puts, 2, 'a change is registered');
  await deployCommands({ rest, settings, force: true });
  assert.equal(puts, 3, 'force registers anyway');
  live = [{ name: 'ping' }];
  await deployCommands({ rest, settings });
  assert.equal(puts, 4, 'a matching hash does not skip a registration when Discord has other commands');
  await deployCommands({ rest, settings });
  assert.equal(puts, 4, 'and then nothing is sent again');
  const failingGet = { put: rest.put, get: async () => { throw new Error('down'); } };
  await deployCommands({ rest: failingGet, settings });
  assert.equal(puts, 4, 'when Discord cannot be read, the hash is trusted');
  puts = 3;

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
  const restReport = { put: async (_route, { body }) => { discordHas = body; return body; }, get: async () => discordHas };
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

  // One scope only. A server with private commands gets only those while the commands are global (never a copy of the global ones).
  current = [{ name: 'ping' }, { name: 'yes' }];
  privateCommands = [{ guildId: '1502171756113432607', data: { name: 'guilddebug' } }];
  const scoped = new Map([['global', []], ['1502171756113432607', [{ name: 'yes' }, { name: 'ping' }, { name: 'guilddebug' }]], ['293504726505357312', [{ name: 'yes' }]], ['257181659865153539', []]]);
  const scopeOf = (route) => (route.includes('/guilds/') ? route.split('/guilds/')[1].split('/')[0] : 'global');
  const sent = [];
  const restScoped = {
    get: async (route) => { if (scopeOf(route) === '404') throw Object.assign(new Error('Unknown Guild'), { status: 404 }); return scoped.get(scopeOf(route)) ?? []; },
    put: async (route, { body }) => { sent.push([scopeOf(route), body.map((c) => c.name)]); scoped.set(scopeOf(route), body); return body; },
  };
  const store3 = new Map();
  const settings3 = { getSetting: async (key) => store3.get(key) ?? null, setSetting: async (key, value) => { store3.set(key, value); } };
  store3.set('commands_hash:293504726505357312', 'old-dev-hash');
  await deployCommands({ rest: restScoped, settings: settings3 });
  assert.deepEqual(sent, [['global', ['ping', 'yes']], ['1502171756113432607', ['guilddebug']]], 'global once, and only the private command in its server');
  // The old copies per server are removed once, after the global registration, server by server.
  const { cleanupGuildCommands } = require('../src/handlers/deployCommands');
  sent.length = 0;
  const client = { guilds: { cache: new Map([['293504726505357312', {}], ['257181659865153539', {}], ['1502171756113432607', {}], ['404', {}]]) } };
  const summary = await cleanupGuildCommands(client, { rest: restScoped, settings: settings3, delayMs: 0 });
  assert.deepEqual(sent, [['293504726505357312', []]], 'only the server that had copies is overwritten, and the private server is left alone');
  assert.equal(summary.failed, 0, 'a server Petto left is not a failure');
  assert.equal(store3.get('commands_hash:293504726505357312'), '', 'its old hash is forgotten');
  assert.match(store3.get('commands_cleanup:guild_scoped'), /^done:/, 'the cleanup is remembered');
  sent.length = 0;
  assert.equal(await cleanupGuildCommands(client, { rest: restScoped, settings: settings3, delayMs: 0 }), null, 'and not done again');
  // With test servers the global commands are not touched, and when they exist the log says every command shows twice.
  config.devGuildIds = ['293504726505357312'];
  scoped.set('global', [{ name: 'ping' }]);
  logs.length = 0;
  await deployCommands({ rest: restScoped, settings: settings3 });
  announceDeployReport();
  assert.ok(logs.some(([level, text]) => level === 'warn' && /shows twice/.test(text) && /DISCORD_DEV_GUILD_ID/.test(text)), 'the duplicates are explained');
  assert.equal(store3.get('commands_cleanup:guild_scoped'), '', 'going back to global cleans again');
  assert.equal(await cleanupGuildCommands(client, { rest: restScoped, settings: settings3, delayMs: 0 }), null, 'no cleanup while the commands are per server');
  config.devGuildIds = [];
  privateCommands = [];
  logger.info = realInfo; logger.warn = realWarn;

  console.log('Checked that the commands are registered only when they change and a failure does not stop the start.');
})();
