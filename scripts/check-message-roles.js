// Checks the roles given at a number of messages (src/db/messageRoles.ts, utils/messageRoles.ts, the job, the event and /messagerole): the rules are checked before they are saved, who reaches a rule
// and what is given or taken away (one role of two rules stays while one holds), the counting in batches (what is written, what is kept when the write fails), the roles that Petto cannot give,
// the roles taken from a `period` rule, and the places where it is all connected. The database and Discord are replaced: nothing leaves this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
process.env.PETTO_MESSAGE_ROLES_GAP_MS = '0';
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) { failed += 1; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

// ---- the rules before they are saved (the real module) ----
const store = require('../src/db/messageRoles');
const norm = (rule) => store.normalize({ roleId: '1', ...rule });
check('rule: total', (() => { const r = norm({ messages: 100 }); return r.ok && r.rule.mode === 'total' && r.rule.periodDays === 0 && r.rule.removeBelow === false; })());
check('rule: total never takes the role away', norm({ messages: 100, removeBelow: true }).rule.removeBelow === false);
check('rule: a period makes it a period', (() => { const r = norm({ messages: 50, periodDays: 7 }); return r.ok && r.rule.mode === 'period' && r.rule.periodDays === 7 && r.rule.removeBelow === false; })());
check('rule: period with remove below', norm({ messages: 50, mode: 'period', periodDays: 30, removeBelow: true }).rule.removeBelow === true);
check('rule: messages out of range', ['0', '-1', '1.5', String(store.MAX_MESSAGES + 1), 'x'].every((n) => norm({ messages: Number(n) }).reason === 'messages'));
check('rule: period out of range', norm({ messages: 5, mode: 'period', periodDays: 0 }).reason === 'period' && norm({ messages: 5, periodDays: store.MAX_PERIOD_DAYS + 1 }).reason === 'period');
check('rule: limits', store.MAX_RULES === 25 && store.MAX_PERIOD_DAYS === 365);

// ---- from here the rules come from a stand-in, and the counts from a stand-in database ----
let rules = [];
const dbPath = require.resolve('../src/db/messageRoles.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { ...store, rulesOf: async () => rules } };
delete require.cache[require.resolve('../src/utils/messageRoles.js')];
const mr = require('../src/utils/messageRoles');
const R = (over) => ({ id: 1, roleId: 'r1', messages: 100, mode: 'total', periodDays: 0, removeBelow: false, enabled: true, ...over });
const C = (total, periods = {}) => ({ total, periods: new Map(Object.entries(periods).map(([d, n]) => [Number(d), n])) });

check('qualifies: total', mr.qualifies(R(), C(100)) && !mr.qualifies(R(), C(99)));
check('qualifies: period uses its own days', mr.qualifies(R({ mode: 'period', periodDays: 7, messages: 10 }), C(5, { 7: 10 })) && !mr.qualifies(R({ mode: 'period', periodDays: 7, messages: 10 }), C(500, { 30: 500 })));
let d = mr.changesFor(new Set(), [R()], C(120));
check('changes: gives the role', d.add.length === 1 && d.add[0].roleId === 'r1' && d.remove.length === 0);
check('changes: does not give it twice', mr.changesFor(new Set(['r1']), [R()], C(120)).add.length === 0);
check('changes: a total rule never takes it', mr.changesFor(new Set(['r1']), [R()], C(0)).remove.length === 0);
const per = R({ mode: 'period', periodDays: 7, messages: 10, removeBelow: true });
check('changes: a period rule with remove below takes it', mr.changesFor(new Set(['r1']), [per], C(0, { 7: 3 })).remove.length === 1);
check('changes: without remove below it stays', mr.changesFor(new Set(['r1']), [{ ...per, removeBelow: false }], C(0, { 7: 3 })).remove.length === 0);
check('changes: a role of two rules stays while one holds', mr.changesFor(new Set(['r1']), [per, R({ id: 2, messages: 20 })], C(25, { 7: 3 })).remove.length === 0);
check('changes: two rules of one role give it once', mr.changesFor(new Set(), [R(), R({ id: 2, messages: 50 })], C(500)).add.length === 1);
check('changes: a rule that is off does nothing', mr.changesFor(new Set(), [R({ enabled: false })], C(500)).add.length === 0 && mr.changesFor(new Set(['r1']), [{ ...per, enabled: false }], C(0, { 7: 0 })).remove.length === 0);
check('changes: another role is not touched', (() => { const x = mr.changesFor(new Set(['other']), [R()], C(500)); return x.add.length === 1 && x.remove.length === 0; })());

// ---- the counting ----
mr.forgetPending();
const NOW = new Date('2026-11-19T10:00:00Z');
mr.countMessage('g1', 'u1', NOW); mr.countMessage('g1', 'u1', NOW); mr.countMessage('g1', 'u2', NOW); mr.countMessage('g1', 'u1', new Date('2026-11-20T01:00:00Z'));
check('counting: one row for each member and day', mr.pendingCount() === 3);
check('counting: a burst asks for a flush', (() => { mr.forgetPending(); let hit = false; for (let i = 0; i < 20_000; i += 1) hit = mr.countMessage('gx', `u${i}`, NOW) || hit; mr.forgetPending(); return hit; })());

function makeGuild({ id = 'g1', members = {}, roles = { r1: 5, r2: 50 }, top = 10 } = {}) {
  const guild = { id, memberCount: Object.keys(members).length, client: null,
    roles: { cache: new Map(Object.entries(roles).map(([rid, position]) => [rid, { id: rid, position, managed: false }])) } };
  const made = new Map();
  for (const [uid, held] of Object.entries(members)) {
    const roleSet = new Set(held);
    const log = [];
    made.set(uid, { id: uid, user: { bot: false }, log, roles: { cache: { has: (r) => roleSet.has(r), keys: () => roleSet.keys() }, add: async (r, why) => { roleSet.add(r); log.push(['add', r, why]); }, remove: async (r, why) => { roleSet.delete(r); log.push(['remove', r, why]); } } });
  }
  guild.members = { me: { roles: { highest: { position: top } } }, cache: made, fetch: async (id) => (id ? made.get(id) ?? null : made) };
  return guild;
}
const makeClient = (guild) => { const client = { guilds: { cache: new Map([[guild.id, guild]]) } }; guild.client = client; return client; };
const makeQuery = ({ totals = {}, period = {}, failWrites = false } = {}) => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === mr.SQL.totals) { if (failWrites) throw new Error('down'); return { rows: params[1].map((u, i) => ({ guild_id: params[0][i], user_id: u, messages: (totals[u] ?? 0) + params[2][i] })) }; }
    if (sql === mr.SQL.days) { if (failWrites) throw new Error('down'); return { rows: [] }; }
    if (sql === mr.SQL.period) return { rows: params[1].filter((u) => period[u] !== undefined).map((u) => ({ user_id: u, n: period[u] })) };
    if (sql === mr.SQL.total) return { rows: params[1].filter((u) => totals[u] !== undefined).map((u) => ({ user_id: u, messages: totals[u] })) };
    return { rows: [] };
  };
  return { calls, query };
};

(async () => {
  // a flush: what is written and who gets the role
  rules = [R({ messages: 100 }), R({ id: 2, roleId: 'r2', messages: 10 })];
  let guild = makeGuild({ members: { u1: [], u2: [] } }); let client = makeClient(guild);
  let { calls, query } = makeQuery({ totals: { u1: 99, u2: 3 } });
  mr.forgetPending(); mr.countMessage('g1', 'u1', NOW); mr.countMessage('g1', 'u1', NOW); mr.countMessage('g1', 'u2', NOW);
  let changes = await mr.flush(client, query);
  check('flush: two statements for everything', calls.filter((c) => c.sql === mr.SQL.totals).length === 1 && calls.filter((c) => c.sql === mr.SQL.days).length === 1);
  check('flush: the totals go in together', JSON.stringify(calls[0].params) === JSON.stringify([['g1', 'g1'], ['u1', 'u2'], [2, 1]]), JSON.stringify(calls[0].params));
  check('flush: the member who reaches the rule gets the role', guild.members.cache.get('u1').log.length === 1 && guild.members.cache.get('u1').log[0][1] === 'r1' && changes === 1);
  check('flush: the one who does not reach it gets nothing', guild.members.cache.get('u2').log.length === 0);
  check('flush: the reason says the messages', /100 messages/.test(guild.members.cache.get('u1').log[0][2]));
  check('flush: nothing left to write', mr.pendingCount() === 0 && (await mr.flush(client, query)) === 0);

  // a failed write keeps the counts
  mr.forgetPending(); mr.countMessage('g1', 'u1', NOW); mr.countMessage('g1', 'u1', NOW);
  ({ query } = makeQuery({ failWrites: true }));
  await mr.flush(client, query);
  check('flush: a failed write keeps the counts', mr.pendingCount() === 1);
  mr.forgetPending();

  // a role Petto cannot give
  rules = [R({ roleId: 'high', messages: 1 })];
  guild = makeGuild({ members: { u1: [] }, roles: { high: 99 }, top: 10 }); client = makeClient(guild);
  ({ query } = makeQuery({ totals: { u1: 0 } }));
  mr.countMessage('g1', 'u1', NOW);
  check('flush: a role above Petto is not given and nothing breaks', (await mr.flush(client, query)) === 0 && guild.members.cache.get('u1').log.length === 0);

  // a bot is never given a role
  rules = [R({ messages: 1 })];
  guild = makeGuild({ members: { b1: [] } }); guild.members.cache.get('b1').user.bot = true; client = makeClient(guild);
  ({ query } = makeQuery());
  mr.countMessage('g1', 'b1', NOW);
  check('flush: bots get nothing', (await mr.flush(client, query)) === 0);

  // the look that takes roles away
  rules = [R({ mode: 'period', periodDays: 7, messages: 10, removeBelow: true })];
  guild = makeGuild({ members: { keep: ['r1'], lose: ['r1'], none: [] } }); client = makeClient(guild);
  ({ calls, query } = makeQuery({ period: { keep: 12, lose: 4 } }));
  changes = await mr.runGuild(guild, query);
  check('removals: takes the role from who fell under', guild.members.cache.get('lose').log.length === 1 && guild.members.cache.get('lose').log[0][0] === 'remove' && changes === 1);
  check('removals: keeps it for who holds the number', guild.members.cache.get('keep').log.length === 0);
  check('removals: only members who hold the role are looked at', calls.every((c) => c.sql !== mr.SQL.period || (c.params[1].includes('keep') && c.params[1].includes('lose') && !c.params[1].includes('none'))));
  rules = [R({ mode: 'period', periodDays: 7, messages: 10, removeBelow: false })];
  guild = makeGuild({ members: { lose: ['r1'] } }); makeClient(guild);
  check('removals: a rule without remove below does nothing', (await mr.runGuild(guild, query)) === 0);

  // ---- where it is connected ----
  const schema = read('src/db/schema.sql');
  check('schema: the three tables, with row level security and the server', /create table if not exists message_roles \(/.test(schema) && /create table if not exists message_role_totals \(/.test(schema) && /create table if not exists message_role_days \(/.test(schema)
    && ['message_roles', 'message_role_totals', 'message_role_days'].every((t) => new RegExp(`alter table ${t} enable row level security;`).test(schema)) && /unique \(guild_id, role_id, messages, mode, period_days\)/.test(schema));
  check('schema: the rows of a period rule and a total rule', /check \(\(mode = 'total' and period_days = 0 and remove_below = false\) or \(mode = 'period' and period_days >= 1\)\)/.test(schema));
  check('cache: the table is known', /'message_roles'/.test(read('src/utils/cacheInvalidation.js')));
  check('job: started and listed', /startMessageRolesJob\(client\);/.test(read('index.js')) && /'messageRolesJob'/.test(read('src/utils/loadGuard.js')));
  const event = require('../src/events/messageCreateMessageRoles');
  check('event: a message of a server', event.name === 'messageCreate' && typeof event.execute === 'function');
  const command = require('../src/commands/welcome/messagerole');
  const json = command.data.toJSON();
  check('command: add, remove and list', json.name === 'messagerole' && json.options.map((o) => o.name).join() === 'add,remove,list' && String(json.default_member_permissions) === '268435456');
  check('command: the options of add', json.options[0].options.map((o) => `${o.name}${o.required ? '*' : ''}`).join() === 'role*,messages*,period_days,remove_below');
  check('command: its alias', command.aliases.includes('msgrole'));
  check('sql: the period looks at the last days only', /day > \(now\(\) at time zone 'utc'\)::date - \$3::int/.test(mr.SQL.period) && /366/.test(mr.SQL.prune));

  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('message-roles: ok');
})().catch((error) => { console.error(error); process.exit(1); });
