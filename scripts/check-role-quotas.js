// Checks the role quotas: the validation of a rule, how a period is judged (met, missed, excused, new), the strikes, and closing a period (who loses the role, who is told,
// what the report says) with a replaced database and Discord.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const quotasDb = require('../src/db/roleQuotas');
const dmOrigin = require('../src/utils/dmOrigin');
const dmEntries = [];
dmOrigin.sendDm = async (target) => { dmEntries.push(target.id); }; // the members of this check have no DMs: what is counted is what the code tried
const quotas = require('../src/utils/roleQuotas');
const { PermissionFlagsBits } = require('discord.js');

const GUILD = '111111111111111111';
const ROLE = '222222222222222222';
const DAY = 86_400_000;

(async () => {
  // ---- validation
  const role = { id: ROLE, managed: false };
  const good = quotas.validateRule({ role, guildId: GUILD, messages: 50 });
  assert.deepEqual(good, { ok: true, rule: { roleId: ROLE, periodDays: 7, minMessages: 50, maxStrikes: 3, notifyDm: true, reportChannelId: null } }, 'the defaults: a week, 3 in a row, DMs on');
  const bad = (extra) => quotas.validateRule({ role, guildId: GUILD, messages: 50, ...extra });
  assert.equal(quotas.validateRule({ role: null, guildId: GUILD, messages: 5 }).error, 'noRole');
  assert.equal(quotas.validateRule({ role: { id: GUILD, managed: false }, guildId: GUILD, messages: 5 }).error, 'everyone');
  assert.equal(quotas.validateRule({ role: { id: ROLE, managed: true }, guildId: GUILD, messages: 5 }).error, 'managed');
  assert.equal(bad({ messages: 0 }).error, 'badMessages');
  assert.equal(bad({ messages: 100_001 }).error, 'badMessages');
  assert.equal(bad({ messages: 2.5 }).error, 'badMessages');
  assert.equal(bad({ periodDays: 0 }).error, 'badPeriod');
  assert.equal(bad({ periodDays: 91 }).error, 'badPeriod');
  assert.equal(bad({ strikes: 21 }).error, 'badStrikes');
  assert.equal(bad({ reportChannelId: 'general' }).error, 'badChannel');
  assert.equal(bad({ existingRoleIds: Array.from({ length: 25 }, (_, i) => String(i)) }).error, 'tooMany', 'at most 25 quotas');
  assert.equal(bad({ existingRoleIds: [ROLE, ...Array.from({ length: 24 }, (_, i) => String(i))] }).ok, true, 'changing one that exists is not a new one');

  // ---- judging
  const rule = { min_messages: 10, max_strikes: 3 };
  const start = new Date(Date.now() - 7 * DAY).toISOString();
  const now = Date.now();
  assert.equal(quotas.judge({ messages: 10 }, rule, start, now), 'met', 'exactly the quota is enough');
  assert.equal(quotas.judge({ messages: 9 }, rule, start, now), 'missed');
  assert.equal(quotas.judge(null, rule, start, now), 'missed', 'nothing known about them: they sent nothing');
  assert.equal(quotas.judge({ messages: 0, excused_until: new Date(now + DAY).toISOString() }, rule, start, now), 'excused');
  assert.equal(quotas.judge({ messages: 0, excused_until: new Date(now - DAY).toISOString() }, rule, start, now), 'missed', 'a time off that ended does not count');
  assert.equal(quotas.judge({ messages: 0, since: new Date(now - DAY).toISOString() }, rule, start, now), 'new', 'given the role during the period');
  assert.equal(quotas.judge({ messages: 0, since: new Date(now - 8 * DAY).toISOString() }, rule, start, now), 'missed', 'given before the period began');

  // ---- strikes
  assert.deepEqual(quotas.applyResult(0, 'missed', 3), { strikes: 1, remove: false });
  assert.deepEqual(quotas.applyResult(2, 'missed', 3), { strikes: 3, remove: true }, 'the third in a row');
  assert.deepEqual(quotas.applyResult(2, 'met', 3), { strikes: 0, remove: false }, 'a period met clears them');
  assert.deepEqual(quotas.applyResult(2, 'excused', 3), { strikes: 2, remove: false });
  assert.deepEqual(quotas.applyResult(2, 'new', 3), { strikes: 2, remove: false });
  assert.deepEqual(quotas.applyResult(undefined, 'missed', 1), { strikes: 1, remove: true });

  // ---- closing a period
  const calls = { saved: null, forgot: null, closed: null, dms: [], removed: [], posted: [] };
  const original = { ...quotasDb };
  const rows = [
    { user_id: 'met', messages: 12, strikes: 2 },
    { user_id: 'miss1', messages: 3, strikes: 0 },
    { user_id: 'miss3', messages: 1, strikes: 2 },
    { user_id: 'excused', messages: 0, strikes: 1, excused_until: new Date(now + DAY).toISOString() },
    { user_id: 'fresh', messages: 0, strikes: 0, since: new Date(now - DAY).toISOString() },
    { user_id: 'left', messages: 4, strikes: 1 },
  ];
  quotasDb.listMembers = async () => rows;
  quotasDb.saveResults = async (_g, _r, saved) => { calls.saved = saved; };
  quotasDb.forgetMembers = async (_g, _r, ids) => { calls.forgot = ids; };
  quotasDb.closePeriod = async (_rule, result) => { calls.closed = result; };

  const member = (id) => ({ id, user: { bot: false }, roles: { remove: async () => { calls.removed.push(id); } } });
  const holders = ['met', 'miss1', 'miss3', 'excused', 'fresh', 'newcomer'].map(member);
  const roleObject = { id: ROLE, name: 'Staff', members: new Map(holders.map((each) => [each.id, each])) };
  const posted = [];
  const guild = {
    id: GUILD, name: 'Petto HQ', memberCount: 10,
    roles: { cache: new Map([[ROLE, roleObject]]) },
    members: { fetch: async () => null, cache: new Map(holders.map((each) => [each.id, each])), me: { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { comparePositionTo: () => 1 } } } },
    channels: { cache: new Map([['333333333333333333', { isTextBased: () => true, send: async (payload) => { posted.push(JSON.stringify(payload.components[0].toJSON())); } }]]) },
  };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } };
  const dueRule = { guild_id: GUILD, role_id: ROLE, period_days: 7, min_messages: 10, max_strikes: 3, notify_dm: true, report_channel_id: '333333333333333333', period_started_at: start };
  const result = await quotas.closeRule(client, dueRule, { now: new Date(now), sleep: async () => {} });

  assert.deepEqual(result, { met: 1, missed: 3, removed: 1, failed: 0, excused: 1, fresh: 1 }, 'one met, three below (one of them has no row: it sent nothing), one loses the role, one is excused, one is new');
  assert.deepEqual(calls.removed, ['miss3'], 'the role goes only from who reached the third strike in a row');
  assert.deepEqual(calls.saved.map((row) => [row.userId, row.strikes, row.lastResult]).sort(), [['excused', 1, 'excused'], ['fresh', 0, 'new'], ['met', 0, 'met'], ['miss1', 1, 'missed'], ['newcomer', 1, 'missed']], 'the strikes and the result of each; the one who lost the role is not kept');
  assert.deepEqual([...calls.forgot].sort(), ['left', 'miss3'], 'who left the role, and who lost it, are forgotten');
  assert.deepEqual([calls.closed.met, calls.closed.missed, calls.closed.removed], [1, 3, 1], 'the counts of the period are kept for the dashboard');
  assert.deepEqual([...dmEntries].sort(), ['miss1', 'miss3', 'newcomer'], 'who fell short, and who lost the role, are told; the others are not');
  assert.equal(posted.length, 1, 'one report');
  assert.ok(posted[0].includes('Staff') === false && posted[0].includes(`<@&${ROLE}>`) && posted[0].includes('<@miss3>') && posted[0].includes('Met: **1**'), 'the report says the role, who lost it and the totals');

  // Petto below the role (or without Manage Roles): nobody loses it, the strikes stay at the limit so the next period tries again, and the report says who.
  calls.removed.length = 0; calls.saved = null; posted.length = 0; dmEntries.length = 0;
  guild.members.me.roles.highest.comparePositionTo = () => -1;
  const blocked = await quotas.closeRule(client, dueRule, { now: new Date(now), sleep: async () => {} });
  assert.equal(blocked.removed, 0);
  assert.equal(blocked.failed, 1);
  assert.deepEqual(calls.removed, []);
  assert.equal(calls.saved.find((row) => row.userId === 'miss3').strikes, 3, 'kept at the limit');
  assert.ok(posted[0].includes('<@miss3>') && posted[0].includes('could not take the role away'), 'the report says Petto could not');

  // A server that is not reachable now: nothing is judged and the period stays open.
  assert.equal(await quotas.closeRule({ guilds: { cache: new Map() } }, dueRule), null);

  // The rest of the pieces are in place.
  Object.assign(quotasDb, original);
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(/role_quotas/.test(read('src/db/schema.sql')) && /role_quota_members/.test(read('src/db/schema.sql')), 'the tables');
  assert.ok(/startRoleQuotaJob\(client\)/.test(read('index.js')), 'the job starts');
  assert.ok(!/content/.test(read('src/db/roleQuotas.js').replace(/content-type/g, '')), 'nothing about what was said is kept');
  console.log('Role quota checks passed (rules, judging, strikes, closing a period, the report).');
})().catch((err) => { console.error(err); process.exit(1); });
