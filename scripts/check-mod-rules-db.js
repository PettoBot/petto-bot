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
    id: 'm1', content, channelId: '555', webhookId: null, client: { user: { id: '1489' } }, author: { id: '777', bot: false, username: 'someone', createdTimestamp: Date.now() - 400 * 86_400_000 },
    guild: { id: G, name: 'Test', channels: { cache: new Map() }, roles: { cache: new Map([['900000000000000001', { id: '900000000000000001', editable: true }]]) } },
    member: { nickname: null, displayName: 'someone', permissions: { has: () => false }, roles: { cache: new Map(), add: async (role) => { calls.rolesAdded.push(role.id); } }, joinedTimestamp: Date.now() - 10 * 86_400_000 },
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

  // Test mode: the rule is looked at and logged, and nothing is done.
  await pool.query('update mod_rules set dry_run = true where id = $1', [ruleId]);
  store.forget(G);
  const dry = message('badword in test mode');
  await runModRules(dry);
  assert.deepEqual([dry.calls.deleted, dry.calls.sent.length, dry.calls.rolesAdded.length], [0, 0, 0], 'a rule in test mode does nothing');
  await pool.query('update mod_rules set dry_run = false where id = $1', [ruleId]);
  store.forget(G);

  // A message that is edited is looked at again, but an edit does not count for the speed of the member.
  const edited = message('badword added by an edit');
  await runModRules(edited, { edited: true });
  assert.equal(edited.calls.deleted, 1, 'an edited message is checked too');

  // Bots are left alone unless the server says otherwise.
  const bot = message('badword', { author: { id: '778', bot: true, username: 'bot', createdTimestamp: Date.now() - 400 * 86_400_000 } });
  await runModRules(bot);
  assert.equal(bot.calls.deleted, 0, 'a bot is not touched by default');

  // Strikes: a rule adds a violation to a counter, and another rule acts when the counter is high enough, with a timeout that grows.
  await pool.query('delete from mod_rules where guild_id = $1', [G]);
  const strike = await make({ name: 'Count invites', triggers: [{ type: 'invites' }], effects: [{ type: 'delete' }, { type: 'violation', name: 'invites' }], stop: false });
  await make({ name: 'Too many strikes', triggers: [{ type: 'violations', name: 'invites', count: 3, minutes: 60 }], effects: [{ type: 'reply', text: 'Enough, {user}.', delete_after: 0 }] });
  store.forget(G);
  const attempts = [];
  for (let i = 0; i < 3; i += 1) { const m1 = message(`join discord.gg/abc${i}`); await runModRules(m1); attempts.push(m1.calls); }
  assert.deepEqual(attempts.map((c) => c.sent.length), [0, 0, 1], 'the second rule reads the counter after the first one wrote it: the third invite is the third strike');
  const fourth = message('discord.gg/zzz');
  await runModRules(fourth);
  assert.deepEqual(fourth.calls.sent, ['Enough, <@777>.'], 'and it keeps speaking while the counter is high (the counter is in the database)');
  assert.equal(await store.countViolations(G, '777', 'invites', 60), 4);
  await store.resetViolations(G, '777', 'invites');
  assert.equal(await store.countViolations(G, '777', 'invites', 60), 0, 'a counter can be reset');
  assert.ok(strike);

  // Heat rises with what a member does and falls by itself.
  assert.equal(await store.getHeat(G, '777', 10), 0);
  assert.equal(await store.addHeat(G, '777', 60, 10), 60);
  assert.ok(Math.abs((await store.addHeat(G, '777', 50, 10)) - 110) < 0.5, 'it adds up');
  await pool.query("update mod_rule_heat set updated_at = now() - interval '5 minutes' where guild_id = $1", [G]);
  const cooled = await store.getHeat(G, '777', 10);
  assert.ok(cooled > 59 && cooled < 61, 'five minutes at 10 a minute take 50 away');
  await store.resetHeat(G, '777');
  assert.equal(await store.getHeat(G, '777', 10), 0);

  // The join gate at work: a member with no avatar is kicked; many joins in a short time are a raid (an alert is written once).
  const { runJoinGate } = require('../src/utils/modJoinGate');
  await pool.query("insert into mod_rule_settings (guild_id, log_channel_id) values ($1, '3007') on conflict (guild_id) do update set log_channel_id = '3007'", [G]);
  await pool.query("delete from mod_join_gate where guild_id = $1", [G]);
  await pool.query("insert into mod_join_gate (guild_id, enabled, no_avatar_action, raid_joins, raid_seconds, raid_action) values ($1, true, 'kick', 3, 30, 'alert')", [G]);
  store.forget(G);
  const alerts = [];
  const gateGuild = { id: G, channels: { cache: new Map([['3007', { send: async (o) => { alerts.push(o.content); } }]]) }, roles: { cache: new Map() } };
  const joiner = (id, avatar) => {
    const calls = { kicked: 0 };
    return { calls, id, guild: gateGuild, displayName: 'Joiner', client: { user: { id: '1489' } }, kickable: true, moderatable: true, bannable: true,
      user: { id, avatar, bot: false, username: 'joiner', createdTimestamp: Date.now() - 400 * 86_400_000 }, kick: async () => { calls.kicked += 1; } };
  };
  const noAvatar = joiner('801', null);
  await runJoinGate(noAvatar);
  assert.equal(noAvatar.calls.kicked, 1, 'a member with no avatar is kicked');
  const withAvatar = joiner('802', 'abc');
  await runJoinGate(withAvatar);
  assert.equal(withAvatar.calls.kicked, 0, 'one with an avatar is left alone');
  await runJoinGate(joiner('803', 'abc'));
  assert.equal(alerts.length, 1, 'the third join in 30 seconds is a raid, and it is said once');
  await runJoinGate(joiner('804', 'abc'));
  assert.equal(alerts.length, 1, 'and not again while it goes on');
  await pool.query("delete from mod_join_gate where guild_id = $1", [G]);
  store.forget(G);

  // The join gate is read with the rules.
  await pool.query("insert into mod_join_gate (guild_id, enabled, no_avatar_action, raid_joins, raid_seconds) values ($1, true, 'kick', 5, 30)", [G]);
  store.forget(G);
  const loaded = await store.load(G);
  assert.deepEqual([loaded.gate.enabled, loaded.gate.no_avatar_action, loaded.gate.raid_joins], [true, 'kick', 5]);
  assert.equal(loaded.settings.heat_decay, 10, 'the default heat decay');

  // "Try this rule": what a rule would do with a sample, without doing it.
  const { testRule } = require('../src/utils/modRulesTest');
  const tried = await testRule(G, { name: 'Try', triggers: [{ type: 'words', words: ['bad'], match: 'word' }, { type: 'rate', messages: 3, seconds: 5 }], conditions: [{ type: 'account_age', max_days: 7 }], effects: [{ type: 'delete' }, { type: 'ban' }], threshold_count: 3 }, { content: 'a BAD day', account_age_days: 2 });
  assert.equal(tried.ok && tried.applies, true);
  assert.deepEqual(tried.triggers.map((x) => [x.type, x.hit !== null]), [['words', true], ['rate', false]]);
  assert.deepEqual(tried.effects, [{ type: 'delete', when: 'now' }, { type: 'ban', when: 'count' }], 'the quick effects happen at once, the ban waits for the count');
  const old = await testRule(G, { name: 'Try', triggers: [{ type: 'words', words: ['bad'], match: 'word' }], conditions: [{ type: 'account_age', max_days: 7 }], effects: [{ type: 'delete' }] }, { content: 'bad', account_age_days: 400 });
  assert.equal(old.applies, false, 'a condition that fails stops the rule');
  assert.deepEqual(old.conditions, [{ type: 'account_age', pass: false }]);
  const flood = await testRule(G, { name: 'Try', triggers: [{ type: 'rate', messages: 3, seconds: 5 }], effects: [{ type: 'timeout' }] }, { content: 'hi', times: 3 });
  assert.equal(flood.applies, true, 'sending the sample several times tries the rules about speed');
  assert.equal((await testRule(G, { name: '', triggers: [], effects: [] }, {})).ok, false, 'a rule that is not valid says so');

  // The log: what happened, never the text.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logs = (await pool.query('select * from mod_rule_logs where guild_id = $1 order by id', [G])).rows;
  assert.equal(logs.length >= 2, true);
  assert.equal(logs[0].rule_name, 'Bad words');
  assert.equal(logs[0].trigger, 'words:badword');
  assert.deepEqual(logs[0].effects, ['delete', 'reply']);
  assert.ok(logs.some((row) => (row.effects ?? []).includes('dry-run:delete')), 'what a rule in test mode would do is in the log');
  assert.ok(!JSON.stringify(logs).includes('what a'), 'the text of the message is not kept');
  

  // The rules go with the server.
  await pool.query('delete from guilds where guild_id = $1', [G]);
  for (const table of ['mod_rulesets', 'mod_rules', 'mod_lists', 'mod_rule_logs', 'mod_rule_settings', 'mod_rule_violations', 'mod_rule_heat', 'mod_join_gate']) {
    assert.equal(Number((await pool.query(`select count(*) from ${table} where guild_id = $1`, [G])).rows[0].count), 0, `${table} goes with the server`);
  }
  await closePools();
  console.log('check-mod-rules-db: ok');
})().catch((error) => { console.error(error); process.exit(1); });
