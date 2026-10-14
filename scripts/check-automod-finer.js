// The finer automod: thresholds, long messages, exempt channels and strikes.
const assert = require('node:assert/strict');
const c = require('../src/utils/automodChecks');

// repeat flood with the server's own numbers
const flood = (n, opts) => { let hit = false; for (let i = 0; i < n; i += 1) hit = c.isRepeatFlood('g', `u${opts.id}`, 'spam spam', opts); return hit; };
assert.equal(flood(2, { id: 1 }), false, 'two copies are fine by default');
assert.equal(flood(3, { id: 2 }), true, 'three are a flood by default');
assert.equal(flood(4, { id: 3, threshold: 5 }), false, 'a server that allows more');
assert.equal(flood(5, { id: 4, threshold: 5 }), true);
assert.equal(flood(2, { id: 5, threshold: 2 }), true, 'and one that is stricter');

// caps with the server's own percentage
assert.equal(c.isExcessiveCaps('HELLO EVERYONE HOW ARE YOU', { minLength: 12, threshold: 0.7 }), true);
assert.equal(c.isExcessiveCaps('Hello EVERYONE how are you', { minLength: 12, threshold: 0.7 }), false);
assert.equal(c.isExcessiveCaps('Hello EVERYONE how are you', { minLength: 12, threshold: 0.3 }), true, 'a stricter percentage catches it');
assert.equal(c.isExcessiveCaps('HI THERE', { minLength: 12, threshold: 0.7 }), false, 'a short message is never shouting');

// long messages
assert.equal(c.isTooLong('x'.repeat(100), {}), null, 'off by default');
assert.equal(c.isTooLong('x'.repeat(100), { maxLength: 50 }), 'length');
assert.equal(c.isTooLong('a\nb\nc\nd', { maxLines: 3 }), 'lines');
assert.equal(c.isTooLong('a\nb', { maxLines: 3, maxLength: 50 }), null);

// strikes
const t0 = 1_000_000;
const strike = (user, now, limit = 3, windowMinutes = 10) => c.recordStrike('g', user, { limit, windowMinutes }, now);
assert.equal(strike('s1', t0, 0), false, 'a limit of 0 is off');
assert.equal(strike('s2', t0), false);
assert.equal(strike('s2', t0 + 1000), false);
assert.equal(strike('s2', t0 + 2000), true, 'the third hit reaches the limit');
assert.equal(strike('s2', t0 + 3000), false, 'and the count starts over');
assert.equal(strike('s3', t0), false);
assert.equal(strike('s3', t0 + 5 * 60_000), false);
assert.equal(strike('s3', t0 + 11 * 60_000), false, 'old hits fall out of the window');
assert.equal(strike('s4', t0, 1), true, 'a limit of 1 acts at once');

// the event: an exempt channel is never checked, the long message is only deleted
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let config = {};
const applied = [];
stub('../src/db/automod', { getConfig: async () => config, listSilentChannelsCached: async () => [] });
stub('../src/db/automodRules', { listCompiled: async () => [], countHit: () => {} });
stub('../src/utils/automodAction', { applyAutomodAction: async (m, o) => applied.push(o) });
stub('../src/utils/honeypot', { handleHoneypotMessage: async () => false });
stub('../src/db/maliciousLinks', { findKnownMalicious: async () => [] });
stub('../src/utils/senderIdentity', { sendAs: async () => null });
const event = require('../src/events/messageCreateAutomod');
const msg = (content, channelId = 'c1', parentId = null) => ({ guild: { id: 'g1' }, author: { id: 'u1', bot: false }, content, channel: { id: channelId, parentId }, mentions: { users: { size: 0 }, roles: { size: 0 }, everyone: false }, member: { permissions: { has: () => false }, roles: { cache: { has: () => false } } } });
(async () => {
  config = { max_message_length: 50, exempt_channel_ids: ['spamzone'] };
  await event.execute(msg('x'.repeat(80)));
  assert.deepEqual([applied[0].violationType, applied[0].action], ['long-message', 'delete']);
  applied.length = 0;
  await event.execute(msg('x'.repeat(80), 'spamzone'));
  await event.execute(msg('x'.repeat(80), 'thread1', 'spamzone'));
  assert.equal(applied.length, 0, 'an exempt channel, and the threads in it, are never checked');
  config = { anti_spam_enabled: true, spam_caps: false, max_mentions: 5, allowed_invite_codes: [] };
  await event.execute(msg('THIS IS ALL IN CAPITAL LETTERS NOW'));
  assert.equal(applied.length, 0, 'a check the server turned off does not run');
  config = { anti_spam_enabled: true, caps_percent: 40, caps_min_length: 8, max_mentions: 5, allowed_invite_codes: [] };
  await event.execute(msg('Hello EVERYONE how are you'));
  assert.equal(applied[0].violationType, 'excessive-caps', 'the percentage of the server is used');
  console.log('automod finer ok');
})().catch((err) => { console.error(err); process.exit(1); });
