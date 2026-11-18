// Checks the moderation rules made in the dashboard (src/utils/modRules.ts): what is saved is cleaned, what each trigger finds, the conditions, the
// threshold, and that a pattern that could run for ever is refused. No Discord and no database.
const assert = require('node:assert/strict');
const m = require('../src/utils/modRules');

const facts = (patch = {}) => ({
  content: '', channelId: '10', parentId: null, categoryId: '20', roleIds: new Set(['30']), accountAgeDays: 400, memberAgeDays: 100,
  users: 0, roles: 0, everyone: false, attachments: [], ...patch,
});
const lists = { words: new Map([[1, ['badword', 'Café']]]), domains: new Map([[2, ['evil.com']]]) };
const hit = (trigger, patch, recent = new m.Recent(), now = 1000) => m.matchTrigger(trigger, facts(patch), lists, recent, 'u', now);

// What is saved is cleaned.
assert.equal(m.cleanRule({ name: '', triggers: [{ type: 'invites' }], effects: [{ type: 'delete' }] }).ok, false, 'a rule needs a name');
assert.equal(m.cleanRule({ name: 'x', triggers: [], effects: [{ type: 'delete' }] }).error, 'triggers');
assert.equal(m.cleanRule({ name: 'x', triggers: [{ type: 'invites' }], effects: [{ type: 'nope' }] }).error, 'effects');
const cleaned = m.cleanRule({ name: ' Spam ', triggers: [{ type: 'mentions', max: 9999, kind: 'x' }, { type: 'nope' }], effects: [{ type: 'timeout', minutes: 999999 }, { type: 'add_role', role_id: 'abc' }], threshold_count: 500 });
assert.equal(cleaned.ok, true);
assert.deepEqual(cleaned.rule.triggers, [{ type: 'mentions', kind: 'any', max: 100 }], 'a bad trigger is dropped and numbers are limited');
assert.deepEqual(cleaned.rule.effects, [{ type: 'timeout', minutes: 40320 }], 'a role effect with no real role is dropped');
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
const ev = (r, patch) => m.evaluateRule(r, facts(patch), lists, new m.Recent(), 'u', 1000);
assert.deepEqual(ev(rule(), { content: 'discord.gg/abc' }), ['invites']);
assert.equal(ev(rule({ trigger_mode: 'all' }), { content: 'discord.gg/abc' }), null);
assert.deepEqual(ev(rule({ trigger_mode: 'all' }), { content: 'discord.gg/abc 😀😀' }), ['invites', 'emojis']);
assert.equal(ev(rule({ conditions: [{ type: 'no_roles' }] }), { content: 'discord.gg/abc' }), null, 'a condition that fails stops the rule');
const hits = new m.Recent();
assert.deepEqual([1, 2, 3].map((n) => m.thresholdReached(hits, 'k', n * 1000, 3, 1)), [false, false, true], 'the third match in the minute reaches the threshold');
assert.equal(m.thresholdReached(hits, 'other', 1000, 1, 1), true);
assert.ok(m.IMMEDIATE_EFFECTS.includes('delete') && !m.IMMEDIATE_EFFECTS.includes('ban'), 'a ban always waits for the threshold');

// Text of a reply.
assert.equal(m.fillText('Hi {user} in {channel}, rule {rule} {nope}', { user: '<@1>', channel: '<#2>', rule: 'R' }), 'Hi <@1> in <#2>, rule R {nope}');
assert.deepEqual(m.cleanDomains(['https://WWW.Evil.com/path', 'nodot', 'a.b', 'evil.com']), ['evil.com']);
console.log('check-mod-rules: ok');
