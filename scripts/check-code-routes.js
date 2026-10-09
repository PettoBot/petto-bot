// Checks the routes the dashboard uses for commands in code: the editor's pieces, the check while writing, the test run that
// changes nothing, saving, and who may do what.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const settings = { ownerId: 'owner', developerIds: [], codeCommandsDisabled: false };
let premiumActive = false;
const store = new Map();
stub('src/config.js', settings);
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).match(/"[^"]*"|\S+/g)?.map((word) => word.replace(/^"|"$/g, '')) ?? [] });
stub('src/db/commandData.js', { forGuild: () => ({}) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/customCommands.js', {
  getCommand: async (guildId, name) => store.get(`${guildId}:${name}`) ?? null,
  upsertCommand: async (guildId, name, values) => { store.set(`${guildId}:${name}`, { name, trigger_type: 'command', trigger_text: null, ...values }); },
  listCommands: async (guildId) => [...store.entries()].filter(([key]) => key.startsWith(`${guildId}:`)).map(([, value]) => value),
  listTriggers: async (guildId) => [...store.entries()].filter(([key, value]) => key.startsWith(`${guildId}:`) && value.trigger_type !== 'command').map(([, value]) => value),
  setTrigger: async (guildId, name, type, text) => { const row = store.get(`${guildId}:${name}`); if (!row) return false; row.trigger_type = type; row.trigger_text = text; return true; },
});
stub('src/db/premium.js', { FREE_LIMITS: { customCommands: 50 }, PREMIUM_LIMITS: { customCommands: 100 }, getGuildPremium: async () => ({ active: premiumActive }), getGuildLimits: (premium) => (premium?.active ? { customCommands: 100 } : { customCommands: 50 }) });
const { registerCodeRoutes } = require('../src/web/codeRoutes');

(async () => {
  const guild = {
    id: '300000000000000001', name: 'HQ', memberCount: 90, iconURL: () => null, systemChannel: { id: '200000000000000001', name: 'general', isTextBased: () => true },
    channels: { cache: new Map() }, roles: { cache: new Map() },
    client: { commands: new Map([['ping', {}]]), commandAliases: new Map(), commandRoutes: new Map() },
  };
  const makeMember = (id) => ({ user: { id, username: 'Liam', globalName: null, bot: false, displayAvatarURL: () => 'https://cdn.example/a.png' }, nickname: null, displayName: 'Liam', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Map() } });
  const app = express();
  app.use(express.json());
  registerCodeRoutes(app, { authorize: async (req) => ({ guild, member: makeMember(String(req.query.user_id || req.body?.user_id)), userId: String(req.query.user_id || req.body?.user_id) }) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/dashboard/guild/${guild.id}/code`;
  const call = async (route, body, userId = 'tester') => {
    const response = await fetch(`${base}/${route}${body ? '' : `?user_id=${userId}`}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, user_id: userId }) } : {});
    return { status: response.status, json: await response.json() };
  };

  // The pieces of the editor.
  let r = await call('meta');
  assert.equal(r.status, 200); assert.equal(r.json.canWrite, true);
  assert.ok(r.json.functions.some((fn) => fn.name === 'cembed' && fn.min === 0) && r.json.functions.some((fn) => fn.name === 'dbIncr') && r.json.functions.length > 60);
  assert.ok(r.json.templates.some((template) => template.id === 'vote' && template.code.includes('cbutton')) && r.json.templates.length >= 12);
  assert.deepEqual(r.json.triggerTypes, ['command', 'prefix', 'startswith', 'exact', 'contains']);
  assert.equal(r.json.limits.source, 10_000);
  r = await call('meta', null, 'someone'); assert.equal(r.json.canWrite, true, 'anyone who manages the server can write');
  settings.codeCommandsDisabled = true; r = await call('meta', null, 'someone'); assert.equal(r.json.canWrite, false, 'when it is turned off the editor says so'); settings.codeCommandsDisabled = false;

  // Checking while writing.
  r = await call('check', { code: 'Hello {{ .User.Username }}' }); assert.equal(r.json.problem, null);
  r = await call('check', { code: 'a\n{{ if }}' }); assert.equal(r.json.problem.kind, 'syntax'); assert.equal(r.json.problem.line, 2);
  r = await call('check', { code: 'x'.repeat(10_001) }); assert.equal(r.json.problem.kind, 'limit');
  r = await call('check', { code: 5 }); assert.equal(r.json.problem, null, 'no code is no problem');
  r = await call('check', { code: 'x'.repeat(20_000) }); assert.equal(r.json.problem.kind, 'limit');
  // Hints: names that are most likely mistakes, which only a run would otherwise find (and only in the part that runs).
  r = await call('check', { code: 'Hello {{ .User.Username }}' }); assert.deepEqual(r.json.hints, []);
  r = await call('check', { code: '{{ .User.Usrname }}{{ if false }}{{ dbget "x" }}{{ end }}' });
  assert.equal(r.json.problem, null);
  assert.deepEqual(r.json.hints, ['.User.Usrname is not in the data, so it gives nothing. Did you mean .User.Username?', 'There is no function called "dbget". Did you mean dbGet?']);
  r = await call('check', { code: '{{ if }}{{ .User.Usrname }}' }); assert.deepEqual(r.json.hints, [], 'code with a mistake has no hints');
  r = await call('check', { code: 'x'.repeat(20_000) }); assert.deepEqual(r.json.hints, []);

  // A test run: it says what it would print and do, and sends and saves nothing.
  r = await call('test', { code: 'Hi {{ .User.Username }} in {{ .Guild.Name }}{{ sendMessage nil "x" }}{{ addRole "100000000000000001" }}{{ dbIncr "t" 2 }}{{ dbIncr "t" 3 }}' });
  assert.equal(r.json.ok, true); assert.equal(r.json.output, 'Hi Liam in HQ' + '25');
  assert.deepEqual(r.json.actions, ['send "x" here', 'give the role <@&100000000000000001>']);
  assert.ok(r.json.steps > 5 && r.json.millis >= 0);
  // The effects themselves, for a preview like Discord's, next to the sentences of `actions`.
  assert.deepEqual(r.json.effects, [{ type: 'message', channelId: null, content: 'x' }, { type: 'addRole', roleId: '100000000000000001' }]);
  assert.deepEqual(r.json.hints, []);
  r = await call('test', { code: '{{ sendMessage nil (complexMessage "content" "Hi" "embed" (cembed "title" "T" "color" "#ff91c2") "components" (cslice (crow (cbutton "label" "Yes" "id" "yes"))) "reactions" (cslice "🦋")) }}{{ deleteTrigger 5 }}{{ .User.Nme }}' });
  assert.deepEqual(r.json.effects, [
    { type: 'message', channelId: null, content: 'Hi', embed: { title: 'T', color: 0xff91c2 }, components: [{ type: 'row', items: [{ type: 'button', label: 'Yes', handler: 'yes', style: 2, data: '' }] }], reactions: ['🦋'] },
    { type: 'deleteTrigger', delay: 5 },
  ]);
  assert.equal(r.json.actions.length, 2, 'actions is still there, one sentence for each effect');
  assert.deepEqual(r.json.hints, ['.User.Nme is not in the data, so it gives nothing.'], 'hints is a list of sentences');
  r = await call('test', { code: '{{ index .Args 1 }}', args: 'a b' }); assert.equal(r.json.output, 'b', 'the arguments of the test reach the code');
  r = await call('test', { code: '{{ nope }}' }); assert.equal(r.json.error.kind, 'runtime'); assert.ok(r.json.error.message.includes('nope') && r.json.error.line === 1);
  r = await call('test', { code: '{{ lowr "A" }}' }); assert.equal(r.json.error.message, 'There is no function called "lowr". Did you mean lower?');
  assert.deepEqual(r.json.hints, ['There is no function called "lowr". Did you mean lower?'], 'a test that stops still has its hints');
  r = await call('test', { code: '{{ if }}' }); assert.equal(r.json.error.kind, 'syntax'); assert.deepEqual(r.json.hints, []);
  r = await call('test', { code: '{{ range seq 0 1000 }}{{ range seq 0 1000 }}x{{ end }}{{ end }}' }); assert.equal(r.json.error.kind, 'limit');
  r = await call('test', { code: '{{ .Trigger }}|{{ .Button.ID }}|{{ index .Values 0 }}{{ respond "ok" true }}', trigger: 'select', handler: 'pick', value: 'sushi' });
  assert.equal(r.json.output, 'select|pick|sushi'); assert.deepEqual(r.json.actions, ['answer the click with "ok" (only for who clicked)']);
  assert.deepEqual(r.json.effects, [{ type: 'respond', content: 'ok', ephemeral: true }]);
  r = await call('test', { code: '{{ respond "ok" }}' }); assert.ok(r.json.error.message.includes('button or a menu'), 'a click can only be answered in a click test');
  assert.equal(store.size, 0, 'a test saves nothing');

  // Saving.
  r = await call('save', { name: 'Greet', code: 'Hi {{ .User.Username }}' });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true, created: true });
  assert.equal(store.get(`${guild.id}:greet`).code, 'Hi {{ .User.Username }}'); assert.equal(store.get(`${guild.id}:greet`).createdBy, 'tester');
  r = await call('save', { name: 'greet', code: 'Hi again\r\nsecond line' }); assert.equal(r.json.created, false);
  assert.equal(store.get(`${guild.id}:greet`).code, 'Hi again\nsecond line', 'windows line breaks are cleaned');
  r = await call('save', { name: 'ping', code: 'x' }); assert.equal(r.status, 400); assert.equal(r.json.field, 'name'); assert.ok(r.json.message.includes('real command'));
  r = await call('save', { name: 'bad name!', code: 'x' }); assert.equal(r.status, 400); assert.ok(r.json.message.includes('1 to 32'));
  r = await call('save', { name: 'broken', code: '{{ if }}' }); assert.equal(r.status, 400); assert.equal(r.json.field, 'code'); assert.equal(store.has(`${guild.id}:broken`), false, 'code with a mistake is not saved');
  // Triggers.
  r = await call('trigger', { name: 'greet', type: 'prefix', text: '?' }); assert.equal(r.status, 200); assert.equal(store.get(`${guild.id}:greet`).trigger_type, 'prefix');
  r = await call('trigger', { name: 'greet', type: 'nope', text: 'x' }); assert.equal(r.status, 400);
  r = await call('trigger', { name: 'missing', type: 'command' }); assert.equal(r.status, 400); assert.ok(r.json.message.includes('does not exist'));

  // Everyone who manages the server writes and tests, until it is turned off.
  r = await call('test', { code: 'ok' }, 'someone'); assert.equal(r.status, 200, 'anyone who manages the server can');
  settings.codeCommandsDisabled = true;
  for (const [route, body] of [['test', { code: 'x' }], ['save', { name: 'x', code: 'x' }], ['trigger', { name: 'greet', type: 'command' }]]) {
    r = await call(route, body, 'someone');
    assert.equal(r.status, 403, route); assert.equal(r.json.error, 'turned_off');
  }
  assert.equal(store.has(`${guild.id}:x`), false);
  settings.codeCommandsDisabled = false;

  // The number of commands follows the plan: Free 50, Premium 100.
  r = await call('meta'); assert.equal(r.json.limits.commands, 50); assert.equal(r.json.limits.premium, false);
  for (let n = store.size; n < 50; n += 1) store.set(`${guild.id}:fill${n}`, { name: `fill${n}`, code: 'x', trigger_type: 'command' });
  r = await call('save', { name: 'one-more', code: 'ok' }); assert.equal(r.status, 400); assert.ok(r.json.message.includes('maximum of 50') && r.json.message.includes('Premium raises it to 100'), 'a Free server is full at 50');
  premiumActive = true;
  r = await call('meta'); assert.equal(r.json.limits.commands, 100); assert.equal(r.json.limits.premium, true);
  r = await call('save', { name: 'one-more', code: 'ok' }); assert.equal(r.status, 200, 'Premium has room up to 100');

  server.close();
  console.log('Checked the routes of commands in code for the dashboard: the editor pieces, checking, testing, saving, triggers and who may use them.');
})().catch((error) => { console.error(error); process.exit(1); });
