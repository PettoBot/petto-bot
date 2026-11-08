// A refused delivery of Omniplex: written in the console every time, in the log channel once an hour per reason (with how many there were),
// and with the names of the headers that tell which webhook it was (never a signature or a secret).
process.env.DISCORD_TOKEN ||= 'check-only';
const assert = require('node:assert/strict');
const path = require('node:path');
const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel));
const stub = (rel, exports) => { require.cache[resolve(rel)] = { id: resolve(rel), filename: resolve(rel), loaded: true, exports }; };

const lines = { channel: [], local: [] };
stub('src/config.js', { omniplexWebhookSecret: 'a-secret', voteChannelId: null });
stub('src/utils/logger.js', { info() {}, error() {}, debug() {}, warn: (text) => lines.channel.push(text), localWarn: (text) => lines.local.push(text) });
stub('src/db/votes.js', { recordVote: async () => true });
stub('src/utils/senderIdentity.js', { sendAs: async () => null });
stub('src/utils/voteBoost.js', { noteVote: () => {}, expiryOfVote: () => 0, VOTE_BOOST_PERCENT: 10, VOTE_BOOST_HOURS: 12 });
stub('src/utils/voteRole.js', { grantVoteRole: async () => null });
const { reportRefusal } = require('../src/utils/voteWebhook.js');

const req = (headers = {}) => ({ headers, get: (name) => headers[String(name).toLowerCase()] });
const body = Buffer.from('{"a":1}');
const bad = { ok: false, reason: 'bad_signature', protocol: 'hmac-sha256' };
const withHeaders = req({ 'content-type': 'application/json', 'x-webhook-protocol': 'hmac-sha256', 'x-webhook-signature': 'sha256=deadbeefsecret', 'x-webhook-id': 'wh-123', authorization: 'Bearer top-secret' });

const t0 = 1_000_000_000_000;
reportRefusal(bad, withHeaders, body, t0);
assert.equal(lines.channel.length, 1, 'the first refusal is told in the log channel');
assert.match(lines.channel[0], /the signature does not match/);
assert.match(lines.channel[0], /x-webhook-id=wh-123/, 'the id of the webhook is there');
assert.match(lines.channel[0], /x-webhook-protocol/, 'and the names of the headers');
for (const text of [...lines.channel, ...lines.local]) assert.ok(!/deadbeef|top-secret|a-secret/.test(text), 'no signature, secret or Authorization value is ever written');

for (let i = 1; i <= 5; i += 1) reportRefusal(bad, withHeaders, body, t0 + i * 60_000);
assert.equal(lines.channel.length, 1, 'the next five in the hour stay out of the channel');
assert.equal(lines.local.length, 5, 'and are in the console');

reportRefusal({ ok: false, reason: 'no_signature', protocol: 'hmac-sha256' }, req(), body, t0 + 6 * 60_000);
assert.equal(lines.channel.length, 2, 'another reason is told on its own');

reportRefusal(bad, withHeaders, body, t0 + 61 * 60_000);
assert.equal(lines.channel.length, 3, 'after an hour it is told again');
assert.match(lines.channel[2], /\(6 refused since the last notice\)/, 'with how many there were');
console.log('Omniplex refusal checks passed (console every time, the channel once an hour, no secret written).');
process.exit(0);
