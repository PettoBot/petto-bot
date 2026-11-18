// Checks adding a person to the support server after the dashboard login said yes: it uses the permission the person gave (once, never logged), says
// ok when they were already in, tells why when it could not, and the route of the dashboard is only for the website (the shared key).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../src/utils/logger');
const { DEFAULT_SUPPORT_GUILD_ID, joinSupportServer } = require('../src/utils/supportJoin');

const logged = [];
for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args) => logged.push(args.join(' '));

const SECRET = 'SECRETACCESSTOKEN1234567890';
const clientWith = (add, { cached = true } = {}) => {
  const guild = { id: DEFAULT_SUPPORT_GUILD_ID, members: { add } };
  return { calls: [], guilds: { cache: new Map(cached ? [[DEFAULT_SUPPORT_GUILD_ID, guild]] : []), fetch: async () => { throw new Error('no such server'); } } };
};

(async () => {
  assert.equal(DEFAULT_SUPPORT_GUILD_ID, '1414452131850879080', 'the support server');

  // Added with the permission of the person.
  const added = [];
  assert.deepEqual(await joinSupportServer(clientWith(async (user, options) => { added.push([user, options]); return {}; }), '123456789012345678', SECRET), { ok: true });
  assert.deepEqual(added, [['123456789012345678', { accessToken: SECRET }]], 'with the token they just gave');
  // Already in the server (discord.js answers with nothing): still fine.
  assert.deepEqual(await joinSupportServer(clientWith(async () => undefined), '123456789012345678', SECRET), { ok: true });

  // Why it could not: banned or refused, or any other failure; the token never reaches the log.
  const refused = Object.assign(new Error(`Missing Access ${SECRET}`), { status: 403 });
  assert.deepEqual(await joinSupportServer(clientWith(async () => { throw refused; }), '123456789012345678', SECRET), { ok: false, code: 'refused' });
  assert.deepEqual(await joinSupportServer(clientWith(async () => { throw new Error('boom'); }), '123456789012345678', SECRET), { ok: false, code: 'failed' });
  assert.deepEqual(await joinSupportServer(clientWith(async () => ({}), { cached: false }), '123456789012345678', SECRET), { ok: false, code: 'no_server' }, 'Petto is not in the support server');
  assert.ok(logged.length >= 2 && !logged.join('\n').includes(SECRET), 'the token is never logged');

  // The route: only the website (the shared key), a well-formed person and token, and nothing about the token in the answer.
  const server = fs.readFileSync(path.join(__dirname, '..', 'src/web/server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/dashboard/support/join'"));
  const body = route.slice(0, route.indexOf('// ── Appeals'));
  assert.match(body, /dashboardAuthorized\(req\)/, 'only the website can ask');
  assert.match(body, /\\d\{15,25\}[\s\S]*accessToken\.length/, 'the person and the token are checked');
  assert.ok(!/logger[^\n]*accessToken/.test(body), 'the token is not logged');
  console.log('Support join checks passed (added with the permission given, already in, why not, the token never logged, the route).');
})().catch((error) => { console.error(error); process.exit(1); });
