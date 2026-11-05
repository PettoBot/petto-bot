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
let totalsNow = { mine: 2, total: 10, voters: 4, last: null };
stub('src/db/votes.js', {
  recordVote: async (vote) => { const key = `${vote.source}:${vote.voteId}`; if (stored.has(key)) return false; stored.add(key); return true; },
  voteTotals: async () => totalsNow,
  topVoters: async () => [],
  recentVotes: async () => [],
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
const client = { user: { id: '1' }, users: { fetch: async () => ({ username: 'fa.chu', displayName: 'chu', displayAvatarURL: () => 'https://example.com/a.png' }) }, channels: { fetch: async () => ({ guild, isTextBased: () => true, send: async (payload) => { sent.push(payload); } }) } };
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
  const card = JSON.stringify(sent[0].components[0].toJSON());
  assert.match(card, /<@293504726505357312>/, 'the voter is mentioned');
  assert.match(card, /chu voted on top\.gg!/);
  assert.doesNotMatch(card, /fa\.chu/, 'the display name is shown, not the username');
  assert.match(card, /Thank you!.*2.*time|already voted/);
  assert.match(card, /top\.gg\/bot\/1\/vote/);
  assert.match(card, /Petto has \*\*10\*\* votes in total/, 'the total of votes is shown');
  assert.match(card, /ID: 293504726505357312 \| <t:/);
  assert.deepEqual(roleCalls, [['add', '222222222222222222']], 'the voter gets the role');
  assert.deepEqual(await run(body, sign(body, now)), { code: 200, data: { ok: true, duplicate: true } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1, 'a vote sent again is not thanked twice');
  const test = Buffer.from(JSON.stringify({ type: 'webhook.test', data: {} }));
  assert.deepEqual(await run(test, sign(test, now)), { code: 200, data: { ok: true, test: true } });

  // !votes show: the votes split by list (top.gg and omniplex.gg), in the card the command already builds
  const votesCommand = require('../src/commands/info/votes');
  const { CATALOGS } = require('../src/i18n');
  const showCard = async (locale, totals) => {
    totalsNow = { last: null, ...totals };
    let payload;
    await votesCommand.execute({
      guildId: null, locale, client, user: { id: '700000000000000001' },
      options: { getSubcommand: () => 'show', getUser: () => null },
      reply: async (data) => { payload = data; },
    });
    const container = payload.components[0].toJSON();
    return { json: JSON.stringify(container), container, payload };
  };
  const both = { mine: 7, total: 122, voters: 61, lists: { topgg: { total: 110, mine: 5 }, omniplex: { total: 12, mine: 2 } } };
  // Votes on both lists: the server line has both, the member line has the split
  let shown = await showCard('en-US', both);
  assert.match(shown.json, /\*\*top\.gg\*\* 110 · \*\*omniplex\.gg\*\* 12/, 'the server-wide split');
  assert.match(shown.json, /\*\*122\*\* votes from \*\*61\*\* members in total\./, 'the combined total stays');
  assert.match(shown.json, /<@700000000000000001> has \*\*7\*\* \(top\.gg 5 · omniplex\.gg 2\)\./, 'the member split when voting on both lists');
  // The card keeps its design: no accent color, the star, and the V2 limits
  assert.equal(shown.container.accent_color, undefined, 'the card has no accent color');
  assert.equal(shown.payload.flags & 32768, 32768, 'it is a Components V2 message');
  assert.equal(shown.payload.components.length, 1);
  assert.ok(shown.container.components.every((part) => (part.content ?? '').length <= 4000), 'every text fits in 4000 characters');
  assert.ok(shown.container.components.map((part) => part.content ?? '').join('').length <= 4000, 'the whole card fits the 4000 characters of a V2 message');
  // Votes on one list only (the owner's case): the plain short line, the other list is 0 server-wide
  shown = await showCard('en-US', { mine: 7, total: 110, voters: 40, lists: { topgg: { total: 110, mine: 7 } } });
  assert.match(shown.json, /\*\*top\.gg\*\* 110 · \*\*omniplex\.gg\*\* 0/, 'the missing list counts 0');
  assert.match(shown.json, /<@700000000000000001> has \*\*7\*\*\./, 'a member with one list keeps the short line');
  assert.doesNotMatch(shown.json, /top\.gg 7|\(top\.gg/, 'no split in the member line');
  shown = await showCard('en-US', { mine: 3, total: 12, voters: 5, lists: { omniplex: { total: 12, mine: 3 } } });
  assert.match(shown.json, /\*\*top\.gg\*\* 0 · \*\*omniplex\.gg\*\* 12/);
  assert.match(shown.json, /has \*\*3\*\*\./);
  // Nothing at all
  shown = await showCard('en-US', { mine: 0, total: 0, voters: 0, lists: {} });
  assert.match(shown.json, /\*\*top\.gg\*\* 0 · \*\*omniplex\.gg\*\* 0/);
  assert.match(shown.json, /has \*\*0\*\*\./);
  // A source that is not a known list is ignored in the split but still counts in the total
  shown = await showCard('en-US', { mine: 9, total: 130, voters: 50, lists: { topgg: { total: 110, mine: 5 }, omniplex: { total: 12, mine: 0 }, other: { total: 8, mine: 4 } } });
  assert.match(shown.json, /\*\*130\*\* votes from/, 'the total counts the unknown source');
  assert.match(shown.json, /\*\*top\.gg\*\* 110 · \*\*omniplex\.gg\*\* 12(?!.*other)/, 'the split names only the known lists');
  assert.doesNotMatch(shown.json, /other/, 'the unknown source is not shown');
  assert.match(shown.json, /has \*\*9\*\*\./, 'the member total counts it too, with the short line (one known list)');
  // A database without the split (older data) shows no split line instead of zeros
  shown = await showCard('en-US', { mine: 2, total: 10, voters: 4 });
  assert.doesNotMatch(shown.json, /omniplex\.gg\*\* \d/, 'no split without data');
  // The three languages
  shown = await showCard('es-419', both);
  assert.match(shown.json, /\*\*top\.gg\*\* 110 · \*\*omniplex\.gg\*\* 12/);
  assert.match(shown.json, /tiene \*\*7\*\* \(top\.gg 5 · omniplex\.gg 2\)\./, 'Spanish');
  shown = await showCard('pt-BR', both);
  assert.match(shown.json, /tem \*\*7\*\* \(top\.gg 5 · omniplex\.gg 2\)\./, 'Portuguese');
  assert.notEqual(CATALOGS.es['votes.show.mineSplit'], CATALOGS.en['votes.show.mineSplit']);
  assert.notEqual(CATALOGS['pt-BR']['votes.show.mineSplit'], CATALOGS.en['votes.show.mineSplit']);
  // The top voters stay combined
  const topPayload = [];
  await votesCommand.execute({ guildId: null, locale: 'en-US', client, user: { id: '1' }, options: { getSubcommand: () => 'top' }, reply: async (data) => topPayload.push(data) });
  assert.match(JSON.stringify(topPayload[0].components[0].toJSON()), /No votes yet/, 'the ranking is untouched');

  // !cmdconfig
  const text = buildConfigText('?');
  assert.match(text, /\?automod raid on --threshold 6/);
  assert.match(text, /\?automod antinuke-whitelist add \[user\]/);
  assert.match(text, /\?ticket setup/);
  console.log('Checked the votes: signature, one vote counted once, the thanks, the split of !votes show by list, and the recommended config card.');
})().catch((err) => { console.error(err); process.exit(1); });
