// Checks the top.gg vote webhook: the signature, what a vote event is, that a vote is counted once, and the cards of !cmdconfig.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
process.env.TOPGG_WEBHOOK_SECRET = 'whs_check_secret';
process.env.VOTE_CHANNEL_ID = '111111111111111111';
process.env.VOTE_ROLE_ID = '222222222222222222';

function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const stored = new Set();
stub('src/db/votes.js', {
  recordVote: async (vote) => { const key = `${vote.source}:${vote.voteId}`; if (stored.has(key)) return false; stored.add(key); return true; },
  voteTotals: async () => ({ mine: 2, total: 10, voters: 4, last: null }),
  topVoters: async () => [],
});

const { verifySignature, parseVote } = require('../src/utils/topgg');
const { createTopggHandler } = require('../src/utils/voteWebhook');
const { buildConfigText } = require('../src/commands/info/cmdconfig');

const secret = 'whs_check_secret';
const sign = (body, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')}`;
const now = Math.floor(Date.now() / 1000);
const body = Buffer.from(JSON.stringify({ type: 'vote.create', data: { id: '900000000000000001', weight: 2, created_at: '2026-10-08T10:00:00.000Z', expires_at: '2026-10-08T22:00:00.000Z', user: { id: 'top-1', platform_id: '293504726505357312', name: 'x', avatar_url: 'https://example.com/a.png' } } }));

// Signature
assert.equal(verifySignature({ secret, header: sign(body, now), rawBody: body }), true);
assert.equal(verifySignature({ secret, header: sign(body, now), rawBody: Buffer.from('{"changed":true}') }), false, 'a changed body');
assert.equal(verifySignature({ secret: 'whs_other', header: sign(body, now), rawBody: body }), false, 'another secret');
assert.equal(verifySignature({ secret, header: sign(body, now - 3600), rawBody: body }), false, 'an old timestamp');
assert.equal(verifySignature({ secret, header: 'garbage', rawBody: body }), false);
assert.equal(verifySignature({ secret, header: sign(body, now), rawBody: undefined }), false, 'no raw body');

// The vote
assert.deepEqual(parseVote(JSON.parse(body)), { source: 'topgg', voteId: '900000000000000001', userId: '293504726505357312', weight: 2, votedAt: '2026-10-08T10:00:00.000Z', expiresAt: '2026-10-08T22:00:00.000Z' });
assert.equal(parseVote({ type: 'webhook.test', data: {} }), null);
assert.equal(parseVote({ type: 'vote.create', data: { id: '1', user: { platform_id: 'nope' } } }), null);
assert.equal(parseVote({ type: 'vote.create', data: { id: '1', weight: 99, user: { platform_id: '293504726505357312' } } }).weight, 1, 'a strange weight counts as one');

// The route
const sent = [];
const roleCalls = [];
const members = { '293504726505357312': { roles: { cache: new Map(), add: async (id) => roleCalls.push(['add', id]) } } };
const guild = { members: { fetch: async (id) => members[id] ?? Promise.reject(new Error('unknown member')) } };
const client = { user: { id: '1' }, channels: { fetch: async () => ({ guild, isTextBased: () => true, send: async (payload) => { sent.push(payload); } }) } };
const handler = createTopggHandler(client);
function run(rawBody, header) {
  return new Promise((resolve) => {
    const res = { headersSent: false, status(code) { this.code = code; return this; }, json(data) { this.headersSent = true; resolve({ code: this.code, data }); } };
    handler({ get: () => header, rawBody, body: rawBody ? JSON.parse(rawBody) : {} }, res);
  });
}
(async () => {
  assert.equal((await run(body, 'bad')).code, 401);
  assert.equal(sent.length, 0, 'nothing is thanked for a bad signature');
  assert.deepEqual(await run(body, sign(body, now)), { code: 200, data: { ok: true, duplicate: false } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1, 'the voter is thanked');
  assert.deepEqual(roleCalls, [['add', '222222222222222222']], 'the voter gets the role');
  assert.deepEqual(await run(body, sign(body, now)), { code: 200, data: { ok: true, duplicate: true } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1, 'a vote sent again is not thanked twice');
  const test = Buffer.from(JSON.stringify({ type: 'webhook.test', data: {} }));
  assert.deepEqual(await run(test, sign(test, now)), { code: 200, data: { ok: true, test: true } });

  // !cmdconfig
  const text = buildConfigText('?');
  assert.match(text, /\?automod raid on --threshold 6/);
  assert.match(text, /\?automod antinuke-whitelist add \[user\]/);
  assert.match(text, /\?ticket setup/);
  console.log('Checked the votes: signature, one vote counted once, the thanks, and the recommended config card.');
})().catch((err) => { console.error(err); process.exit(1); });
