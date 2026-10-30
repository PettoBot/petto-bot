// Checks the support mode of the Petto owner (src/web/supportOwner.js) through real HTTP requests to the dashboard routes: on a server the owner
// does not manage, he passes only the listed routes (feeds update/test/resolve/search/preview, counters refresh/reorder/announce, timer run,
// confession panel, resync) and the two reads of the image cards (the list and the picture of an asset, GET only), with the dashboard key, and each one leaves a line in the log; everything else, any other person who does not
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
// The cards: two reads. `cardRoutes.js` takes `getGuildPremium` when it loads, so it is replaced before the server is required.
require('../src/db/premium').getGuildPremium = async () => ({ active: false });
Object.assign(require('../src/db/imageCards'), { listCards: async () => [], countCards: async () => 0, getCard: async () => null, saveCard: async () => { throw new Error('a card was saved'); }, deleteCard: async () => { throw new Error('a card was deleted'); } });
Object.assign(require('../src/db/cardAssets'), { listAssets: async () => [], totalBytes: async () => 0, getAsset: async (_guildId, id) => (id === '5' ? { bytes: Buffer.from('png') } : null), deleteAsset: async () => { throw new Error('an asset was deleted'); }, addAsset: async () => { throw new Error('an asset was added'); } });

require('../src/db/backups').vault.isConfigured = () => true; // the backups would answer: it is the gate that refuses
const config = require('../src/config');
const OWNER = '293504726505357312';
const MANAGER = '300000000000000001';
const STRANGER = '300000000000000002';
const GUILD = '111111111111111111';
const OTHER_GUILD = '222222222222222222';
Object.assign(config, { ownerId: OWNER, developerIds: [], feedTesterIds: [MANAGER], verifyBaseUrl: '', verifyTokenSecret: '', dashboardApiSecret: 'dash-key', topggWebhookSecret: '', webPort: 0 });
const { startServer } = require('../src/web/server');
const { supportRouteOf, supportOwnerAllows, SUPPORT_ROUTES } = require('../src/web/supportOwner');

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

function call(port, method, url, { userId, key = 'dash-key', body = {}, query = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, user_id: userId });
    if (query) url += `${url.includes('?') ? '&' : '?'}user_id=${userId}`; // the website sends the id in the query
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', ...(key ? { 'x-petto-dashboard-key': key } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8'); // the picture of an asset is not JSON: its status is what counts
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, ...json }); });
    });
    req.on('error', reject);
    if (method !== 'GET' && !query) req.write(data);
    req.end();
  });
}

// The listed routes, with a body that makes the route end quickly, and the status that means "it ran" (not a refusal).
const D = (rest) => `/api/dashboard/guild/${GUILD}/${rest}`;
const CARDS = (rest = '') => `/api/dashboard/cards/${GUILD}${rest}`;
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
  assert.equal(supportRouteOf('GET', D('feeds/update')), null, 'the old entries are POST only');
  assert.equal(supportRouteOf('DELETE', D('resync')), null);
  for (const rest of ['feeds/create', 'feeds/delete', 'feeds/update/x', 'feeds/updatex', 'feeds', 'counters/preview', 'counters/create', 'timers/x/run', 'timers/5/run/x', 'resync/x', 'x/resync', 'tickets/live/list']) {
    assert.equal(supportRouteOf('POST', D(rest)), null, `${rest} is not on the list`);
  }
  assert.equal(supportRouteOf('POST', `/x${D('resync')}`), null);
  assert.equal(supportRouteOf('POST', `${D('resync')}?x=1`), null, 'the path is given without its query');
  assert.equal(supportRouteOf('POST', '/api/dashboard/vault/111111111111111111'), null);
  // The cards: the two reads, with their method. A GET does not open a POST and a POST does not open a GET.
  assert.deepEqual(supportRouteOf('GET', CARDS()), { name: 'cards/list', guildId: GUILD });
  assert.deepEqual(supportRouteOf('get', `${CARDS('/assets/5')}/`), { name: 'cards/asset', guildId: GUILD });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.equal(supportRouteOf(method, CARDS()), null, `${method} on the cards list`);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(supportRouteOf(method, CARDS('/assets/5')), null, `${method} on an asset`);
  assert.equal(supportRouteOf('POST', CARDS('/preview')), null); assert.equal(supportRouteOf('GET', CARDS('/preview')), null);
  assert.equal(supportRouteOf('POST', CARDS('/normalize')), null);
  for (const rest of ['/assets', '/assets/x', '/assets/5/x', '/assets/1234567890123456789', '/preview/x', '/x']) assert.equal(supportRouteOf('GET', CARDS(rest)), null, `GET cards${rest} is not on the list`);
  assert.equal(supportRouteOf('GET', D('resync')), null, 'a GET does not open a POST route');
  assert.equal(supportRouteOf('GET', `${CARDS()}?user_id=1`), null, 'the path is given without its query');
  assert.equal(SUPPORT_ROUTES.length, 13, 'the list is short: feeds (5), counters (3), timer run, confession panel, resync, and the 2 reads of the cards');
  assert.deepEqual(SUPPORT_ROUTES.filter((route) => route.method === 'GET').map((route) => route.name), ['cards/list', 'cards/asset'], 'the only GET routes');
  // The server in the path must be the one being authorized.
  const cardsGet = { method: 'GET', path: CARDS(), params: { guildId: GUILD } };
  assert.equal(supportOwnerAllows(cardsGet, OWNER, GUILD), true);
  assert.equal(supportOwnerAllows(cardsGet, OWNER, OTHER_GUILD), false, 'another guild id');
  assert.equal(supportOwnerAllows({ ...cardsGet, params: { guildId: OTHER_GUILD } }, OWNER, GUILD), false, 'another guild id in the params');
  assert.equal(supportOwnerAllows(cardsGet, STRANGER, GUILD), false, 'not the owner');
  assert.equal(supportOwnerAllows({ ...cardsGet, method: 'POST' }, OWNER, GUILD), false);
  infos.length = 0;
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

    // 2b. The cards: the owner reads the list and the picture of an asset on a server he does not manage, and nothing else of the cards.
    infos.length = 0;
    r = await call(port, 'GET', CARDS(), { userId: OWNER, query: true });
    assert.deepEqual([r.status, r.ok], [200, true], `the owner on the cards list: ${JSON.stringify(r)}`);
    assert.deepEqual(infos, [`support: owner ${OWNER} cards/list on guild ${GUILD}`], 'logged once, without a body');
    infos.length = 0;
    r = await call(port, 'GET', CARDS('/assets/5'), { userId: OWNER, query: true });
    assert.equal(r.status, 200, 'the owner on an asset picture');
    assert.deepEqual(infos, [`support: owner ${OWNER} cards/asset on guild ${GUILD}`]);
    r = await call(port, 'GET', CARDS('/assets/6'), { userId: OWNER, query: true });
    assert.deepEqual([r.status, r.error], [404, 'not_found'], 'an asset that does not exist is a plain 404 (he got in)');
    infos.length = 0;
    for (const [method, rest, body] of [
      ['POST', '', { action: 'save', name: 'x', data: {} }], ['POST', '', { action: 'delete', name: 'x' }], ['POST', '/preview', { data: {} }], ['POST', '/normalize', { data: {} }],
      ['POST', '/assets', {}], ['DELETE', '/assets/5', {}],
    ]) {
      r = await call(port, method, CARDS(rest), { userId: OWNER, body, query: method === 'DELETE' });
      assert.deepEqual([r.status, r.error], [403, 'no_access'], `the owner on ${method} cards${rest}: ${JSON.stringify(r)}`);
    }
    // A method with no route of its own (the cards have no DELETE, PUT or POST on an asset id) never reaches the owner's list: the router has none.
    for (const [method, rest] of [['DELETE', ''], ['PUT', ''], ['PUT', '/assets/5'], ['POST', '/assets/5']]) {
      r = await call(port, method, CARDS(rest), { userId: OWNER, query: method !== 'POST' });
      assert.ok(r.status === 403 || r.status === 404, `the owner on ${method} cards${rest}: ${r.status}`);
      assert.notEqual(r.ok, true);
    }
    assert.deepEqual(infos, [], 'the refused ones leave no support line');
    // A wrong key or none is a 401 before anything else; a person who does not manage the server, or is not in it, is a 403; the owner's
    // id of someone else (the id of the query is the one checked) gets nothing.
    for (const key of ['wrong', null]) {
      for (const rest of ['', '/assets/5']) {
        r = await call(port, 'GET', CARDS(rest), { userId: OWNER, key, query: true });
        assert.deepEqual([r.status, r.error], [401, 'unauthorized'], `cards${rest} with ${key ?? 'no'} key`);
      }
    }
    for (const userId of [STRANGER, '300000000000000009']) {
      for (const rest of ['', '/assets/5']) {
        r = await call(port, 'GET', CARDS(rest), { userId, query: true });
        assert.deepEqual([r.status, r.error], [403, 'no_access'], `${userId} on GET cards${rest}`);
      }
    }
    r = await call(port, 'GET', CARDS(), { userId: STRANGER, query: true });
    assert.equal(r.status, 403);
    config.ownerId = '293504726505357399';
    r = await call(port, 'GET', CARDS(), { userId: OWNER, query: true });
    assert.deepEqual([r.status, r.error], [403, 'no_access'], 'the owner is whoever the configuration says');
    config.ownerId = OWNER;
    // The manager of the server reads and writes the cards as before, with no support line.
    r = await call(port, 'GET', CARDS(), { userId: MANAGER, query: true });
    assert.equal(r.status, 200);
    r = await call(port, 'POST', CARDS(), { userId: MANAGER, body: { action: 'nope', name: 'x' } });
    assert.deepEqual([r.status, r.error], [400, 'unknown_action'], 'the manager still reaches the POST');
    assert.deepEqual(infos, [], 'a manager is not a support request');
    // The owner on a server he manages: a normal manager, nothing logged.
    r = await call(port, 'POST', `/api/dashboard/cards/${MANAGED_GUILD}`, { userId: OWNER, body: { action: 'nope', name: 'x' } });
    assert.deepEqual([r.status, r.error], [400, 'unknown_action']); assert.deepEqual(infos, []);

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
  console.log('Checked the support mode of the Petto owner: only the listed routes (and the two reads of the cards), the key still required, and everybody else as before.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
