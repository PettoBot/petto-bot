// Checks the vote boost: how long a vote lasts (the latest expiry of both lists, never a sum), the cache in front of the database,
// the +10% on messages and voice XP (once, before the daily limit, on top of the multipliers, off when the server turned it off),
// the omniplex webhook (signature, what is ignored, a vote sent twice), the line of the rank outside of the card, and the texts in the three languages.
// The database and Discord are replaced.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
process.env.TOPGG_WEBHOOK_SECRET = 'whs_check_secret';
process.env.OMNIPLEX_WEBHOOK_SECRET = 'omni_check_secret';
process.env.VOTE_CHANNEL_ID = '111111111111111111';
process.env.VOTE_ROLE_ID = '222222222222222222';
delete process.env.OMNIPLEX_VOTE_URL;

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- The database: the votes of the last 2 days and the levels --------------------------------------------------------
const voteRows = new Map(); // user id -> rows of bot_votes
const recorded = new Set();
let voteReads = 0;
stub('src/db/votes.js', {
  recordVote: async (vote) => {
    const key = `${vote.source}:${vote.voteId}`;
    if (recorded.has(key)) return false;
    recorded.add(key);
    const rows = voteRows.get(vote.userId) ?? [];
    rows.push({ voted_at: vote.votedAt, expires_at: vote.expiresAt });
    voteRows.set(vote.userId, rows);
    return true;
  },
  recentVotes: async (userId) => { voteReads += 1; return voteRows.get(userId) ?? []; },
  voteTotals: async () => ({ mine: 1, total: 5, voters: 3, last: new Date().toISOString() }),
  topVoters: async () => [],
});
const calls = { addXp: [], addVoiceXp: [], period: [], daily: [] };
let events = [];
const users = {};
stub('src/db/levelUsers.js', {
  ensureUser: async (g, id) => (users[id] ??= { xp: 0, level: 0, voice_xp: 0, voice_level: 0 }),
  addXp: async (g, id, { xpGain }) => { calls.addXp.push(xpGain); users[id].xp += xpGain; return users[id]; },
  addVoiceXp: async (g, id, { xpGain }) => { calls.addVoiceXp.push(xpGain); users[id].voice_xp += xpGain; return users[id]; },
  touchStreak: async () => ({ newDay: true, streak: 1 }),
  takeDailyXp: async (g, id, day, xp, cap) => { calls.daily.push(xp); return Math.min(xp, cap); },
  setLevel: async () => {}, setVoiceLevel: async () => {}, getUser: async (g, id) => users[id], getRank: async () => 1, getVoiceRank: async () => 1, countRanked: async () => 1, countVoiceRanked: async () => 1,
});
let multipliers = [];
stub('src/db/levelRewards.js', { listRewards: async () => [] });
stub('src/db/levelMultipliers.js', { listMultipliers: async () => multipliers });
stub('src/db/xpEvents.js', { listEvents: async () => events });
stub('src/db/levelPeriods.js', { addPeriodXp: async (g, id, amount) => { calls.period.push(amount); } });
stub('src/db/embedTemplates.js', {});
stub('src/utils/embedBuilder.js', { build: async () => ({}) });
stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), applyReactReplies: async () => {} });
stub('src/utils/cardService.js', { renderRankCard: async () => null, CARD_FILE_NAME: 'card.png' });
const realLogger = require('../src/utils/logger');
const warnings = [];
stub('src/utils/logger.js', { ...realLogger, info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} });

const voteBoost = require('../src/utils/voteBoost');
const { VOTE_BOOST_PERCENT, VOTE_BOOST_HOURS, voteExpiry, latestExpiry, createVoteBoostCache, boostFactor, formatTimeLeft, timeLeft } = voteBoost;
const HOUR = 3_600_000;
const MINUTE = 60_000;

(async () => {
  // ---- The numbers ----------------------------------------------------------------------------------------------------
  assert.equal(VOTE_BOOST_PERCENT, 10);
  assert.equal(VOTE_BOOST_HOURS, 12);
  assert.equal(boostFactor({ percent: 10, endsAt: 1 }), 1.1);
  assert.equal(boostFactor(null), 1);

  // ---- The expiry of a vote -----------------------------------------------------------------------------------------
  const t0 = Date.parse('2026-10-08T10:00:00.000Z');
  assert.equal(voteExpiry({ voted_at: '2026-10-08T10:00:00.000Z', expires_at: '2026-10-08T22:00:00.000Z' }), t0 + 12 * HOUR, 'expires_at when the row has one');
  assert.equal(voteExpiry({ voted_at: '2026-10-08T10:00:00.000Z', expires_at: '2026-10-08T15:00:00.000Z' }), t0 + 5 * HOUR, 'expires_at wins even when it is shorter');
  assert.equal(voteExpiry({ voted_at: new Date(t0), expires_at: null }), t0 + 12 * HOUR, 'else 12 hours after the vote (Date)');
  assert.equal(voteExpiry({ voted_at: '2026-10-08T10:00:00.000Z' }), t0 + 12 * HOUR, 'else 12 hours after the vote (string)');
  assert.equal(voteExpiry({ voted_at: t0, expires_at: undefined }), t0 + 12 * HOUR, 'else 12 hours after the vote (milliseconds)');
  assert.equal(voteExpiry({}), null);
  assert.equal(voteExpiry(null), null);
  assert.equal(voteExpiry({ voted_at: 'not a date' }), null);
  assert.equal(voteExpiry({ voted_at: 'not a date', expires_at: new Date(t0).toISOString() }), t0, 'an expiry alone is enough');

  // ---- Both lists share one expiry: the latest, never a sum ---------------------------------------------------------
  const topgg = { voted_at: new Date(t0).toISOString(), expires_at: new Date(t0 + 12 * HOUR).toISOString(), weight: 2, source: 'topgg' };
  const omniplex = { voted_at: new Date(t0 + 3 * HOUR).toISOString(), expires_at: new Date(t0 + 15 * HOUR).toISOString(), weight: 1, source: 'omniplex' };
  assert.equal(latestExpiry([topgg, omniplex]), t0 + 15 * HOUR, 'the latest of the two, not 24 hours');
  assert.equal(latestExpiry([omniplex, topgg]), t0 + 15 * HOUR, 'the order does not matter');
  assert.notEqual(latestExpiry([topgg, omniplex]), t0 + 27 * HOUR, 'voting on both does not add the durations');
  assert.equal(latestExpiry([{ ...topgg, weight: 10 }, { voted_at: omniplex.voted_at, expires_at: null }]), t0 + 15 * HOUR, 'the weight (a weekend vote) does not change the time');
  assert.equal(latestExpiry([]), null);
  assert.equal(latestExpiry(null), null);
  assert.equal(latestExpiry([{}, { voted_at: 'x' }]), null, 'rows with no date give nothing');
  assert.equal(formatTimeLeft({ percent: 10, endsAt: t0 + 3 * HOUR + 20 * MINUTE }, t0), '3h 20m');
  assert.equal(formatTimeLeft({ percent: 10, endsAt: t0 + 45 * MINUTE }, t0), '45m');
  assert.equal(formatTimeLeft({ percent: 10, endsAt: t0 + 2 * HOUR }, t0), '2h');
  assert.deepEqual(timeLeft({ percent: 10, endsAt: t0 - 5 }, t0), { hours: 0, minutes: 0 }, 'never negative');

  // ---- The cache ------------------------------------------------------------------------------------------------------
  let clock = t0;
  const loads = [];
  const answers = new Map();
  const cache = createVoteBoostCache({
    load: async (id) => { loads.push(id); if (answers.get(id) instanceof Error) throw answers.get(id); return answers.get(id) ?? null; },
    now: () => clock,
    maxEntries: 3,
  });
  const A = '100000000000000001'; const B = '100000000000000002'; const C = '100000000000000003'; const D = '100000000000000004';

  answers.set(A, t0 + 5 * HOUR);
  assert.deepEqual(await cache.get(A), { percent: 10, endsAt: t0 + 5 * HOUR });
  await cache.get(A); await cache.get(A);
  assert.deepEqual(loads, [A], 'a positive answer is read once');
  clock = t0 + 5 * HOUR - 1;
  assert.ok(await cache.get(A), 'still active one millisecond before it ends');
  assert.equal(loads.length, 1);
  clock = t0 + 5 * HOUR;
  answers.set(A, null);
  assert.equal(await cache.get(A), null, 'at the expiry it is asked again and the boost is gone');
  assert.equal(loads.length, 2);

  // Negative answers are remembered for about 10 minutes.
  clock = t0;
  assert.equal(await cache.get(B), null);
  await cache.get(B); await cache.get(B);
  assert.equal(loads.filter((id) => id === B).length, 1, 'no vote: one query, then it is remembered');
  clock = t0 + 9 * MINUTE;
  await cache.get(B);
  assert.equal(loads.filter((id) => id === B).length, 1, 'still remembered after 9 minutes');
  clock = t0 + 10 * MINUTE + 1;
  await cache.get(B);
  assert.equal(loads.filter((id) => id === B).length, 2, 'asked again after 10 minutes');

  // A vote that arrives from a webhook is known at once, without a query, even over a remembered "no".
  clock = t0;
  const before = loads.length;
  cache.note(B, t0 + 12 * HOUR);
  assert.deepEqual(await cache.get(B), { percent: 10, endsAt: t0 + 12 * HOUR }, 'the voter has the boost at once');
  assert.equal(loads.length, before, 'with no query');
  cache.note(B, t0 + 2 * HOUR);
  assert.equal((await cache.get(B)).endsAt, t0 + 12 * HOUR, 'a shorter vote never shortens the boost');
  cache.note(B, t0 + 14 * HOUR);
  assert.equal((await cache.get(B)).endsAt, t0 + 14 * HOUR, 'a later vote extends it to the latest end (not a sum)');
  cache.note(C, t0 - 1);
  cache.note('not an id', t0 + HOUR);
  cache.note(C, Number.NaN);
  assert.equal(cache.size() <= 3, true);
  assert.equal(await cache.get('not an id'), null, 'a value that is not an id is never looked up');
  assert.equal(loads.includes('not an id'), false);

  // Two messages at the same time share one query.
  answers.set(D, t0 + HOUR);
  const sharedBefore = loads.length;
  const both = await Promise.all([cache.get(D), cache.get(D), cache.get(D)]);
  assert.equal(loads.length - sharedBefore, 1, 'concurrent questions share one query');
  assert.ok(both.every((boost) => boost?.endsAt === t0 + HOUR));

  // The size is bounded and the oldest entries leave first.
  const small = createVoteBoostCache({ load: async (id) => { loads.push(`small:${id}`); return t0 + 6 * HOUR; }, now: () => clock, maxEntries: 3 });
  const ids = ['300000000000000001', '300000000000000002', '300000000000000003', '300000000000000004'];
  for (const id of ids) await small.get(id);
  assert.equal(small.size(), 3, 'bounded');
  const reads = () => loads.filter((entry) => String(entry).startsWith('small:')).length;
  const afterFill = reads();
  await small.get(ids[3]); await small.get(ids[2]); await small.get(ids[1]);
  assert.equal(reads(), afterFill, 'the three newest are still there');
  await small.get(ids[0]);
  assert.equal(reads(), afterFill + 1, 'the oldest was evicted and is read again');
  assert.equal(createVoteBoostCache({ load: async () => null }).size(), 0);

  // A database that fails gives no boost, is not asked again at once, and nothing throws.
  const failing = new Error('db down');
  answers.set('400000000000000001', failing);
  assert.equal(await cache.get('400000000000000001'), null);
  await cache.get('400000000000000001');
  assert.equal(loads.filter((id) => id === '400000000000000001').length, 1, 'a failed read is not repeated for every message');
  clock = t0 + 31_000;
  answers.set('400000000000000001', t0 + 3 * HOUR);
  assert.ok(await cache.get('400000000000000001'), 'and it is tried again soon after');

  // ---- The module's own cache reads the database lazily and only once -------------------------------------------------
  voteBoost.resetVoteBoostCache();
  const FRESH = '500000000000000001';
  const vote = new Date(Date.now() - HOUR).toISOString();
  voteRows.set(FRESH, [{ voted_at: vote, expires_at: null }]);
  const read = await voteBoost.getVoteBoost(FRESH);
  assert.equal(read.endsAt, Date.parse(vote) + 12 * HOUR);
  await voteBoost.getVoteBoost(FRESH);
  assert.equal(voteReads, 1, 'one query for a member, however many messages');
  assert.equal(await voteBoost.boostFor({ vote_boost_enabled: false }, FRESH), null, 'a server that turned it off sees none');
  assert.ok(await voteBoost.boostFor({ vote_boost_enabled: true }, FRESH));
  assert.ok(await voteBoost.boostFor({}, FRESH), 'on unless the column is false');
  assert.ok(await voteBoost.boostFor(null, FRESH));

  // ---- XP: +10% once, before the daily limit, on top of the multipliers ----------------------------------------------
  const { grantXp, grantVoiceXp, getMultiplier } = require('../src/utils/levelActions');
  const guild = { id: '9' };
  const base = { notify_mode: 'off', max_level: 100, daily_bonus_xp: 0, streak_bonus_xp: 0, streak_max_days: 7 };
  const voter = { id: '600000000000000001', roles: { cache: new Collection() } };
  const other = { id: '600000000000000002', roles: { cache: new Collection() } };
  voteBoost.resetVoteBoostCache();
  voteReads = 0;

  await grantXp({ guild, member: voter, config: base, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 100, 'no boost: the old number');
  voteBoost.noteVote(voter.id, Date.now() + HOUR);
  await grantXp({ guild, member: voter, config: base, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 110, 'a voter earns +10% in chat');
  assert.deepEqual(calls.period.at(-1), { textXp: 110 }, 'once: the week and month get the boosted amount only');
  await grantXp({ guild, member: voter, config: { ...base, vote_boost_enabled: false }, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 100, 'a server that turned it off gets exactly the old number');
  await grantXp({ guild, member: voter, config: { ...base, vote_boost_enabled: true }, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 110);
  await grantXp({ guild, member: other, config: base, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 100, 'a member who did not vote is not boosted');
  await grantXp({ guild, member: voter, config: base, xpGain: 5, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 6, 'rounded once (5 x 1.1 = 5.5)');

  await grantVoiceXp({ guild, member: voter, config: base, xpGain: 10, vcInc: 1 });
  assert.equal(calls.addVoiceXp.at(-1), 11, 'a voter earns +10% in voice');
  assert.deepEqual(calls.period.at(-1), { voiceXp: 11 });
  await grantVoiceXp({ guild, member: voter, config: { ...base, vote_boost_enabled: false }, xpGain: 10, vcInc: 1 });
  assert.equal(calls.addVoiceXp.at(-1), 10, 'voice with the switch off is the old number');
  await grantVoiceXp({ guild, member: other, config: base, xpGain: 10, vcInc: 1 });
  assert.equal(calls.addVoiceXp.at(-1), 10);
  const { getVoiceConfig } = require('../src/utils/levelSource');
  await grantVoiceXp({ guild, member: voter, config: getVoiceConfig({ ...base, vote_boost_enabled: false, voice_enabled: true }), xpGain: 10, vcInc: 1 });
  assert.equal(calls.addVoiceXp.at(-1), 10, 'the switch survives getVoiceConfig');

  // It multiplies on top of an XP event, and the event rounds with it, not before.
  events = [{ source: 'all', multiplier: '2', starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 60_000) }];
  await grantXp({ guild, member: voter, config: base, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 220, 'an event x2 and the boost: 100 x 2 x 1.1');
  events = [];

  // It is outside the server's multiplier cap: the cap limits the multipliers, the boost comes after them.
  multipliers = [{ target_type: 'role', target_id: 'vip', multiplier: '10' }];
  const vip = { id: voter.id, roles: { cache: new Map([['vip', {}]]) } };
  const capped = { ...base, multiplier_cap: 5 };
  assert.equal(await getMultiplier('9', 'c', vip, capped), 5, 'the multiplier is capped at 5');
  await grantXp({ guild, member: vip, config: capped, xpGain: Math.round(10 * await getMultiplier('9', 'c', vip, capped)), messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 55, 'capped x5 and then +10%: more than the cap alone');
  multipliers = [];

  // The daily limit comes after the boost: what is counted against it is the boosted amount.
  const limited = { ...base, daily_xp_cap: 105 };
  await grantXp({ guild, member: voter, config: limited, xpGain: 100, messageInc: 1 });
  assert.equal(calls.daily.at(-1), 110, 'the limit sees the boosted amount');
  assert.equal(calls.addXp.at(-1), 105, 'and cuts it');
  await grantXp({ guild, member: voter, config: { ...limited, vote_boost_enabled: false }, xpGain: 100, messageInc: 1 });
  assert.equal(calls.daily.at(-1), 100, 'with the switch off the limit sees the plain amount');
  assert.equal(calls.addXp.at(-1), 100);

  // The daily bonus is not boosted: it is a fixed amount of the server.
  const bonusUser = { id: '600000000000000003', roles: { cache: new Collection() } };
  voteBoost.noteVote(bonusUser.id, Date.now() + HOUR);
  await grantXp({ guild, member: bonusUser, config: { ...base, daily_bonus_xp: 50 }, xpGain: 100, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 160, '100 x 1.1 plus a daily bonus of 50 that is not boosted');

  // No query per message.
  const queriesBefore = voteReads;
  for (let i = 0; i < 50; i += 1) await grantXp({ guild, member: voter, config: base, xpGain: 10, messageInc: 1 });
  for (let i = 0; i < 50; i += 1) await grantXp({ guild, member: other, config: base, xpGain: 10, messageInc: 1 });
  assert.ok(voteReads - queriesBefore <= 1, `100 messages cost ${voteReads - queriesBefore} vote queries`);

  // A failing read of the boost does not stop the award.
  const levelSource = fs.readFileSync(path.join(__dirname, '..', 'src/utils/levelActions.js'), 'utf8');
  assert.match(levelSource, /The vote boost could not be read/, 'a failure is logged and the plain XP is given');

  // ---- The omniplex webhook ---------------------------------------------------------------------------------------------
  const { verifySignature, parseVote, readEvent } = require('../src/utils/omniplexVotes');
  const secret = 'omni_check_secret';
  const sign = (body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const envelope = (overrides = {}) => ({
    type: 'NEW_VOTE',
    data: { votes: 12, per_user: 1, downvote: false, auto: false, ...(overrides.data ?? {}) },
    creator: { id: '293504726505357312', ...(overrides.creator ?? {}) },
    targets: [{ id: '1' }],
    metadata: { created_at: nowSeconds, test: false, ...(overrides.metadata ?? {}) },
    ...(overrides.top ?? {}),
  });
  const bodyOf = (value) => Buffer.from(JSON.stringify(value));
  const good = bodyOf(envelope());

  assert.equal(verifySignature({ secret, header: sign(good), rawBody: good }), true);
  assert.equal(verifySignature({ secret, header: sign(good).toUpperCase().replace('SHA256=', 'sha256='), rawBody: good }), true, 'hex in capitals');
  assert.equal(verifySignature({ secret, header: sign(good), rawBody: bodyOf(envelope({ creator: { id: '293504726505357313' } })) }), false, 'a changed body');
  assert.equal(verifySignature({ secret: 'other', header: sign(good), rawBody: good }), false, 'another secret');
  assert.equal(verifySignature({ secret, header: undefined, rawBody: good }), false, 'no header');
  assert.equal(verifySignature({ secret, header: 'sha256=abc', rawBody: good }), false, 'a short signature');
  assert.equal(verifySignature({ secret, header: 'garbage', rawBody: good }), false);
  assert.equal(verifySignature({ secret, header: sign(good), rawBody: undefined }), false, 'no raw body');
  assert.equal(verifySignature({ secret: null, header: sign(good), rawBody: good }), false, 'no secret configured');

  const parsed = parseVote(envelope(), Date.now());
  assert.equal(parsed.source, 'omniplex');
  assert.equal(parsed.userId, '293504726505357312');
  assert.equal(parsed.voteId, `293504726505357312:${nowSeconds}`, 'the vote id is the voter and the time');
  assert.equal(parsed.weight, 1);
  assert.equal(Date.parse(parsed.votedAt), nowSeconds * 1000, 'created_at is in seconds');
  assert.equal(Date.parse(parsed.expiresAt) - Date.parse(parsed.votedAt), 12 * HOUR, 'it lasts 12 hours');
  assert.equal(readEvent(envelope({ metadata: { test: true } })).ignored, 'test');
  assert.equal(readEvent(envelope({ data: { downvote: true } })).ignored, 'downvote');
  assert.equal(readEvent(envelope({ data: { auto: true } })).ignored, 'auto');
  assert.equal(readEvent(envelope({ top: { type: 'SOMETHING_ELSE' } })).ignored, 'type');
  assert.equal(readEvent(envelope({ creator: { id: 'nope' } })).ignored, 'voter');
  assert.equal(parseVote(null), null);
  assert.equal(parseVote([]), null);
  assert.equal(parseVote('text'), null);
  assert.equal(parseVote({}), null);
  assert.equal(parseVote({ type: 'NEW_VOTE' }), null, 'a vote with no voter');
  assert.ok(parseVote({ type: 'new_vote', creator: { id: '293504726505357312' }, metadata: {}, data: null }), 'a vote with nothing but the voter still counts (and never throws)');
  const future = parseVote(envelope({ metadata: { created_at: nowSeconds + 86_400 } }), Date.now());
  assert.ok(Date.parse(future.votedAt) <= Date.now() + 1000, 'a vote dated in the future is counted as cast now');
  assert.equal(parseVote(envelope({ metadata: { created_at: nowSeconds * 1000 } }), Date.now()).votedAt, parsed.votedAt, 'milliseconds are understood too');
  assert.ok(parseVote(envelope({ metadata: { created_at: new Date().toISOString() } })), 'and a date');
  assert.ok(parseVote(envelope({ metadata: { created_at: { weird: true } } })), 'a strange time never throws');
  assert.equal(parseVote(envelope({ metadata: { created_at: nowSeconds } }), Date.now()).voteId, parsed.voteId, 'the same delivery gives the same id');

  // The route (top.gg and omniplex both feed the same boost).
  const { createOmniplexHandler, createTopggHandler } = require('../src/utils/voteWebhook');
  const sent = [];
  const roleCalls = [];
  const memberId = '293504726505357312';
  const members = { [memberId]: { roles: { cache: new Map(), add: async (id, reason) => roleCalls.push([id, reason]) } } };
  const guildOfChannel = { id: '7', members: { fetch: async (id) => members[id] ?? Promise.reject(new Error('unknown member')) } };
  const client = {
    user: { id: '1' },
    users: { fetch: async () => ({ username: 'fa.chu', displayName: 'chu', displayAvatarURL: () => 'https://example.com/a.png' }) },
    channels: { fetch: async () => ({ guild: guildOfChannel, guildId: '7', isTextBased: () => true, send: async (payload) => { sent.push(payload); } }) },
  };
  function runner(handler, headerName) {
    return (rawBody, header, extra = {}) => new Promise((resolve) => {
      const res = { headersSent: false, status(code) { this.code = code; return this; }, json(data) { this.headersSent = true; resolve({ code: this.code, data }); } };
      handler({ get: (name) => (name.toLowerCase() === headerName ? header : undefined), rawBody, body: {}, ...extra }, res);
    });
  }
  const omniplexRun = runner(createOmniplexHandler(client), 'x-webhook-signature');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

  voteBoost.resetVoteBoostCache();
  assert.equal(await voteBoost.getVoteBoost(memberId), null, 'before the vote: none');
  assert.equal((await omniplexRun(good, 'sha256=00')).code, 401);
  assert.equal((await omniplexRun(good, undefined)).code, 401);
  assert.equal((await omniplexRun(undefined, sign(good))).code, 401, 'no raw body is a bad request, never a throw');
  assert.equal(sent.length, 0, 'nothing is thanked for a bad signature');
  assert.equal(recorded.size, 0, 'nothing is stored for a bad signature');

  assert.deepEqual(await omniplexRun(good, sign(good)), { code: 200, data: { ok: true, duplicate: false } });
  const boosted = await voteBoost.getVoteBoost(memberId);
  assert.ok(boosted, 'the voter has the boost at once, even over a remembered "no"');
  assert.equal(boosted.endsAt, nowSeconds * 1000 + 12 * HOUR);
  await settle();
  assert.equal(sent.length, 1, 'the voter is thanked');
  const card = JSON.stringify(sent[0].components[0].toJSON());
  assert.match(card, /chu voted on omniplex\.gg!/, 'the thanks name the list');
  assert.match(card, /omniplex\.gg\/bots\/1/, 'with the vote link of that list');
  assert.match(card, /\+10% XP for 12 hours/, 'and the boost');
  assert.deepEqual(roleCalls, [['222222222222222222', 'Voted for Petto on omniplex.gg']], 'the voter role is given, naming the list');

  assert.deepEqual(await omniplexRun(good, sign(good)), { code: 200, data: { ok: true, duplicate: true } }, 'the same delivery twice is one vote');
  await settle();
  assert.equal(sent.length, 1, 'and is thanked once');
  assert.equal(roleCalls.length, 1);
  assert.equal(voteRows.get(memberId).length, 1, 'and stored once');

  for (const [name, value, reason] of [['a test', envelope({ metadata: { test: true } }), 'test'], ['a downvote', envelope({ data: { downvote: true } }), 'downvote'], ['an automatic vote', envelope({ data: { auto: true } }), 'auto'], ['another event', envelope({ top: { type: 'BOT_UPDATED' } }), 'type']]) {
    const body = bodyOf(value);
    assert.deepEqual(await omniplexRun(body, sign(body)), { code: 200, data: { ok: true, ignored: true, reason } }, `${name} is answered and ignored`);
  }
  const notJson = Buffer.from('not json at all');
  assert.equal((await omniplexRun(notJson, sign(notJson))).code, 200, 'a signed body that is not JSON is answered, not retried');
  assert.equal(recorded.size, 1, 'only the real vote was stored');
  const asBuffer = bodyOf(envelope({ creator: { id: '293504726505357399' }, metadata: { created_at: nowSeconds - 5 } }));
  assert.equal((await omniplexRun(undefined, sign(asBuffer), { body: asBuffer })).code, 200, 'a body read as a buffer by another parser is used');

  // top.gg gives the boost too, and the two lists share the later expiry.
  const topggRun = runner(createTopggHandler(client), 'x-topgg-signature');
  const topggSecret = 'whs_check_secret';
  const topggBody = bodyOf({ type: 'vote.create', data: { id: '900000000000000009', weight: 2, created_at: new Date(Date.now() - HOUR).toISOString(), expires_at: new Date(Date.now() + 11 * HOUR).toISOString(), user: { platform_id: '293504726505357313' } } });
  const stamp = Math.floor(Date.now() / 1000);
  const topggSignature = `t=${stamp},v1=${crypto.createHmac('sha256', topggSecret).update(`${stamp}.`).update(topggBody).digest('hex')}`;
  await topggRun(topggBody, topggSignature, { body: JSON.parse(topggBody) });
  const topggBoost = await voteBoost.getVoteBoost('293504726505357313');
  assert.ok(topggBoost, 'a top.gg vote starts the boost at once');
  assert.ok(Math.abs(topggBoost.endsAt - (Date.now() + 11 * HOUR)) < 5000, 'until its own expires_at');
  assert.equal(topggBoost.percent, 10, 'weight 2 is still +10%, not +20%');
  await settle();
  assert.match(JSON.stringify(sent.at(-1).components[0].toJSON()), /voted on top\.gg!/);

  // The web server starts for either secret and has its own route and limiter.
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src/web/server.js'), 'utf8');
  assert.match(serverSource, /votesEnabled = topggEnabled \|\| omniplexEnabled/, 'it starts with either secret');
  assert.match(serverSource, /app\.post\('\/webhooks\/omniplex', omniplexRateLimiter, express\.raw\(/, 'its own route and limiter');
  assert.match(serverSource, /if \(omniplexEnabled\)/);
  assert.match(serverSource, /if \(topggEnabled\)/);

  // ---- The links ----------------------------------------------------------------------------------------------------
  const { voteUrl, voteLists } = require('../src/utils/voteLists');
  assert.equal(voteUrl('topgg', '55'), 'https://top.gg/bot/55/vote');
  assert.equal(voteUrl('omniplex', '55'), 'https://omniplex.gg/bots/55', 'the default omniplex link');
  assert.deepEqual(voteLists('55').map((list) => list.name), ['top.gg', 'omniplex.gg']);

  // ---- The texts: rank card variable, embed and the votes command, in the three languages -----------------------------
  const { resolve } = require('../src/utils/embedVariables');
  const { VARIABLE_GROUPS } = require('../src/utils/embedVariableRegistry');
  assert.ok(VARIABLE_GROUPS.flatMap((group) => group.vars).some((variable) => variable.tok === '{level_vote_boost}'), 'the variable is listed');
  const endsAt = Date.now() + 3 * HOUR + 20 * MINUTE - 1000;
  const expectedText = { en: /^\+10% XP · 3h 20m left$/, es: /^\+10% XP · quedan 3h 20m$/, 'pt-BR': /^\+10% de XP · restam 3h 20m$/ };
  for (const lang of ['en', 'es', 'pt-BR']) {
    assert.match(await resolve('{level_vote_boost}', { lang, levelData: { voteBoost: { percent: 10, endsAt } } }), expectedText[lang], `{level_vote_boost} in ${lang}`);
    assert.equal(await resolve('{level_vote_boost}', { lang, levelData: { voteBoost: null } }), '', `empty without a boost in ${lang}`);
    assert.equal(await resolve('{level_vote_boost}', { lang, levelData: {} }), '');
    assert.equal(await resolve('{level_vote_boost}', { lang }), '', 'and with no level data at all');
    assert.equal(await resolve('{level_vote_boost}', { lang, levelData: { voteBoost: { percent: 10, endsAt: Date.now() - 1 } } }), '', 'a boost that ended shows nothing');
  }

  const { buildLevelData } = require('../src/utils/levelData');
  const { buildRankEmbed, buildBoostLine, buildRankReply } = require('../src/utils/rankView');
  const config = { curve_a: 1, curve_b: 50, curve_c: 100, difficulty: 2.5, rounding: 50 };
  const noBoost = buildLevelData({ config, userData: { xp: 300, level: 1 }, rank: 2, total: 9 });
  assert.equal(noBoost.voteBoost, null, 'no boost in the data by default');
  assert.equal(noBoost.voteBoostAvailable, false, 'and nothing to vote for unless the server says the boost is on');
  const withBoost = buildLevelData({ config, userData: { xp: 300, level: 1 }, rank: 2, total: 9, voteBoost: { percent: 10, endsAt }, voteBoostEnabled: true });
  assert.deepEqual(withBoost.voteBoost, { percent: 10, endsAt });
  assert.equal(withBoost.voteBoostAvailable, false, 'a member with a boost has nothing to vote for');
  const voteNow = buildLevelData({ config, userData: { xp: 300, level: 1 }, rank: 2, total: 9, voteBoostEnabled: true });
  assert.deepEqual([voteNow.voteBoost, voteNow.voteBoostAvailable], [null, true], 'boost on and no active boost: the member can vote');
  const endedBoost = buildLevelData({ config, userData: { xp: 300, level: 1 }, voteBoost: { percent: 10, endsAt: Date.now() - 5 }, voteBoostEnabled: true });
  assert.equal(endedBoost.voteBoost, null, 'an ended boost is dropped');
  assert.equal(endedBoost.voteBoostAvailable, true, 'and the member can vote again');

  // The rank embed has no vote boost field any more: the notice is a line of text above it.
  const fieldsOf = (data, lang) => buildRankEmbed({ data, name: 'Liam', avatarUrl: null, lang }).toJSON().fields;
  const oldNames = ['Vote boost', 'Bonus por voto', 'Bônus de voto'];
  for (const lang of ['en', 'es', 'pt-BR']) {
    for (const data of [withBoost, noBoost, voteNow]) {
      assert.equal(fieldsOf(data, lang).some((entry) => oldNames.includes(entry.name) || /\+10%/.test(entry.value)), false, `no vote boost field in the embed (${lang})`);
    }
    assert.equal(fieldsOf(withBoost, lang).length, fieldsOf(noBoost, lang).length, 'the embed is the same with or without a boost');
  }
  const catalogs = require('../src/i18n').CATALOGS;
  assert.equal(Object.keys(catalogs.en).includes('leveling.rankView.voteBoost'), false, 'the old field keys are gone');

  // The line above the rank: the active boost with its time, the vote links as masked links, or nothing when the server has it off.
  const topggLink = 'https://top.gg/bot/55/vote';
  const omniplexLink = 'https://omniplex.gg/bots/55';
  const endStamp = `<t:${Math.floor(endsAt / 1000)}:R>`;
  const activeLine = { en: `⭐ +10% XP from your vote, ends ${endStamp}`, es: `⭐ +10% de XP por tu voto, termina ${endStamp}`, 'pt-BR': `⭐ +10% de XP pelo seu voto, termina ${endStamp}` };
  const voteLine = {
    en: `**Vote boost:** vote now for +10% XP for 12 hours: [top.gg](<${topggLink}>) or [omniplex.gg](<${omniplexLink}>)`,
    es: `**Bonus por voto:** vota ahora y recibe +10% de XP durante 12 horas: [top.gg](<${topggLink}>) o [omniplex.gg](<${omniplexLink}>)`,
    'pt-BR': `**Bônus de voto:** vote agora e receba +10% de XP por 12 horas: [top.gg](<${topggLink}>) ou [omniplex.gg](<${omniplexLink}>)`,
  };
  for (const lang of ['en', 'es', 'pt-BR']) {
    assert.equal(buildBoostLine({ data: withBoost, botId: '55', lang }), activeLine[lang], `the active boost line (${lang})`);
    assert.ok(!/https?:/.test(buildBoostLine({ data: withBoost, botId: '55', lang })), 'with no link');
    assert.equal(buildBoostLine({ data: voteNow, botId: '55', lang }), voteLine[lang], `the vote line (${lang})`);
    assert.equal(buildBoostLine({ data: noBoost, botId: '55', lang }), '', `nothing when the server has the boost off (${lang})`);
  }
  assert.match(buildBoostLine({ data: withBoost, botId: '55', own: false, lang: 'en' }), /from their vote, ends <t:\d+:R>/, 'the boost of somebody else');
  assert.equal(buildBoostLine({ data: { ...withBoost, voteBoost: { percent: 10, endsAt: Date.now() - 1 } }, botId: '55' }), '', 'a boost that ended is not announced');
  // Every link is a masked link with its address between < and >: a short label, and no preview box.
  const linkText = buildBoostLine({ data: voteNow, botId: '55', lang: 'en' });
  assert.equal([...linkText.matchAll(/\[[^\]]+\]\(<https?:\/\/[^\s<>]+>\)/g)].length, 2, 'two masked links, both with the address wrapped');
  assert.equal(linkText.replace(/\[[^\]]+\]\(<https?:\/\/[^\s<>]+>\)/g, '').includes('http'), false, 'and no address outside them');
  assert.ok(linkText.includes('[top.gg](') && linkText.includes('[omniplex.gg]('), 'labelled with the names of the lists');

  // The message: the same line comes with the embed, over the picture of the bar.
  const reply = await buildRankReply({ style: 'embed', ctx: {}, data: voteNow, name: 'Liam', avatarUrl: null, cardName: null, source: 'messages', botId: '55', lang: 'en' });
  assert.equal(reply.content, voteLine.en, 'the line is the content of the message');
  assert.equal(reply.embeds.length, 1);
  const off = await buildRankReply({ style: 'embed', ctx: {}, data: noBoost, name: 'Liam', avatarUrl: null, cardName: null, source: 'messages', botId: '55', lang: 'en' });
  assert.equal(off.content, undefined, 'a server with the boost off gets no extra line');

  // The rank card: the default card has no badge, with or without a boost.
  stub('src/db/imageCards.js', { getCard: async () => null });
  stub('src/db/cardAssets.js', { getAsset: async () => null });
  stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });
  delete require.cache[require.resolve('../src/utils/cardService')];
  const { defaultRankCard, renderRankCard } = require('../src/utils/cardService');
  const { normalizeBasic, buildBasicLayers } = require('../src/utils/cardPresets');
  const basic = normalizeBasic(defaultRankCard('messages').basic, 'rank');
  assert.equal('showBoost' in basic, false, 'the card has no boost setting');
  assert.equal('showBoost' in defaultRankCard('messages').basic, false, 'and the default card does not ask for one');
  for (const layers of [buildBasicLayers(defaultRankCard('messages').basic, 1024, 320, 'rank'), buildBasicLayers(defaultRankCard('voice').basic, 1024, 320, 'rank'), buildBasicLayers({ preset: 'rank' }, 1024, 320, 'rank')]) {
    assert.equal(layers.some((layer) => layer.id === 'boost' || /level_vote_boost/.test(layer.text ?? '')), false, 'no badge layer in the card');
  }
  const user = { id: '1', username: 'liam', displayName: 'liam', displayAvatarURL: () => null, createdAt: new Date() };
  const fakeGuild = { id: '9', name: 'Petto', memberCount: 5, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const fakeMember = { id: '1', user, displayName: 'liam', displayAvatarURL: () => null, joinedTimestamp: 1, roles: { cache: new Collection(), highest: { name: 'Member' } }, premiumSince: null };
  const levelData = { level: 12, xp: 23450, xpNeeded: 2350, xpCurrent: 1420, xpToNext: 930, progress: 60, rank: 3, total: 120, source: 'text' };
  const plain = await renderRankCard({ guild: fakeGuild, member: fakeMember, user, levelData: { ...levelData, voteBoost: null } }, null, 'messages');
  const withBoostCard = await renderRankCard({ guild: fakeGuild, member: fakeMember, user, levelData: { ...levelData, voteBoost: { percent: 10, endsAt } } }, null, 'messages');
  assert.deepEqual([...plain.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the card without a boost is a PNG');
  assert.deepEqual([...withBoostCard.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'and so is the one with it');
  assert.deepEqual(plain.buffer, withBoostCard.buffer, 'the boost does not change the picture: the notice is outside of it');

  // The server switch in /levels settings rules.
  const level = require('../src/commands/leveling/level');
  assert.deepEqual(level.RULE_SETTINGS.vote_boost, { column: 'vote_boost_enabled', kind: 'flag' }, 'the switch is a setting of the rules');
  assert.equal(level.readRuleValue(level.RULE_SETTINGS.vote_boost, 'off'), false);
  assert.equal(level.readRuleValue(level.RULE_SETTINGS.vote_boost, 'on'), true);
  assert.equal(level.readRuleValue(level.RULE_SETTINGS.vote_boost, 'maybe'), null);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src/db/schema.sql'), 'utf8');
  assert.match(schema, /alter table level_config add column if not exists vote_boost_enabled boolean not null default true;/i, 'the column is idempotent and on by default');
  assert.match(schema, /create index if not exists idx_bot_votes_user_voted on bot_votes \(user_id, voted_at desc\);/i, 'the index is idempotent');

  // The votes command.
  const votesCommand = require('../src/commands/info/votes');
  const replies = [];
  const interactionFor = (locale, userId) => ({
    guildId: null, locale, client, user: { id: userId },
    options: { getSubcommand: () => 'show', getUser: () => null },
    reply: async (payload) => { replies.push(JSON.stringify(payload.components.map((component) => component.toJSON()))); },
  });
  const expectedBoost = { en: /Vote boost active:\*\* \+10% XP, ends <t:\d+:R>/, es: /Bonus por voto activo:\*\* \+10% de XP, termina <t:\d+:R>/, 'pt-BR': /Bônus de voto ativo:\*\* \+10% de XP, termina <t:\d+:R>/ };
  const expectedNone = { en: /No vote boost right now.*\+10% XP for 12 hours/, es: /No tienes un bonus por voto ahora.*\+10% de XP durante 12 horas/, 'pt-BR': /Você não tem um bônus de voto agora.*\+10% de XP por 12 horas/ };
  for (const locale of ['en-US', 'es-419', 'pt-BR']) {
    const lang = locale === 'en-US' ? 'en' : locale === 'es-419' ? 'es' : 'pt-BR';
    voteBoost.resetVoteBoostCache();
    await votesCommand.execute(interactionFor(locale, '700000000000000001'));
    assert.match(replies.at(-1), expectedNone[lang], `no boost: how to get it (${lang})`);
    assert.match(replies.at(-1), /top\.gg\/bot\/1\/vote/, 'top.gg link');
    assert.match(replies.at(-1), /omniplex\.gg\/bots\/1/, 'omniplex link');
    voteBoost.noteVote('700000000000000002', endsAt);
    await votesCommand.execute(interactionFor(locale, '700000000000000002'));
    assert.match(replies.at(-1), expectedBoost[lang], `active boost with the time left (${lang})`);
  }
  process.env.OMNIPLEX_VOTE_URL = 'https://example.org/vote-for-petto';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/utils/voteLists')];
  assert.equal(require('../src/utils/voteLists').voteUrl('omniplex', '55'), 'https://example.org/vote-for-petto', 'OMNIPLEX_VOTE_URL overrides the link');

  // The leveling rules summary says whether the switch is on, in the three languages.
  assert.equal(warnings.filter((line) => /vote boost/i.test(line)).length, 0, 'nothing warned about the boost');
  const { CATALOGS } = require('../src/i18n');
  for (const key of ['leveling.rules.voteBoostOn', 'leveling.rules.voteBoostOff', 'leveling.rankView.boostActive', 'leveling.rankView.boostActiveOther', 'leveling.rankView.voteNow', 'votes.boost.active', 'votes.boost.inactive', 'votes.boost.note', 'votes.thanks.boost', 'embeds.value.voteBoost', 'embeds.var.leveling.levelVoteBoost']) {
    assert.ok(CATALOGS.en[key] && CATALOGS.es[key] && CATALOGS['pt-BR'][key], `${key} exists in the three languages`);
    assert.notEqual(CATALOGS.es[key], CATALOGS.en[key], `${key} is translated to Spanish`);
    assert.notEqual(CATALOGS['pt-BR'][key], CATALOGS.en[key], `${key} is translated to Portuguese`);
  }
  console.log('Checked the vote boost: expiry, cache, +10% on chat and voice XP, the switch, the omniplex webhook and the texts.');
})().catch((error) => { console.error(error); process.exit(1); });
