// Checks what happens to the levels of a member who leaves: by default (`keep_xp` off) the row of the member and what they earned in the weeks and months that are kept are
// DELETED (not a row of zeros), so nothing is left of them in a ranking; with `keep_xp` on the XP is kept; bots are ignored; a failure is logged and never thrown, and one table
// failing does not leave the other behind. Also `!level rules`: `keep_xp`, the old name `reset_on_leave` that still works and means the opposite, and the summary, where a server
// that wipes the XP does not say the reward roles are given back.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const levelConfig = require('../src/db/levelConfig');
const levelUsersDb = require('../src/db/levelUsers');
const levelPeriodsDb = require('../src/db/levelPeriods');
const logger = require('../src/utils/logger');
const i18n = require('../src/i18n');

// The event reads `getConfig` when it is loaded, so the fake is in place before it is.
let config = { enabled: true, keep_xp: false };
let configError = null;
levelConfig.getConfig = async () => { if (configError) throw configError; return config; };
const event = require('../src/events/guildMemberRemoveLevels');

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const member = (extra = {}) => ({ id: USER, guild: { id: GUILD }, user: { bot: false }, ...extra });

(async () => {
  const calls = [];
  const warnings = [];
  let failUsers = null;
  let failPeriods = null;
  levelUsersDb.deleteUser = async (guildId, userId) => { calls.push(['level_users', guildId, userId]); if (failUsers) throw failUsers; };
  levelPeriodsDb.deleteUser = async (guildId, userId) => { calls.push(['level_period_xp', guildId, userId]); if (failPeriods) throw failPeriods; };
  levelUsersDb.resetUser = async () => { calls.push(['resetUser']); };
  logger.warn = (...args) => warnings.push(args);
  const reset = () => { calls.length = 0; warnings.length = 0; failUsers = null; failPeriods = null; };

  // By default (also for a server that never chose) the XP is wiped: both tables are cleaned, by deleting (not by writing zeros).
  reset();
  await event.execute(member());
  assert.deepEqual(calls, [['level_users', GUILD, USER], ['level_period_xp', GUILD, USER]], 'the row and the weekly and monthly XP of the member are deleted');
  assert.ok(!calls.some((call) => call[0] === 'resetUser'), 'no row of zeros is left behind');
  assert.deepEqual(warnings, []);

  // With keep_xp on the XP is kept.
  config = { enabled: true, keep_xp: true };
  reset();
  await event.execute(member());
  assert.deepEqual(calls, [], 'a server that turned keep_xp on keeps the XP of who leaves');

  // A server with no settings row is not known: nothing is deleted.
  config = null;
  reset();
  await event.execute(member());
  assert.deepEqual(calls, [], 'without a row of settings nothing is deleted');
  config = { enabled: true, keep_xp: false };

  // A bot has no levels.
  reset();
  await event.execute(member({ user: { bot: true } }));
  assert.deepEqual(calls, [], 'bots are ignored');

  // A failure is logged and never thrown, and the other table is still cleaned.
  reset();
  failUsers = new Error('db down');
  await event.execute(member());
  assert.equal(calls.length, 2, 'the periods are cleaned even when the row could not be deleted');
  assert.match(String(warnings[0]?.[1]), /could not be wiped: db down/, 'the failure is logged');
  reset();
  failPeriods = new Error('timeout');
  await event.execute(member());
  assert.equal(calls.length, 2, 'and the other way round');
  assert.equal(warnings.length, 1);
  reset();
  configError = new Error('config down');
  await event.execute(member());
  assert.equal(warnings.length, 1, 'a server whose settings cannot be read is logged, not thrown');
  configError = null;

  // The rule: `keep_xp` is the name now; `reset_on_leave` still works, is not offered in the list and means the opposite.
  const level = require('../src/commands/leveling/level.js');
  assert.equal(typeof level.execute, 'function');
  assert.deepEqual([level.RULE_SETTINGS.keep_xp.column, Boolean(level.RULE_SETTINGS.keep_xp.invert), Boolean(level.RULE_SETTINGS.keep_xp.hidden)], ['keep_xp', false, false]);
  assert.deepEqual([level.RULE_SETTINGS.reset_on_leave.column, level.RULE_SETTINGS.reset_on_leave.invert, level.RULE_SETTINGS.reset_on_leave.hidden], ['keep_xp', true, true], 'the old name writes keep_xp, turned around, and is not listed');
  assert.equal(level.readRuleValue(level.RULE_SETTINGS.keep_xp, 'on'), true);
  assert.equal(level.readRuleValue(level.RULE_SETTINGS.reset_on_leave, 'off'), false);
  const levelSource = fs.readFileSync(path.join(__dirname, '..', 'src/commands/leveling/level.js'), 'utf8');
  assert.ok(/patch = \{ \[rule\.column\]: rule\.invert \? !value : value \}/.test(levelSource), 'the old name is turned around when it is written (`reset_on_leave on` is `keep_xp off`)');
  assert.ok(/value: 'keep_xp'/.test(levelSource) && !/value: 'reset_on_leave'/.test(levelSource), 'the list offers keep_xp and not the old name');
  assert.ok(/ALTER|alter table level_config add column if not exists keep_xp boolean not null default false/i.test(fs.readFileSync(path.join(__dirname, '..', 'src/db/schema.sql'), 'utf8')), 'keep_xp is a new column: every server starts with the default, nothing is overwritten');
  assert.equal(i18n.t('en', 'config.column.keep_xp'), 'Keep XP on leave');

  // The summary of `!level rules`: it must not promise to give back reward roles from an XP that was wiped.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/commands/leveling/level.js'), 'utf8');
  assert.ok(/restore_roles !== false && Boolean\(config\.keep_xp\)/.test(source), 'the reward roles are only "given back" when the XP is kept');
  for (const lang of ['en', 'es', 'pt-BR']) {
    for (const key of ['leaveKeep', 'leaveKeepRestore', 'leaveWipe']) assert.notEqual(i18n.t(lang, `leveling.rules.${key}`), `leveling.rules.${key}`, `${lang}: ${key} is written`);
    assert.equal(i18n.t(lang, 'leveling.rules.leaveWipeRestore'), 'leveling.rules.leaveWipeRestore', `${lang}: "wiped and given back" does not exist any more`);
  }
  assert.ok(!/give|back|devuelv|recuper|devolv|recuper/i.test(i18n.t('en', 'leveling.rules.leaveWipe')), 'the wipe line says only that the XP is wiped');

  // The database functions are in place.
  assert.equal(typeof levelUsersDb.deleteUser, 'function');
  assert.ok(/delete from level_period_xp where guild_id = \$1 and user_id = \$2/.test(fs.readFileSync(path.join(__dirname, '..', 'src/db/levelPeriods.js'), 'utf8')), 'the weekly and monthly rows of one member are deleted by guild and user');
  console.log('Level leave checks passed (deleted by default in both tables, kept with keep_xp, no row, bots, failures, the rule and its old name, the summary).');
})().catch((err) => { console.error(err); process.exit(1); });
