// Checks the moderation rules against a real PostgreSQL database: what the dashboard saves is read by the engine, a message that matches gets the effects,
// the threshold holds the sanctions back, the log keeps what happened and never the text, and the rules go with the server. It runs when
// PETTO_TEST_DATABASE_URL points to a test database, and is skipped otherwise. A fake message stands for Discord.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the moderation rules database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const { runModRules } = require('../src/utils/modRulesEngine');
const store = require('../src/db/modRules');
const { cleanRule } = require('../src/utils/modRules');

const G = '9200000000000000001';
const message = (content, patch = {}) => {
  const calls = { deleted: 0, sent: [], rolesAdded: [] };
  return {
    calls,
    id: 'm1', content, channelId: '555', author: { id: '777', bot: false, username: 'someone', createdTimestamp: Date.now() - 400 * 86_400_000 },
    guild: { id: G, name: 'Test', channels: { cache: new Map() }, roles: { cache: new Map([['900000000000000001', { id: '900000000000000001', editable: true }]]) } },
    member: { permissions: { has: () => false }, roles: { cache: new Map(), add: async (role) => { calls.rolesAdded.push(role.id); } }, joinedTimestamp: Date.now() - 10 * 86_400_000 },
    mentions: { users: new Map(), roles: new Map(), everyone: false }, attachments: new Map(),
    channel: { parentId: null, send: async (o) => { calls.sent.push(o.content); return { delete: async () => {} }; } },
    delete: async () => { calls.deleted += 1; },
    ...patch,
  };
};

(async () => {
  const pool = getPrimaryPool();
  const clean = async () => { await pool.query("delete from guilds where guild_id = $1", [G]); };
  await clean();
  await pool.query('insert into guilds (guild_id) values ($1)', [G]);
  const set = (await pool.query("insert into mod_rulesets (guild_id, name) values ($1, 'Main') returning id", [G])).rows[0].id;
  const list = (await pool.query("insert into mod_lists (guild_id, name, kind, items) values ($1, 'Bad', 'words', array['badword']) returning id", [G])).rows[0].id;
  const make = async (raw) => {
    const result = cleanRule(raw);
    assert.equal(result.ok, true, JSON.stringify(result));
    const r = result.rule;
    return (await pool.query('insert into mod_rules (guild_id, ruleset_id, name, trigger_mode, triggers, conditions, effects, threshold_count, threshold_minutes, stop) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
      [G, set, r.name, r.trigger_mode, JSON.stringify(r.triggers), JSON.stringify(r.conditions), JSON.stringify(r.effects), r.threshold_count, r.threshold_minutes, r.stop])).rows[0].id;
  };
  const ruleId = await make({ name: 'Bad words', triggers: [{ type: 'words', list_id: list, match: 'word' }], effects: [{ type: 'delete' }, { type: 'reply', text: 'Hey {user}, mind your words.', delete_after: 5 }, { type: 'add_role', role_id: '900000000000000001' }], threshold_count: 2, threshold_minutes: 5 });
  store.forget(G);

  // A message with nothing to find is left alone.
  const clean1 = message('hello there');
  await runModRules(clean1);
  assert.deepEqual([clean1.calls.deleted, clean1.calls.sent.length], [0, 0]);

  // The first match: the quick effects happen, the role (a sanction) waits for the second match.
  const first = message('what a BADWORD');
  await runModRules(first);
  assert.equal(first.calls.deleted, 1, 'the message is deleted');
  assert.deepEqual(first.calls.sent, ['Hey <@777>, mind your words.'], 'the reply names the member');
  assert.deepEqual(first.calls.rolesAdded, [], 'the role waits for the threshold');
  const second = message('badword again');
  await runModRules(second);
  assert.deepEqual(second.calls.rolesAdded, ['900000000000000001'], 'the second match in the window reaches the threshold');

  // Staff are left alone, and a server with the rules off too.
  const staff = message('badword', { member: { ...message('').member, permissions: { has: () => true } } });
  await runModRules(staff);
  assert.equal(staff.calls.deleted, 0, 'a moderator is not touched');
  await pool.query('insert into mod_rule_settings (guild_id, enabled) values ($1, false)', [G]);
  store.forget(G);
  const off = message('badword');
  await runModRules(off);
  assert.equal(off.calls.deleted, 0, 'the rules can be switched off');
  await pool.query('delete from mod_rule_settings where guild_id = $1', [G]);
  store.forget(G);

  // A rule with a condition: only in the channel the ruleset says.
  await pool.query("update mod_rulesets set conditions = $2 where id = $1", [set, JSON.stringify([{ type: 'channel', mode: 'not_in', ids: ['555'] }])]);
  store.forget(G);
  const exempt = message('badword');
  await runModRules(exempt);
  assert.equal(exempt.calls.deleted, 0, 'the ruleset leaves out the channel');
  await pool.query("update mod_rulesets set conditions = '[]' where id = $1", [set]);
  store.forget(G);

  // The log: what happened, never the text.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logs = (await pool.query('select * from mod_rule_logs where guild_id = $1 order by id', [G])).rows;
  assert.equal(logs.length >= 2, true);
  assert.equal(logs[0].rule_name, 'Bad words');
  assert.equal(logs[0].trigger, 'words:badword');
  assert.deepEqual(logs[0].effects, ['delete', 'reply']);
  assert.ok(!JSON.stringify(logs).includes('what a'), 'the text of the message is not kept');
  assert.equal(Number((await pool.query('select hits from mod_rules where id = $1', [ruleId])).rows[0].hits) >= 2, true, 'the hits are counted');

  // The rules go with the server.
  await pool.query('delete from guilds where guild_id = $1', [G]);
  for (const table of ['mod_rulesets', 'mod_rules', 'mod_lists', 'mod_rule_logs', 'mod_rule_settings']) {
    assert.equal(Number((await pool.query(`select count(*) from ${table} where guild_id = $1`, [G])).rows[0].count), 0, `${table} goes with the server`);
  }
  await closePools();
  console.log('check-mod-rules-db: ok');
})().catch((error) => { console.error(error); process.exit(1); });
