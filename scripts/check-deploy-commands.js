// Registering the slash commands: only when they changed, and a failure never stops the bot from starting.
const assert = require('node:assert/strict');
const path = require('node:path');
const handlerPath = path.resolve(__dirname, '../src/handlers/commandHandler.js');
let current = [{ name: 'ping' }];
let privateCommands = [];
// The second set: the commands that are registered in each server (`guildScoped`).
let second = [];
require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: { collectCommandData: () => current, collectGuildCommandData: () => second, collectPrivateGuildCommandData: () => privateCommands } };
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

  // The second set (`/case`, `/note`...): registered in each server, only where something is missing or changed, never on top of the global ones.
  {
    const { deployGuildCommands, syncGuildCommands } = require('../src/handlers/deployCommands');
    second = [{ name: 'case' }, { name: 'note' }];
    const servers = new Map();
    const calls = [];
    const restServers = {
      get: async (route) => { const id = scopeOf(route); if (id === '403') throw Object.assign(new Error('Missing Access'), { status: 403 }); return servers.get(id) ?? []; },
      put: async (route, { body }) => { const id = scopeOf(route); calls.push(['put', id]); if (id === '403') throw Object.assign(new Error('Missing Access'), { status: 403 });
      if (id === '429') throw Object.assign(new Error('You are being rate limited.'), { status: 429, retryAfter: 30 }); servers.set(id, body); return body; },
    };
    const store4 = new Map();
    const settings4 = { getSetting: async (key) => store4.get(key) ?? null, setSetting: async (key, value) => { store4.set(key, value); } };
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'registered', 'a server without them gets them');
    assert.deepEqual(servers.get('11').map((c) => c.name), ['case', 'note'], 'the second set, and nothing global');
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'unchanged', 'a server that has them is not sent them again');
    assert.equal(calls.length, 1, 'only one registration so far');
    servers.set('11', []);
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'registered', 'a server that lost them (the bot left and came back) gets them again even if the hash says they are there');
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4, force: true })).status, 'registered', 'force registers anyway');
    second = [{ name: 'case' }, { name: 'note' }, { name: 'jail' }];
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'registered', 'a change in the set is registered');
    assert.equal((await deployGuildCommands('403', { rest: restServers, settings: settings4 })).status, 'skipped', 'a server where Petto cannot register (403) is skipped, not a failure');
    assert.equal((await deployGuildCommands('429', { rest: restServers, settings: settings4 })).status, 'limited', 'a rate limit is reported with its wait');
    // At start every server is looked at, one by one, and the loop stops at a rate limit.
    calls.length = 0;
    const startClient = { guilds: { cache: new Map([['21', {}], ['22', {}], ['429', {}], ['23', {}]]) } };
    const synced = await syncGuildCommands(startClient, { rest: restServers, settings: settings4, delayMs: 0 });
    assert.deepEqual(calls.map((c) => c[1]), ['21', '22', '429'], 'the servers are done in order and the rate limit stops the rest');
    assert.equal(synced.registered, 2);
    assert.equal(synced.stoppedByLimit, true);
    // The cleanup of old server copies keeps the second set (and puts it back) instead of emptying the server.
    config.devGuildIds = [];
    const old = { get: async () => [{ name: 'old' }, { name: 'case' }], put: async (_route, { body }) => { calls.push(['cleanup', body.map((c) => c.name)]); return body; } };
    calls.length = 0;
    await cleanupGuildCommands({ guilds: { cache: new Map([['31', {}]]) } }, { rest: old, settings: { getSetting: async () => null, setSetting: async () => {} }, delayMs: 0, force: true });
    assert.deepEqual(calls, [['cleanup', ['case', 'note', 'jail']]], 'old copies are removed and the commands of the second set stay');
    // With test servers the second set goes along with the global commands, and no server is touched by the per-server registration.
    config.devGuildIds = ['293504726505357312'];
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'empty', 'in test-server mode the per-server registration does nothing');
    config.devGuildIds = [];
    second = [];
    assert.equal((await deployGuildCommands('11', { rest: restServers, settings: settings4 })).status, 'empty', 'with no second set there is nothing to register');
  }

  console.log('Checked that the commands are registered only when they change and a failure does not stop the start.');
})();
