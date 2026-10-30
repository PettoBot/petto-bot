// Checks the support mode of the Petto owner (src/web/supportOwner.js) through real HTTP requests to the dashboard routes: on a server the owner
// does not manage, he passes only the listed routes (feeds update/test/resolve/search/preview, counters refresh/reorder/announce, timer run,
// confession panel, resync), with the dashboard key, and each one leaves a line in the log; everything else, any other person who does not
// manage the server, and a member who does manage it, answer as they always did. The database and Discord are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const infos = []; const errors = [];
stub('src/utils/logger.js', { info: (message) => infos.push(String(message)), warn() {}, error: (...args) => errors.push(args), debug() {} });
require('../src/db/guilds').ensureGuild = async () => ({});
require('../src/utils/guildSnapshots').saveGuildSnapshot = async () => true;
// Nothing of the listed routes reaches a real database: each one finds nothing, or does nothing.
Object.assign(require('../src/db/counters'), { list: async () => [], setOrder: async () => {}, getAnnounce: async () => null, saveAnnounce: async () => {} });
Object.assign(require('../src/jobs/counterJob'), { refreshGuildCounters: async () => [], reloadAnnounce: async () => {} });
require('../src/db/autoMessages').get = async () => null;
require('../src/db/confessions').getConfig = async () => ({ channel_id: null, panel_channel_id: null });

require('../src/db/backups').vault.isConfigured = () => true; // the backups would answer: it is the gate that refuses
const config = require('../src/config');
const OWNER = '293504726505357312';
const MANAGER = '300000000000000001';
const STRANGER = '300000000000000002';
const GUILD = '111111111111111111';
const OTHER_GUILD = '222222222222222222';
Object.assign(config, { ownerId: OWNER, developerIds: [], feedTesterIds: [MANAGER], verifyBaseUrl: '', verifyTokenSecret: '', dashboardApiSecret: 'dash-key', topggWebhookSecret: '', webPort: 0 });
const { startServer } = require('../src/web/server');
const { supportRouteOf, SUPPORT_ROUTES } = require('../src/web/supportOwner');

const member = (id, flags) => ({ id, displayName: id, user: { id, username: id }, permissions: { has: (flag) => flags.includes(flag) }, roles: { cache: new Map() } });
const members = new Map([[MANAGER, member(MANAGER, [PermissionFlagsBits.ManageGuild])], [STRANGER, member(STRANGER, [])]]);
const makeGuild = (id, list = members) => ({
  id, name: `Server ${id}`, iconURL: () => null,
  members: { cache: list, me: null, fetch: async (userId) => { const found = list.get(String(userId)); if (!found) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return found; } },
  channels: { cache: new Map(), fetch: async () => {} }, roles: { cache: new Map(), fetch: async () => {} },
});
const MANAGED_GUILD = '333333333333333333'; // where the owner is a member with Manage Server
const guilds = new Map([[GUILD, makeGuild(GUILD)], [OTHER_GUILD, makeGuild(OTHER_GUILD)], [MANAGED_GUILD, makeGuild(MANAGED_GUILD, new Map([[OWNER, member(OWNER, [PermissionFlagsBits.ManageGuild])]]))]]);
const client = { guilds: { cache: guilds, fetch: async (id) => guilds.get(id) ?? Promise.reject(new Error('Unknown Guild')) }, users: { fetch: async () => null } };

function call(port, method, url, { userId, key = 'dash-key', body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, user_id: userId });
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', ...(key ? { 'x-petto-dashboard-key': key } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, ...json }); });
    });
    req.on('error', reject);
    if (method !== 'GET') req.write(data);
    req.end();
  });
}

// The listed routes, with a body that makes the route end quickly, and the status that means "it ran" (not a refusal).
const D = (rest) => `/api/dashboard/guild/${GUILD}/${rest}`;
const ALLOWED = [
  ['feeds/update', {}, 400], ['feeds/test', {}, 404], ['feeds/resolve', {}, 400], ['feeds/search', { platform: 'nope' }, 400], ['feeds/preview', { platform: 'nope' }, 400],
  ['counters/refresh', {}, 200], ['counters/reorder', {}, 200], ['counters/announce', { enabled: false }, 200], ['counters/announce', { test: true }, 400],
  ['timers/5/run', {}, 404], ['confessions/panel', {}, 400], ['resync', {}, 200],
];
// Routes that exist and that the owner must not use on a server he does not manage.
const DENIED = [
  'feeds/create', 'feeds/delete', 'counters/create', 'counters/setup', 'counters/delete', 'counters/preview', 'giveaway/start', 'suggestions/answer', 'tickets/transcript',
  'antinuke/restore', 'appeals/resolve', 'automod/native', 'lockdown', 'moderation/lift', 'verification/setup', 'verification/enable', 'quests/method',
  'forms/panel', 'forms/review', 'tickets/live/list', 'honeypot/add', 'invites/reward', 'invites/reset', 'cases/edit', 'cases/delete', 'identity', 'code/save', 'code/trigger', 'pagination/create', 'pagination/delete', 'boosterroles/list',
];

(async () => {
  // The list itself: POST only, the exact route, any case and a final slash (as Express reads it), nothing around it.
  assert.deepEqual(supportRouteOf('POST', D('feeds/update')), { name: 'feeds/update', guildId: GUILD });
  assert.deepEqual(supportRouteOf('post', D('Feeds/Update/')), { name: 'feeds/update', guildId: GUILD });
  assert.equal(supportRouteOf('GET', D('feeds/update')), null, 'only POST');
  assert.equal(supportRouteOf('DELETE', D('resync')), null);
  for (const rest of ['feeds/create', 'feeds/delete', 'feeds/update/x', 'feeds/updatex', 'feeds', 'counters/preview', 'counters/create', 'timers/x/run', 'timers/5/run/x', 'resync/x', 'x/resync', 'tickets/live/list']) {
    assert.equal(supportRouteOf('POST', D(rest)), null, `${rest} is not on the list`);
  }
  assert.equal(supportRouteOf('POST', `/x${D('resync')}`), null);
  assert.equal(supportRouteOf('POST', `${D('resync')}?x=1`), null, 'the path is given without its query');
  assert.equal(supportRouteOf('POST', '/api/dashboard/vault/111111111111111111'), null);
  assert.equal(SUPPORT_ROUTES.length, 11, 'the list is short: feeds (5), counters (3), timer run, confession panel, resync');
  assert.ok(SUPPORT_ROUTES.every((route) => !/create|delete|setup|premium|backup|verif|form|ticket|permission|access/i.test(route.name)), 'nothing that makes or removes, or gives access');

  const app = startServer(client);
  const server = http.createServer(app).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    // 1. The owner, on a server he is not in: every listed route runs, and each leaves its line (no body in it).
    for (const [route, body, status] of ALLOWED) {
      infos.length = 0;
      const r = await call(port, 'POST', D(route), { userId: OWNER, body: { ...body, secret_text: 'do-not-log-me' } });
      assert.equal(r.status, status, `the owner on ${route}: ${JSON.stringify(r)} ${JSON.stringify(errors.at(-1) ?? '')}`);
      assert.notEqual(r.error, 'no_access', `${route} is not refused for the owner`);
      const name = route.replace(/^timers\/\d+\/run$/, 'timers/run');
      assert.deepEqual(infos, [`support: owner ${OWNER} ${name} on guild ${GUILD}`], `${route} is logged once, without the body`);
    }
    // Also with a final slash and another case, as Express answers them.
    infos.length = 0;
    let r = await call(port, 'POST', D('Resync/'), { userId: OWNER });
    assert.equal(r.status, 200); assert.equal(infos.length, 1);

    // 2. The owner is refused on routes that are denied, and on every other route (there is no way to reach them through him).
    for (const rest of DENIED) {
      infos.length = 0;
      r = await call(port, 'POST', D(rest), { userId: OWNER });
      assert.notEqual(r.status, 200, `${rest} does not run for the owner`);
      assert.deepEqual([r.status, r.error], [403, 'no_access'], `the owner on ${rest}: ${JSON.stringify(r)}`);
      assert.deepEqual(infos, [], `${rest}: nothing is logged as a support request`);
    }
    r = await call(port, 'GET', `/api/dashboard/vault/${GUILD}?user_id=${OWNER}`, { userId: OWNER });
    assert.deepEqual([r.status, r.error], [403, 'no_access'], 'the backups stay closed');
    r = await call(port, 'POST', `/api/dashboard/vault/${GUILD}`, { userId: OWNER, body: { action: 'create' } });
    assert.deepEqual([r.status, r.error], [403, 'no_access'], 'the backups stay closed (write)');
    // The list is not a pass for a person that is not the owner, and the owner id is the one of the configuration.
    config.ownerId = '293504726505357399';
    r = await call(port, 'POST', D('resync'), { userId: OWNER });
    assert.deepEqual([r.status, r.error], [403, 'no_access'], 'the owner is whoever the configuration says');
    r = await call(port, 'POST', D('resync'), { userId: '293504726505357399' });
    assert.equal(r.status, 200);
    config.ownerId = OWNER;

    // 3. The key is still required: a wrong one or none is refused before anything else.
    for (const key of ['wrong', null]) {
      for (const [route] of ALLOWED) {
        r = await call(port, 'POST', D(route), { userId: OWNER, key });
        assert.deepEqual([r.status, r.error], [401, 'unauthorized'], `${route} with ${key ?? 'no'} key`);
      }
    }
    // The owner's id in the query (not the body) is read the same way; a forged id of someone else gets nothing.
    infos.length = 0;
    r = await call(port, 'POST', `${D('resync')}?user_id=${STRANGER}`, { userId: OWNER });
    assert.deepEqual([r.status, r.error], [403, 'no_access'], 'the id of the query wins, as it always did: it is the one checked');

    // 4. A person who does not manage the server is refused everywhere, the listed routes included, and so is one who is not in it.
    for (const userId of [STRANGER, '300000000000000009']) {
      for (const rest of [...ALLOWED.map(([route]) => route), ...DENIED]) {
        r = await call(port, 'POST', D(rest), { userId });
        assert.deepEqual([r.status, r.error], [403, 'no_access'], `${userId} on ${rest}`);
      }
    }
    assert.deepEqual(infos, [], 'nobody else leaves a support line');

    // 5. A member who manages the server behaves as before: every route is open to him, the denied ones too, and nothing is logged as support.
    for (const [route, body, status] of ALLOWED) {
      r = await call(port, 'POST', D(route), { userId: MANAGER, body });
      assert.equal(r.status, status, `the manager on ${route}`);
    }
    r = await call(port, 'POST', D('feeds/delete'), { userId: MANAGER });
    assert.notEqual(r.error, 'no_access', 'feeds/delete is still his');
    r = await call(port, 'POST', D('counters/preview'), { userId: MANAGER });
    assert.notEqual(r.error, 'no_access', 'counters/preview is still his');
    assert.deepEqual(infos, [], 'a member who manages the server is not a support request');
    // The owner as a member who manages the server is a normal manager: nothing logged either.
    r = await call(port, 'POST', `/api/dashboard/guild/${MANAGED_GUILD}/feeds/delete`, { userId: OWNER });
    assert.notEqual(r.error, 'no_access', 'on a server he manages the owner has what any manager has'); assert.deepEqual(infos, []);
    // A different server the owner passes through is the one in the address.
    r = await call(port, 'POST', `/api/dashboard/guild/${OTHER_GUILD}/resync`, { userId: OWNER });
    assert.equal(r.status, 200); assert.deepEqual(infos, [`support: owner ${OWNER} resync on guild ${OTHER_GUILD}`]);
  } finally {
    server.close();
  }
  console.log('Checked the support mode of the Petto owner: only the listed routes, the key still required, and everybody else as before.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
