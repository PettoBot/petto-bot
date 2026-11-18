// Checks the moderation rules made in the dashboard (src/utils/modRules.ts): what is saved is cleaned, what each trigger finds, the conditions, the
// threshold, and that a pattern that could run for ever is refused. No Discord and no database.
const assert = require('node:assert/strict');
const m = require('../src/utils/modRules');

const facts = (patch = {}) => ({
  guildId: '1', isBot: false, isEdit: false, isThread: false, username: 'sample', nickname: null, extra: { violations: {}, heat: 0 },
  content: '', channelId: '10', parentId: null, categoryId: '20', roleIds: new Set(['30']), accountAgeDays: 400, memberAgeDays: 100,
  users: 0, roles: 0, everyone: false, attachments: [], ...patch,
});
const lists = { words: new Map([[1, ['badword', 'Café']]]), domains: new Map([[2, ['evil.com']]]) };
const KEYS = { user: 'u', channel: 'c' };
const hit = (trigger, patch, recent = new m.Recent(), now = 1000) => m.matchTrigger(trigger, facts(patch), lists, recent, KEYS, now);

// What is saved is cleaned.
assert.equal(m.cleanRule({ name: '', triggers: [{ type: 'invites' }], effects: [{ type: 'delete' }] }).ok, false, 'a rule needs a name');
assert.equal(m.cleanRule({ name: 'x', triggers: [], effects: [{ type: 'delete' }] }).error, 'triggers');
assert.equal(m.cleanRule({ name: 'x', triggers: [{ type: 'invites' }], effects: [{ type: 'nope' }] }).error, 'effects');
const cleaned = m.cleanRule({ name: ' Spam ', triggers: [{ type: 'mentions', max: 9999, kind: 'x' }, { type: 'nope' }], effects: [{ type: 'timeout', minutes: 999999 }, { type: 'add_role', role_id: 'abc' }], threshold_count: 500 });
assert.equal(cleaned.ok, true);
assert.deepEqual(cleaned.rule.triggers, [{ type: 'mentions', kind: 'any', max: 100 }], 'a bad trigger is dropped and numbers are limited');
assert.deepEqual(cleaned.rule.effects, [{ type: 'timeout', minutes: 40320, multiplier: 1, max_minutes: 40320, window_hours: 168 }], 'a role effect with no real role is dropped');
assert.equal(cleaned.rule.threshold_count, 50);
assert.equal(m.cleanRule({ name: 'r', triggers: [{ type: 'regex', pattern: '(a+)+$' }], effects: [{ type: 'delete' }] }).error, 'triggers', 'a pattern that can run for ever is refused');
assert.equal(m.safeRegex('(?<=a)b'), null);
assert.ok(m.safeRegex('disc[o0]rd\\.gg'));

// Words: inside a word, whole words, and exact; no accents and no case.
assert.equal(hit({ type: 'words', list_id: 1, words: [], match: 'word' }, { content: 'You said BADWORD!' }), 'words:badword');
assert.equal(hit({ type: 'words', list_id: 1, words: [], match: 'word' }, { content: 'a badwords here' }), null, 'a whole word is not a part of another');
assert.equal(hit({ type: 'words', list_id: 1, words: [], match: 'contains' }, { content: 'a badwords here' }), 'words:badword');
assert.equal(hit({ type: 'words', list_id: 1, words: [], match: 'word' }, { content: 'un cafe' }), 'words:cafe', 'accents do not matter');
assert.equal(hit({ type: 'words', words: ['ok'], match: 'exact' }, { content: ' OK ' }), 'words:ok');
assert.equal(hit({ type: 'words', words: ['ok'], match: 'exact' }, { content: 'ok then' }), null);

// Links.
assert.equal(hit({ type: 'links', mode: 'any' }, { content: 'see https://www.example.com/a' }), 'links:example.com');
assert.equal(hit({ type: 'links', mode: 'any' }, { content: 'report.pdf is here' }), null, 'a file name is not a link');
assert.equal(hit({ type: 'links', mode: 'deny', list_id: 2, domains: [] }, { content: 'go to https://sub.evil.com/x' }), 'links:evil.com');
assert.equal(hit({ type: 'links', mode: 'deny', list_id: 2, domains: [] }, { content: 'evil.com is bad' }), 'links:evil.com', 'a deny list also finds a domain with no http');
assert.equal(hit({ type: 'links', mode: 'deny', list_id: 2, domains: [] }, { content: 'https://notevil.com' }), null, 'a domain that only ends the same way is not it');
assert.equal(hit({ type: 'links', mode: 'allow', list_id: null, domains: ['good.org'] }, { content: 'https://good.org/a https://bad.net' }), 'links:bad.net');
assert.equal(hit({ type: 'links', mode: 'allow', list_id: null, domains: ['good.org'] }, { content: 'https://docs.good.org/a' }), null);
assert.equal(hit({ type: 'invites' }, { content: 'join discord.gg/abc123' }), 'invites');

// The rest of the triggers.
assert.equal(hit({ type: 'mentions', kind: 'users', max: 3 }, { users: 4 }), 'mentions:4');
assert.equal(hit({ type: 'mentions', kind: 'users', max: 3 }, { users: 3 }), null);
assert.equal(hit({ type: 'mentions', kind: 'everyone', max: 0 }, { everyone: true }) !== null, true);
assert.equal(hit({ type: 'caps', percent: 70, min_length: 10 }, { content: 'STOP SHOUTING NOW' }), 'caps');
assert.equal(hit({ type: 'caps', percent: 70, min_length: 10 }, { content: 'SHORT' }), null);
assert.equal(hit({ type: 'emojis', max: 2 }, { content: '😀😀😀' }), 'emojis');
assert.equal(hit({ type: 'attachments', kind: 'images', max: 0 }, { attachments: [{ contentType: 'image/png', name: 'a.png' }] }), 'attachments:1');
assert.equal(hit({ type: 'attachments', kind: 'files', max: 0 }, { attachments: [{ contentType: 'image/png', name: 'a.png' }] }), null);
assert.equal(hit({ type: 'length', max_chars: 5, max_lines: 0 }, { content: 'abcdefgh' }), 'length:chars');
assert.equal(hit({ type: 'length', max_chars: 0, max_lines: 2 }, { content: 'a\nb\nc' }), 'length:lines');
assert.equal(hit({ type: 'repeated_chars', max: 5 }, { content: 'heyyyyyyyy' }), 'repeated_chars');
assert.equal(hit({ type: 'zalgo', max: 5 }, { content: 'h̷̢̛e̵̡l̶̨l̸̛o̷' }), 'zalgo');
assert.equal(hit({ type: 'regex', pattern: 'free\\s+nitro' }, { content: 'FREE   Nitro here' }), 'regex');

// Several messages: the same text again and again, and too many too fast.
const recent = new m.Recent();
const rep = { type: 'repeated', times: 3, seconds: 30 };
assert.equal(hit(rep, { content: 'buy now' }, recent, 1000), null);
assert.equal(hit(rep, { content: 'Buy  now' }, recent, 2000), null);
assert.equal(hit(rep, { content: 'buy now' }, recent, 3000), 'repeated');
assert.equal(hit(rep, { content: 'buy now' }, new m.Recent(), 99_000), null, 'another memory starts again');
const rate = { type: 'rate', messages: 3, seconds: 5 };
const fast = new m.Recent();
assert.deepEqual([1000, 2000, 3000].map((at) => hit(rate, { content: 'x' }, fast, at)), [null, null, 'rate']);
assert.equal(hit(rate, { content: 'x' }, fast, 20_000), null, 'old messages do not count');
fast.sweep(1_000_000, 1000);
assert.equal(fast.size, 0, 'the memory forgets');

// Conditions.
const cond = (c, patch) => m.checkCondition(c, facts(patch));
assert.equal(cond({ type: 'channel', mode: 'not_in', ids: ['10'] }), false);
assert.equal(cond({ type: 'channel', mode: 'in', ids: ['10'] }), true);
assert.equal(cond({ type: 'channel', mode: 'in', ids: ['11'], }, { parentId: '11' }), true, 'a thread counts as its channel');
assert.equal(cond({ type: 'channel', mode: 'in', ids: [] }), true, 'nothing chosen does not block anybody');
assert.equal(cond({ type: 'category', mode: 'in', ids: ['20'] }), true);
assert.equal(cond({ type: 'role', mode: 'has_none', ids: ['30'] }), false);
assert.equal(cond({ type: 'role', mode: 'has_any', ids: ['30', '31'] }), true);
assert.equal(cond({ type: 'account_age', max_days: 7 }), false);
assert.equal(cond({ type: 'account_age', max_days: 7 }, { accountAgeDays: 2 }), true);
assert.equal(cond({ type: 'member_age', max_days: 3 }, { memberAgeDays: 1 }), true);
assert.equal(cond({ type: 'no_roles' }, { roleIds: new Set() }), true);

// A rule: all triggers or any, conditions first, and the threshold.
const rule = (patch) => ({ trigger_mode: 'any', conditions: [], triggers: [{ type: 'invites' }, { type: 'emojis', max: 1 }], ...patch });
const ev = (r, patch) => m.evaluateRule(r, facts(patch), lists, new m.Recent(), KEYS, 1000);
assert.deepEqual(ev(rule(), { content: 'discord.gg/abc' }), ['invites']);
assert.equal(ev(rule({ trigger_mode: 'all' }), { content: 'discord.gg/abc' }), null);
assert.deepEqual(ev(rule({ trigger_mode: 'all' }), { content: 'discord.gg/abc 😀😀' }), ['invites', 'emojis']);
assert.equal(ev(rule({ conditions: [{ type: 'no_roles' }] }), { content: 'discord.gg/abc' }), null, 'a condition that fails stops the rule');
assert.ok(m.IMMEDIATE_EFFECTS.includes('delete') && m.IMMEDIATE_EFFECTS.includes('violation') && !m.IMMEDIATE_EFFECTS.includes('ban') && !m.IMMEDIATE_EFFECTS.includes('purge'), 'a ban always waits for the threshold, counting does not');

// Text of a reply.
assert.equal(m.fillText('Hi {user} in {channel}, rule {rule} {nope}', { user: '<@1>', channel: '<#2>', rule: 'R' }), 'Hi <@1> in <#2>, rule R {nope}');
assert.deepEqual(m.cleanDomains(['https://WWW.Evil.com/path', 'nodot', 'a.b', 'evil.com']), ['evil.com']);

// ---- The second part: more triggers, conditions and effects, strikes, heat and the join gate ------------------------------------------------------------------
// Speed of the channel (everybody together), of the mentions, the attachments and the links of one member.
const crate = new m.Recent();
assert.deepEqual([1000, 1500, 2000].map((at) => hit({ type: 'channel_rate', messages: 3, seconds: 5 }, { content: 'x' }, crate, at)), [null, null, 'channel_rate'], 'the channel counts what everybody writes');
const mrate = new m.Recent();
assert.equal(hit({ type: 'mention_rate', mentions: 6, seconds: 10 }, { users: 3 }, mrate, 1000), null);
assert.equal(hit({ type: 'mention_rate', mentions: 6, seconds: 10 }, { users: 3 }, mrate, 2000), 'mention_rate:6', 'the mentions add up across messages');
assert.equal(hit({ type: 'mention_rate', mentions: 6, seconds: 10 }, { users: 0 }, new m.Recent(), 2000), null, 'a message with no mentions is not counted');
const arate = new m.Recent();
const att = (n) => Array.from({ length: n }, (_x, i) => ({ contentType: 'image/png', name: `${i}.png` }));
assert.equal(hit({ type: 'attachment_rate', attachments: 5, seconds: 20 }, { attachments: att(3) }, arate, 1000), null);
assert.equal(hit({ type: 'attachment_rate', attachments: 5, seconds: 20 }, { attachments: att(3) }, arate, 2000), 'attachment_rate:6');
const lrate = new m.Recent();
assert.equal(hit({ type: 'link_rate', links: 3, seconds: 20 }, { content: 'https://a.com https://b.com' }, lrate, 1000), null);
assert.equal(hit({ type: 'link_rate', links: 3, seconds: 20 }, { content: 'https://c.com' }, lrate, 2000), 'link_rate:3');
// An edit is not a new message: it does not count for speed.
assert.equal(hit({ type: 'rate', messages: 2, seconds: 5 }, { content: 'x', isEdit: true }, new m.Recent(), 1000), null);
assert.equal(hit({ type: 'channel_rate', messages: 3, seconds: 5 }, { content: 'x', isEdit: true }, new m.Recent(), 1000), null);
// The name of the member.
assert.equal(hit({ type: 'name', where: 'username', match: 'contains', list_id: null, words: ['nitro'], pattern: '' }, { username: 'Free_NITRO_gifts' }), 'name:nitro');
assert.equal(hit({ type: 'name', where: 'nickname', match: 'contains', list_id: null, words: ['nitro'], pattern: '' }, { username: 'Free_NITRO_gifts', nickname: 'Mia' }), null, 'only the nickname was asked for');
assert.equal(hit({ type: 'name', where: 'either', match: 'regex', list_id: null, words: [], pattern: '^\\d{6,}$' }, { username: 'a', nickname: '1234567' }), 'name:regex');
assert.equal(m.cleanTrigger({ type: 'name', match: 'regex', pattern: '(a+)+$' }), null, 'a pattern that can run for ever is refused here too');
// Strikes and heat: what the engine asked of the database before.
const withExtra = (violations, heat) => ({ extra: { violations, heat } });
assert.equal(hit({ type: 'violations', name: 'spam', count: 3, minutes: 60 }, withExtra({ 'spam|60': 3 }, 0)), 'violations:spam');
assert.equal(hit({ type: 'violations', name: 'spam', count: 3, minutes: 60 }, withExtra({ 'spam|60': 2 }, 0)), null);
assert.equal(hit({ type: 'heat', at_least: 100 }, withExtra({}, 120)), 'heat');
assert.equal(hit({ type: 'heat', at_least: 100 }, withExtra({}, 99.9)), null);
assert.deepEqual(m.needsOf({ triggers: [{ type: 'violations', name: 'spam', minutes: 60 }, { type: 'heat' }, { type: 'invites' }] }), { violations: [{ name: 'spam', minutes: 60 }], heat: true });
assert.equal(m.counterName('  Spam Strikes!! '), 'spam-strikes');
assert.equal(m.counterName(''), 'default');
assert.equal(m.decayedHeat(100, 0, 5 * 60_000, 10), 50, 'the heat falls by the minute');
assert.equal(m.decayedHeat(20, 0, 10 * 60_000, 10), 0, 'and never below zero');
assert.deepEqual([0, 1, 2, 3].map((before) => m.escalatedMinutes(10, 2, before, 60)), [10, 20, 40, 60], 'a timeout that doubles, up to the maximum');
assert.equal(m.escalatedMinutes(10, 1, 5, 60), 10, 'with a multiplier of 1 it does not grow');
// More conditions.
assert.equal(cond({ type: 'author_kind', kind: 'bots' }, { isBot: true }), true);
assert.equal(cond({ type: 'author_kind', kind: 'humans' }, { isBot: true }), false);
assert.equal(cond({ type: 'message_kind', kind: 'edited' }, { isEdit: true }), true);
assert.equal(cond({ type: 'message_kind', kind: 'new' }, { isEdit: true }), false);
assert.equal(cond({ type: 'thread', mode: 'only' }, { isThread: false }), false);
assert.equal(cond({ type: 'thread', mode: 'ignore' }, { isThread: false }), true);
assert.equal(cond({ type: 'role', mode: 'has_all', ids: ['30', '31'] }), false, 'has all of them');
assert.equal(cond({ type: 'role', mode: 'has_all', ids: ['30'] }), true);
// More effects, cleaned.
const eff = (e) => m.cleanEffect(e);
assert.deepEqual(eff({ type: 'timeout', minutes: 10, multiplier: 99, max_minutes: 0 }), { type: 'timeout', minutes: 10, multiplier: 10, max_minutes: 1, window_hours: 168 });
assert.deepEqual(eff({ type: 'purge', count: 1000, minutes: 5 }), { type: 'purge', count: 100, minutes: 5 });
assert.deepEqual(eff({ type: 'slowmode', seconds: 99999 }), { type: 'slowmode', seconds: 21600, minutes: 10 });
assert.deepEqual(eff({ type: 'alert', channel_id: 'nope', text: ' hi ' }), { type: 'alert', channel_id: '', text: 'hi' });
assert.deepEqual(eff({ type: 'violation', name: 'Spam!' }), { type: 'violation', name: 'spam' });
assert.deepEqual(eff({ type: 'add_heat', amount: 0 }), { type: 'add_heat', amount: 1 });
assert.equal(eff({ type: 'temp_role', role_id: 'x' }), null, 'a role that is not a role is dropped');
assert.deepEqual(eff({ type: 'temp_role', role_id: '900000000000000001', minutes: 99999999 }), { type: 'temp_role', role_id: '900000000000000001', minutes: 43200 });
assert.equal(m.cleanRule({ name: 'r', dry_run: true, triggers: [{ type: 'invites' }], effects: [{ type: 'delete' }] }).rule.dry_run, true, 'a rule can be in test mode');
// Many words: the Rust finder and the JavaScript one find the same.
const lots = Array.from({ length: 400 }, (_x, i) => `word${i}x`).concat(['badword', 'café']);
for (const how of ['contains', 'word']) {
  const withWasm = m.wordMatcher(lots, how);
  const without = m.wordMatcher(lots, how, { useWasm: false });
  for (const text of ['say BADWORD now', 'a badwords here', 'un CAFÉ', 'cafeteria', 'word7x!', 'xword7xy', 'nothing at all', '', 'badword']) {
    assert.equal(withWasm(text) === null, without(text) === null, `${how}: the same answer for "${text}"`);
  }
}
// The join gate.
const gate = m.cleanJoinGate({ enabled: true, no_avatar_action: 'kick', account_age_days: 7, account_age_action: 'timeout', username_action: 'ban', username_words: ['nitro'], raid_joins: 999, raid_action: 'nope' });
assert.equal(gate.raid_joins, 500);
assert.equal(gate.raid_action, 'alert');
const join = (patch) => ({ hasAvatar: true, accountAgeDays: 400, username: 'mia', displayName: 'Mia', isBot: false, ...patch });
assert.deepEqual(m.gateFindings(gate, join({}), ['nitro']), []);
assert.deepEqual(m.gateFindings(gate, join({ hasAvatar: false }), ['nitro']).map((f) => f.reason), ['no_avatar']);
assert.deepEqual(m.gateFindings(gate, join({ accountAgeDays: 2.5 }), ['nitro']), [{ reason: 'account_age:2d', action: 'timeout' }]);
assert.equal(m.gateFindings(gate, join({ username: 'Free Nitro' }), ['nitro'])[0].action, 'ban');
assert.deepEqual(m.gateFindings(gate, join({ hasAvatar: false, isBot: true }), ['nitro']), [], 'bots are not looked at');
assert.deepEqual(m.gateFindings({ ...gate, enabled: false }, join({ hasAvatar: false }), []), [], 'a gate that is off finds nothing');
assert.equal(m.strongestAction([{ action: 'alert' }, { action: 'ban' }, { action: 'kick' }]), 'ban');
assert.equal(m.strongestAction([]), 'none');
console.log('check-mod-rules: ok');
