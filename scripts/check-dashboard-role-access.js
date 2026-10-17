// Checks "Dashboard access" by role for the bot-backed routes of the dashboard (counters, forms): a member without Manage Server is let in
// only when the site vouches for them on that page AND the bot's own reading of the rules (dash_access) and of their roles agrees; a
// view rule only opens what looks, an edit rule what changes; other pages, other roles, a missing or wrong grant open nothing.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let rows = [];
let reads = 0;
let broken = false;
stub('src/db/database.js', {
  from(table) {
    assert.equal(table, 'dash_access');
    const query = { select() { return query; }, eq(column, value) { query.guild = value; return query; }, then(resolve) { reads += 1; resolve(broken ? { data: null, error: new Error('down') } : { data: rows.filter((r) => r.guild_id === query.guild), error: null }); } };
    return query;
  },
});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
const access = require('../src/web/dashboardRoleAccess');
const member = (...roles) => ({ roles: { cache: new Map([['g1', {}], ...roles.map((id) => [id, {}])]) } });

(async () => {
  rows = [
    { guild_id: 'g1', role_id: 'helpers', sections: ['automation'], can_edit: true },
    { guild_id: 'g1', role_id: 'viewers', sections: ['community'], can_edit: false },
    { guild_id: 'g1', role_id: 'staff', sections: ['*'], can_edit: true },
    { guild_id: 'g2', role_id: 'helpers', sections: ['*'], can_edit: true },
  ];
  const ask = (m, page, grant, needEdit) => { access.forgetRules(); return access.roleGrantAllows({ guildId: 'g1', member: m, page, grant, needEdit }); };
  assert.equal(await ask(member('helpers'), 'counters', 'counters:edit', true), true, 'an edit rule on Automation opens the counter actions');
  assert.equal(await ask(member('helpers'), 'counters', 'counters:view', false), true, 'and their preview');
  assert.equal(await ask(member('helpers'), 'forms', 'forms:edit', true), false, 'but not the forms (another section)');
  assert.equal(await ask(member('viewers'), 'forms', 'forms:view', false), true, 'a view rule lists the submissions');
  assert.equal(await ask(member('viewers'), 'forms', 'forms:edit', true), false, 'a view rule cannot accept, deny or post a panel');
  assert.equal(await ask(member('viewers'), 'forms', 'forms:view', true), false, 'a view grant never opens a change');
  assert.equal(await ask(member('staff'), 'forms', 'forms:edit', true), true, 'a rule for the whole dashboard opens every page');
  assert.equal(await ask(member('staff'), 'counters', 'counters:edit', true), true);
  assert.equal(await ask(member('nobody'), 'counters', 'counters:edit', true), false, 'roles without a rule get nothing, whatever the site says');
  assert.equal(await ask(member(), 'counters', 'counters:edit', true), false, 'only @everyone: nothing');
  assert.equal(await ask(member('helpers'), 'counters', null, true), false, 'no grant from the site: nothing');
  assert.equal(await ask(member('helpers'), 'counters', 'forms:edit', true), false, 'a grant for another page: nothing');
  assert.equal(await ask(member('helpers'), 'counters', 'counters:admin', true), false, 'a grant the bot does not know: nothing');
  assert.equal(await ask(member('helpers'), 'backups', 'backups:edit', true), false, 'pages without role routes: nothing');
  assert.equal(await ask(null, 'counters', 'counters:edit', true), false, 'not a member: nothing');
  assert.equal(await access.roleGrantAllows({ guildId: 'g3', member: member('helpers'), page: 'counters', grant: 'counters:edit', needEdit: true }), false, 'rules of another server do not count');
  broken = true;
  assert.equal(await ask(member('staff'), 'forms', 'forms:edit', true), false, 'the rules cannot be read: nothing');
  broken = false;
  // The rules are kept a few seconds.
  access.forgetRules(); reads = 0;
  for (let i = 0; i < 3; i += 1) await access.roleGrantAllows({ guildId: 'g1', member: member('helpers'), page: 'counters', grant: 'counters:edit', needEdit: true });
  assert.equal(reads, 1, 'one read for a few requests');

  // The routes ask for their page: counters (preview only looks), forms (the list only looks).
  const seen = {};
  const app = { post: (route, ...fns) => { seen[route] = fns.at(-1); } };
  require('../src/web/counterRoutes').registerCounterRoutes(app, { authorize: async (req, res, options) => { req.options = options; return null; } });
  require('../src/web/formRoutes').registerFormRoutes(app, { authorize: async (req, res, options) => { req.options = options; return null; } });
  const optionsOf = async (route) => { const req = { params: { guildId: 'g1' }, body: {} }; await seen[route](req, {}); return req.options; };
  assert.deepEqual(await optionsOf('/api/dashboard/guild/:guildId/counters/preview'), { page: 'counters', edit: false });
  for (const name of ['create', 'setup', 'refresh', 'delete']) assert.deepEqual(await optionsOf(`/api/dashboard/guild/:guildId/counters/${name}`), { page: 'counters', edit: true });
  assert.deepEqual(await optionsOf('/api/dashboard/guild/:guildId/forms/submissions'), { page: 'forms', edit: false });
  assert.deepEqual(await optionsOf('/api/dashboard/guild/:guildId/forms/review'), { page: 'forms', edit: true });
  assert.deepEqual(await optionsOf('/api/dashboard/guild/:guildId/forms/panel'), { page: 'forms', edit: true });
  // The server's check takes the options and the header.
  const server = require('node:fs').readFileSync(path.join(__dirname, '../src/web/server.js'), 'utf8');
  assert.match(server, /async function dashboardCardAccess\(req, res, \{ page = null, edit = true \} = \{\}\)/);
  assert.match(server, /roleGrantAllows\(\{ guildId: guild\.id, member, page, grant: req\.get\('x-petto-dashboard-grant'\), needEdit: edit \}\)/);
  console.log('Checked dashboard access by role for counters and forms: the site vouches, the bot checks the rules and roles itself.');
})().catch((err) => { console.error(err); process.exit(1); });
