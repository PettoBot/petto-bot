// The two error channels and the triage that feeds them: what is expected (general log, a warning, never a ping) and what needs a look (priority
// log), the fingerprints, the secrets and mentions that never reach a card, the ping policy, the repeat count that edits a card, the size of the
// card, the routing with and without a priority channel, the settings, and the net around every ticket button (early answer, a channel that is
// already gone, a double press, an expired interaction, one retry, a friendly failure that reaches the team). Fakes only: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
// The ticket actions are run against fakes: no transcript is built, no log is sent.
const realTranscript = require('../src/utils/ticketTranscript');
let transcriptFails = null;
stub('src/utils/ticketTranscript.js', { ...realTranscript, buildTranscript: async () => { if (transcriptFails) throw transcriptFails; return { html: '<html></html>', messageCount: 3 }; } });
stub('src/logging/engine.js', { sendLog: async () => {}, fetchEntry: async () => null });

// What the checks print stays short: the lines of the logger about the fakes are not shown.
for (const level of ['info', 'warn']) require('../src/utils/logger')[level] = () => {};

const triage = require('../src/utils/errorTriage');
const { classify, fingerprint, redactSecrets, stripMentions } = triage;
const { createPriorityErrorSink, createPingPolicy, pingParts, buildPriorityCard, textLength } = require('../src/utils/priorityErrorLog');
const { createErrorRouter } = require('../src/utils/errorRouting');
const { createDiscordErrorLogSink } = require('../src/utils/discordErrorLog');
const { safeTicketAction } = require('../src/utils/safeTicketAction');
const { reportInteractionError } = require('../src/utils/interactionErrors');

const api = (code, message, extra = {}) => Object.assign(new Error(message), { name: 'DiscordAPIError', code, status: 404, method: 'POST', ...extra });
const coded = (code, message = 'x') => Object.assign(new Error(message), { code });
const OWNER = '293504726505357312';
const ROLE = '444444444444444444';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------------------------------------
function checkClassification() {
  const general = [
    [api(10062, 'Unknown interaction'), 'unknown-interaction'],
    [api(10003, 'Unknown Channel'), 'unknown-channel'],
    [api(10008, 'Unknown Message'), 'unknown-message'],
    [api(10007, 'Unknown Member'), 'unknown-member'],
    [api(10013, 'Unknown User'), 'unknown-user'],
    [api(10004, 'Unknown Guild'), 'unknown-guild'],
    [api(10015, 'Unknown Webhook'), 'unknown-webhook'],
    [api(40060, 'Interaction has already been acknowledged.'), 'already-acknowledged'],
    [api(50001, 'Missing Access', { status: 403 }), 'missing-access'],
    [api(50013, 'Missing Permissions', { status: 403 }), 'missing-permissions'],
    [api(50007, 'Cannot send messages to this user', { status: 403 }), 'dm-closed'],
    [api(30005, 'Maximum number of server roles reached'), 'discord-limit'],
    [api(30007, 'Maximum number of webhooks reached'), 'discord-limit'],
    [Object.assign(new Error('You are being rate limited.'), { status: 429 }), 'rate-limit'],
    [api(0, 'Service unavailable', { status: 503 }), 'discord-outage'],
    [coded('ECONNRESET', 'read ECONNRESET'), 'network'],
    [coded('ETIMEDOUT', 'connect ETIMEDOUT'), 'network'],
    [coded('EAI_AGAIN', 'getaddrinfo EAI_AGAIN discord.com'), 'network'],
    [new Error('fetch failed'), 'network'],
    [new Error('Request took more than 15 seconds'), 'timeout'],
    [new Error('[Redis] a command failed (timed out); skipping Redis for 10s.'), 'redis-timeout'],
    [coded('57P01', 'terminating connection due to administrator command'), 'database-connection'],
    [new Error('Connection terminated unexpectedly'), 'database-connection'],
    // The two errors of the screenshots of the team.
    [api(10062, 'Unknown interaction', { url: 'https://discord.com/api/v10/interactions/123456789012345678/tokentokentoken1234/callback' }), 'unknown-interaction'],
    [api(10003, 'Unknown Channel', { status: 404 }), 'unknown-channel'],
  ];
  for (const [error, kind] of general) {
    const result = classify(error, { args: ['Ticket rating failed:', error] });
    assert.equal(result.priority, false, `${kind} is not priority`);
    assert.equal(result.benign, true);
    assert.equal(result.kind, kind, `${error.message} is ${kind}`);
    assert.ok(result.explanation && result.explanation.length > 20, `${kind} has a human explanation`);
    assert.match(result.fingerprint, /^[0-9a-f]{10}$/);
  }
  assert.match(classify(api(10062, 'Unknown interaction')).explanation, /took more than 3 seconds to answer.*Not a bug by itself/);
  assert.equal(classify(api(10003, 'Unknown Channel')).fix, 'already-done');
  assert.equal(classify(api(10062, 'x')).fix, 'late-answer');
  assert.equal(classify(coded('ETIMEDOUT')).fix, 'retry');

  const priority = [
    [new TypeError("Cannot read properties of undefined (reading 'id')"), 'code-bug'],
    [new ReferenceError('x is not defined'), 'code-bug'],
    [new SyntaxError('Unexpected token'), 'code-bug'],
    [coded('42601', 'syntax error at or near "FROM"'), 'database-syntax'],
    [coded('42P01', 'relation "x" does not exist'), 'database-syntax'],
    [coded('23505', 'duplicate key value violates unique constraint'), 'database-error'],
    [api(99999, 'Something new'), 'unknown-api-code'],
    [api(50035, 'Invalid Form Body'), 'invalid-form-body'],
    [new Error('the handler threw something odd'), 'unexpected-error'],
  ];
  for (const [error, kind] of priority) {
    const result = classify(error, { args: ['Handler failed:', error] });
    assert.equal(result.priority, true, `${kind} is priority (${error.message})`);
    assert.equal(result.benign, false);
    assert.equal(result.kind, kind);
    assert.equal(result.fix, 'investigate');
  }
  assert.equal(classify(null, { args: ['an error with nothing but text'] }).priority, true, 'an error with no error object is priority');
  assert.equal(classify(null, { args: ['request timed out'] }).priority, false, 'text only: a timeout is expected');
  assert.equal(classify(api(50013, 'Missing Permissions'), { internal: true }).priority, true, 'a missing permission in the places of Petto itself needs a look');
  assert.equal(classify(coded('ETIMEDOUT'), { exhausted: true }).priority, true, 'a timeout that failed again after the retry needs a look');
  assert.equal(classify(api(10062, 'x'), { exhausted: true }).priority, false, 'an expired interaction never does');
  assert.equal(classify(new TypeError('timed out')).priority, true, 'a bug is a bug, whatever its text says');
  assert.equal(triage.EXPLAIN_UNKNOWN, 'Unknown: needs a look.');

  // The same problem on two servers and at two times is one fingerprint; a different problem is another.
  const a = coded('42601', 'syntax error at position 12 near 7');
  const b = coded('42601', 'syntax error at position 98 near 41');
  assert.equal(fingerprint({ kind: 'x', text: 'Ticket 1234567890123456 failed in 4ms', error: null }), fingerprint({ kind: 'x', text: 'Ticket 9999999999999999 failed in 88ms', error: null }));
  assert.equal(classify(a).fingerprint, classify(b).fingerprint, 'ids and numbers are ignored');
  assert.notEqual(classify(a).fingerprint, classify(new TypeError('syntax error at position 12')).fingerprint);
  assert.notEqual(classify(new TypeError('a is not a function')).fingerprint, classify(new TypeError('b is not a function')).fingerprint);
  const here = new TypeError('x'); here.stack = 'TypeError: x\n    at one (/app/src/a.js:10:5)\n    at two (/app/src/b.js:1:1)';
  const there = new TypeError('x'); there.stack = 'TypeError: x\n    at other (/app/src/c.js:10:5)';
  assert.notEqual(classify(here).fingerprint, classify(there).fingerprint, 'the first frame is part of it');
  const moved = new TypeError('x'); moved.stack = 'TypeError: x\n    at one (/app/src/a.js:99:7)';
  assert.equal(classify(here).fingerprint, classify(moved).fingerprint, 'a line that moved is the same problem');
}

// ---------------------------------------------------------------------------------------------------------------------
// Secrets and mentions.
// ---------------------------------------------------------------------------------------------------------------------
function checkRedaction() {
  const token = `MTIzNDU2Nzg5MDEyMzQ1Njc4OTA.GabcDE.${'x'.repeat(30)}`;
  const text = redactSecrets(`token ${token} db postgres://petto:hunter2@db.example.com:5432/petto cache redis://:s3cret@cache:6379 header Authorization: Bearer abc.def.ghijklmnop1234 and Bearer abcdefghijklmnop1234567890`
    + ' hook https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUv_123456 cb https://discord.com/api/v10/interactions/123456789012345678/aW50ZXJhY3Rpb25Ub2tlbg123456/callback password=hunter2 api_key: k-12345 https://x.test/a?sig=abcdef');
  for (const secret of [token, 'hunter2', 's3cret', 'AbCdEfGhIjKlMnOpQrStUv_123456', 'aW50ZXJhY3Rpb25Ub2tlbg123456', 'abcdefghijklmnop1234567890', 'sig=abcdef', 'k-12345']) assert.ok(!text.includes(secret), `${secret} is removed: ${text}`);
  assert.ok(text.includes('postgres://[REDACTED]@db.example.com') && text.includes('/webhooks/123456789012345678/[REDACTED]'), 'the rest of the address stays readable');
  const env = { DISCORD_TOKEN: 'a-very-long-secret-value-1234', OTHER: 'plain', PETTO_DB_PASSWORD: 'p4ssw0rd-long' };
  assert.equal(redactSecrets('the value a-very-long-secret-value-1234 and p4ssw0rd-long', { env }), 'the value [REDACTED] and [REDACTED]', 'the values of secret environment variables are removed wherever they are');
  assert.equal(redactSecrets('nothing to hide here'), 'nothing to hide here');

  const stripped = stripMentions('@everyone @here <@123456789012345678> <@!123456789012345678> <@&123456789012345678> <#123456789012345678> @someone');
  assert.ok(!/@everyone|@here/.test(stripped) && !/<@!?&?\d/.test(stripped) && !/<#\d/.test(stripped), stripped);
}

// ---------------------------------------------------------------------------------------------------------------------
// The card: mentions, secrets, size.
// ---------------------------------------------------------------------------------------------------------------------
function hostileEntry(overrides = {}) {
  const evil = '@everyone @here <@293504726505357312> <@&444444444444444444> postgres://u:pw@h/db';
  const error = new TypeError(`${evil} ${'long '.repeat(400)}`);
  error.stack = `TypeError: x\n${Array.from({ length: 12 }, (_, i) => `    at fn${i} (/home/app/src/very/long/path/${'dir/'.repeat(30)}file${i}.js:${i + 1}:5)`).join('\n')}`;
  return {
    level: 'error',
    args: [`${evil} ${'event '.repeat(200)}`, error],
    stamp: new Date().toISOString(),
    context: { guildId: '111111111111111111', channelId: '222222222222222222', userId: '333333333333333333', command: `${evil} ${'c'.repeat(300)}`, action: evil, source: 'interactionCreate' },
    names: { guild: `${evil} ${'g'.repeat(300)}`, channel: `#${evil}`, user: evil },
    count: 3,
    firstAt: Date.now() - 60_000,
    lastAt: Date.now(),
    recent: Array.from({ length: 5 }, (_, i) => `[12:00:0${i}] WARN ${evil} ${'recent '.repeat(60)}`),
    ...overrides,
  };
}

function checkCard() {
  const ping = pingParts({ userIds: [OWNER, 'not-an-id'], roleId: ROLE });
  assert.deepEqual(ping.allowedMentions, { parse: [], users: [OWNER], roles: [ROLE], repliedUser: false }, 'exactly the configured user and role');
  assert.equal(ping.text, `<@${OWNER}> <@&${ROLE}>`);
  assert.deepEqual(pingParts({}).allowedMentions.users, [], 'no ids, no ping');

  const card = buildPriorityCard(hostileEntry({ pingText: ping.text }), { allowedMentions: ping.allowedMentions });
  const json = JSON.stringify(card.components.map((component) => component.toJSON()));
  // The only mentions in the whole card are the ones Petto wrote itself, in the first line.
  const mentions = json.match(/<@[!&]?\d+>/g) ?? [];
  assert.deepEqual(mentions, [`<@${OWNER}>`, `<@&${ROLE}>`], 'no text of an error can make a mention');
  assert.ok(!/@everyone|@here/.test(json), 'no @everyone or @here');
  assert.ok(!json.includes('pw@') && !json.includes('u:pw'), 'the password of the address in the message is removed');
  assert.deepEqual(card.allowedMentions, ping.allowedMentions);
  assert.equal(card.flags & 32768, 32768, 'a Components V2 card');
  assert.equal(card.components[0].toJSON().accent_color, 0xfe6465, 'red');
  const total = textLength(card);
  assert.ok(total <= 4000, `the card has ${total} characters; Discord accepts 4000`);
  for (const title of ['Petto priority error', 'What it probably means', 'Count in the last 10 minutes', 'Copy this to investigate', 'Stack (top 6 frames)', '**Details**', '**Server**', '**Command / source**']) assert.ok(json.includes(title), `${title} is on the card`);
  assert.ok(!json.includes('**Details**\\n```text\\n```'), 'sanity');

  // Not pinging: no mention text and nobody allowed.
  const quiet = buildPriorityCard(hostileEntry());
  assert.deepEqual(quiet.allowedMentions, { parse: [] });
  assert.ok(!(JSON.stringify(quiet.components.map((c) => c.toJSON())).match(/<@[!&]?\d+>/g) ?? []).length, 'a card with no ping has no mention at all');

  // A small error is not clipped, a huge one always fits; a block of code cannot be closed from inside.
  const small = buildPriorityCard({ level: 'error', args: ['Ticket rating failed:', api(99999, 'x')], context: {}, count: 1, firstAt: 1, lastAt: 1 });
  assert.ok(textLength(small) < 2500);
  const breakout = buildPriorityCard(hostileEntry({ args: ['``` break out ```', new Error('``` more ```')] }));
  assert.ok(!/```\s*break out/.test(JSON.stringify(breakout.components.map((c) => c.toJSON())).replace(/\\n/g, '\n')), 'the fences of a text do not close the block');
  for (let i = 0; i < 20; i += 1) {
    const filler = 'x'.repeat(1 + i * 700);
    const worst = buildPriorityCard(hostileEntry({ args: [filler, Object.assign(new Error(filler), { code: 99999 })], recent: Array(5).fill(filler), names: { guild: filler, channel: filler, user: filler }, context: { guildId: '1'.repeat(25), channelId: '2'.repeat(25), userId: '3'.repeat(25), command: filler, action: filler } }));
    assert.ok(textLength(worst) <= 4000, `worst case ${i}: ${textLength(worst)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The ping policy.
// ---------------------------------------------------------------------------------------------------------------------
function checkPolicy() {
  let clock = 1_000_000;
  const policy = createPingPolicy({ now: () => clock });
  assert.equal(policy.allow('a'), true, 'the first of a problem pings');
  clock += 29 * 60_000;
  assert.equal(policy.allow('a'), false, 'the same problem again inside 30 minutes does not');
  clock += 2 * 60_000;
  assert.equal(policy.allow('a'), true, 'after 30 minutes it can');
  // Five an hour in all.
  clock = 50_000_000;
  const hourly = createPingPolicy({ now: () => clock });
  const results = ['1', '2', '3', '4', '5', '6', '7'].map((fp) => { clock += 60_000; return hourly.allow(fp); });
  assert.deepEqual(results, [true, true, true, true, true, false, false], 'at most 5 pings an hour');
  clock += 60 * 60_000;
  assert.equal(hourly.allow('8'), true, 'the hour passes and it can again');
}

// ---------------------------------------------------------------------------------------------------------------------
// The sink and the router, with a fake channel.
// ---------------------------------------------------------------------------------------------------------------------
function fakeClient(channels) {
  const cache = new Map(Object.entries(channels));
  return { channels: { cache, fetch: async (id) => cache.get(id) ?? null }, guilds: { cache: new Map([['111111111111111111', { name: 'Luna' }]]) }, users: { cache: new Map() } };
}
function fakeChannel(log) {
  let n = 0;
  return {
    isTextBased: () => true,
    send: async (payload) => { n += 1; const message = { id: `m${n}`, payload, edits: [], edit: async (edit) => { message.edits.push(edit); } }; log.push(message); return message; },
  };
}

async function checkSinkAndRouter() {
  let clock = 5_000_000;
  const now = () => clock;

  // 1. A priority channel: a card, a ping once, the repeat edits the card.
  const posted = [];
  const client = fakeClient({ priority: fakeChannel(posted) });
  const sink = createPriorityErrorSink(client, { channelId: 'priority', fallbackChannelId: 'general', pingUserIds: [OWNER], pingRoleId: ROLE, now, gapMs: 0, editGapMs: 0 });
  const boom = () => new TypeError('Cannot read properties of undefined (reading "id")');
  const context = { guildId: '111111111111111111', channelId: '222222222222222222', userId: '333333333333333333', command: 'tk_delete', source: 'interactionCreate' };
  const tri = (error) => classify(error, { args: ['Ticket button "tk_delete" failed:', error] });
  const e1 = boom();
  await sink('error', ['Ticket button "tk_delete" failed:', e1], new Date(clock).toISOString(), context, tri(e1), { recent: ['[12:00:00] WARN [Redis] timed out'] });
  assert.equal(posted.length, 1);
  const first = JSON.stringify(posted[0].payload.components.map((c) => c.toJSON()));
  assert.ok(first.includes(`<@${OWNER}>`) && first.includes(`<@&${ROLE}>`), 'the first card pings');
  assert.deepEqual(posted[0].payload.allowedMentions.users, [OWNER]);
  assert.ok(first.includes('Luna') && first.includes('[12:00:00] WARN [Redis] timed out'), 'the server name and the recent general lines are in it');
  clock += 60_000;
  const e2 = boom();
  await sink('error', ['Ticket button "tk_delete" failed:', e2], new Date(clock).toISOString(), context, tri(e2), {});
  clock += 60_000;
  const e3 = boom();
  await sink('error', ['Ticket button "tk_delete" failed:', e3], new Date(clock).toISOString(), context, tri(e3), {});
  assert.equal(posted.length, 1, 'the same problem inside 10 minutes is not posted again');
  assert.equal(posted[0].edits.length, 2, 'the card is edited instead');
  const edited = JSON.stringify(posted[0].edits[1].components.map((c) => c.toJSON()));
  assert.match(edited, /Count in the last 10 minutes\*\* 3/, 'with the count');
  assert.deepEqual(posted[0].edits[1].allowedMentions.users, [OWNER], 'an edit keeps the same mentions and so never pings anew');

  // After the window it is a new card, and 30 minutes have not passed since the ping: no ping.
  clock += 11 * 60_000;
  const e4 = boom();
  await sink('error', ['Ticket button "tk_delete" failed:', e4], new Date(clock).toISOString(), context, tri(e4), {});
  assert.equal(posted.length, 2, 'after ten minutes it is a new card');
  assert.ok(!/<@\d+>/.test(JSON.stringify(posted[1].payload.components.map((c) => c.toJSON()))), 'no second ping within 30 minutes');
  assert.deepEqual(posted[1].payload.allowedMentions, { parse: [] });
  // Another problem pings (up to the limit of the hour).
  const other = new ReferenceError('nope is not defined');
  await sink('error', ['Another handler failed:', other], new Date(clock).toISOString(), {}, classify(other, { args: [other] }), {});
  assert.deepEqual(posted[2].payload.allowedMentions.users, [OWNER], 'a different problem pings');
  // A deleted card is posted again.
  posted[2].edit = async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); };
  clock += 60_000;
  await sink('error', ['Another handler failed:', other], new Date(clock).toISOString(), {}, classify(other, { args: [other] }), {});
  clock += 60_000;
  await sink('error', ['Another handler failed:', other], new Date(clock).toISOString(), {}, classify(other, { args: [other] }), {});
  assert.equal(posted.length, 4, 'when the card was deleted the next one is posted again');

  // 2. The router: expected errors and warnings to the general log (as warnings), the rest to the priority log.
  const generalCalls = [];
  const priorityCalls = [];
  const router = createErrorRouter({
    general: async (level, args, stamp, ctx) => { generalCalls.push({ level, args, ctx }); },
    priority: async (level, args, stamp, ctx, tri2, extras) => { priorityCalls.push({ level, args, tri: tri2, extras }); },
    now,
  });
  await router('info', ['hello'], 's', {});
  await router('warn', ['[Redis] a command failed (timed out); skipping Redis for 10s.'], 's', {});
  await router('warn', [new TypeError('a warning is never priority')], 's', {});
  await router('error', ['Ticket rating failed:', api(10062, 'Unknown interaction')], 's', { source: 'interactionCreate' });
  await router('error', ['Ticket button "tk_delete" failed:', api(10003, 'Unknown Channel')], 's', {});
  await router('error', ['Unhandled promise rejection:', new TypeError('x of undefined')], 's', {});
  await router('error', ['Handler failed:', coded('42601', 'syntax error')], 's', {});
  await router('error', ['Final:', coded('ETIMEDOUT', 'timeout')], 's', { exhausted: true });
  assert.equal(generalCalls.length, 4, 'two warnings and the two expected errors go to the general log');
  assert.ok(generalCalls.every((call) => call.level === 'warn'), 'always as warnings');
  assert.ok(generalCalls[2].ctx.triaged && /took more than 3 seconds/.test(generalCalls[2].ctx.explanation), 'with what it means');
  assert.equal(priorityCalls.length, 3, 'the bug, the database syntax error and the exhausted timeout are priority');
  assert.deepEqual(priorityCalls.map((call) => call.tri.kind), ['code-bug', 'database-syntax', 'network-persisted']);
  assert.ok(priorityCalls[0].extras.recent.length >= 1 && priorityCalls[0].extras.recent.length <= 5, 'with the last lines of the general log');

  // 3. The general sink: an expected error that was turned into a warning is told even if it says "Missing Permissions"; rate limit notes are not.
  const sent = [];
  const generalChannel = { isTextBased: () => true, send: async (payload) => { sent.push(payload); } };
  const generalSink = createDiscordErrorLogSink({ channels: { cache: new Map([['g', generalChannel]]), fetch: async () => generalChannel } }, 'g', { gapMs: 1, now });
  await generalSink('warn', ['Missing Permissions in a server'], new Date().toISOString(), { triaged: true, explanation: 'The server did not give Petto a permission.' });
  await generalSink('warn', ['[Discord REST] user rate limit on GET /x; retry after 1s'], new Date().toISOString(), { triaged: false });
  await sleep(30);
  assert.equal(sent.length, 1, 'the expected error is told, the rate limit note is not');
  const embed = sent[0].embeds[0].toJSON();
  assert.match(embed.title, /Petto warning/);
  assert.ok(embed.fields.some((field) => field.name === 'What it means' && /server did not give/.test(field.value)), 'the general card says what it means');
  assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'the general log never pings');

  // 4. No priority channel: the card goes to the general channel marked as priority, and the warning is logged once.
  const inGeneral = [];
  const warnings = [];
  const fallbackSink = createPriorityErrorSink(fakeClient({ general: fakeChannel(inGeneral) }), { channelId: null, fallbackChannelId: 'general', pingUserIds: [OWNER], now, gapMs: 0, editGapMs: 0, warn: (...args) => warnings.push(args.join(' ')) });
  const bug = new TypeError('first');
  const bug2 = new ReferenceError('second');
  await fallbackSink('error', ['one', bug], 's', {}, classify(bug, { args: [bug] }), {});
  await fallbackSink('error', ['two', bug2], 's', {}, classify(bug2, { args: [bug2] }), {});
  assert.equal(inGeneral.length, 2, 'priority errors still arrive');
  assert.match(JSON.stringify(inGeneral[0].payload.components.map((c) => c.toJSON())), /Posted in the general log because the priority channel is not set or cannot be reached/, 'marked as priority in the general channel');
  assert.equal(warnings.length, 1, 'the missing channel is warned about once');
  assert.match(warnings[0], /PETTO_PRIORITY_ERRORS_CHANNEL_ID/);
  // And with neither channel nothing breaks.
  const nowhere = createPriorityErrorSink(fakeClient({}), { channelId: null, fallbackChannelId: null, now, gapMs: 0, warn: () => {} });
  await nowhere('error', ['x', bug], 's', {}, classify(bug, { args: [bug] }), {});

  // 5. The top level of the interactions: an expired press is a warning, a bug is an error, and both say where.
  const calls = [];
  const logger = require('../src/utils/logger');
  const originals = { warn: logger.warn, error: logger.error };
  logger.warn = (...args) => calls.push(['warn', ...args]);
  logger.error = (...args) => calls.push(['error', ...args]);
  try {
    const interaction = { guildId: '111111111111111111', channelId: '222222222222222222', user: { id: '333333333333333333' }, customId: 'dmrep:123:team', commandName: undefined };
    assert.equal(reportInteractionError(interaction, 'Error handling a button under a direct message:', api(10062, 'Unknown interaction')).benign, true);
    assert.equal(reportInteractionError(interaction, 'Error executing /ping:', new TypeError('bug')).priority, true);
  } finally { Object.assign(logger, originals); }
  assert.equal(calls[0][0], 'warn', 'an expired interaction is a warning');
  assert.equal(calls[0][1].userId, '333333333333333333');
  assert.equal(calls[0][1].source, 'interactionCreate');
  assert.equal(calls[1][0], 'error', 'a bug is an error');
}

// ---------------------------------------------------------------------------------------------------------------------
// The settings.
// ---------------------------------------------------------------------------------------------------------------------
function checkConfig() {
  const read = (env) => JSON.parse(execFileSync(process.execPath, ['-e', 'const c = require("./src/config"); console.log(JSON.stringify({ ping: c.priorityPing, channel: c.opsChannels.priorityErrors, general: c.errorLogChannelId }))'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: '1', DISCLOUD_DATABASE_URL: 'postgres://c:c@127.0.0.1:1/c', DOTENV_CONFIG_QUIET: 'true', ...env },
    encoding: 'utf8',
  }).trim().split('\n').pop());
  const A = '111111111111111111';
  const B = '222222222222222222';
  assert.deepEqual(read({}).ping, { userIds: [OWNER], roleId: null }, 'by default the owner');
  assert.equal(read({}).channel, null, 'no priority channel by default');
  assert.deepEqual(read({ PETTO_DEVELOPER_IDS: `${A},${B}` }).ping.userIds, [A], 'else the first developer');
  assert.deepEqual(read({ PETTO_DEVELOPER_IDS: `${A},${B}`, PETTO_PRIORITY_PING_USER_IDS: `${B}, ${A}, junk`, PETTO_PRIORITY_PING_ROLE_ID: ROLE }).ping, { userIds: [B, A], roleId: ROLE }, 'the list of the settings, with a role');
  assert.equal(read({ PETTO_PRIORITY_ERRORS_CHANNEL_ID: A, PETTO_ERROR_LOG_CHANNEL_ID: B }).channel, A);
  assert.equal(read({ PETTO_PRIORITY_ERRORS_CHANNEL_ID: A, PETTO_ERROR_LOG_CHANNEL_ID: B }).general, B, 'the general channel keeps its variable');
}

// ---------------------------------------------------------------------------------------------------------------------
// The net around the tickets.
// ---------------------------------------------------------------------------------------------------------------------
function fakeInteraction(extra = {}) {
  const calls = [];
  const interaction = {
    calls,
    deferred: false,
    replied: false,
    guildId: '111111111111111111',
    channelId: '300',
    customId: 'tk_delete::3',
    user: { id: '333333333333333333' },
    channel: { id: '300', send: async (payload) => { calls.push(['channel.send', payload]); } },
    deferReply: async (options) => { calls.push(['deferReply', options]); interaction.deferred = true; },
    deferUpdate: async () => { calls.push(['deferUpdate']); interaction.deferred = true; },
    editReply: async (payload) => { calls.push(['editReply', payload]); interaction.replied = true; },
    followUp: async (payload) => { calls.push(['followUp', payload]); },
    reply: async (payload) => { calls.push(['reply', payload]); interaction.replied = true; },
    update: async (payload) => { calls.push(['update', payload]); interaction.replied = true; },
    showModal: async () => calls.push(['showModal']),
    ...extra,
  };
  return interaction;
}
function fakeLog() {
  const lines = [];
  return { lines, warn: (...a) => lines.push(['warn', ...a]), info: (...a) => lines.push(['info', ...a]), error: (...a) => lines.push(['error', ...a]) };
}
const said = (interaction) => interaction.calls.filter(([kind]) => ['editReply', 'followUp', 'reply', 'update'].includes(kind)).map(([, payload]) => String(payload.content ?? '')).join(' | ');

async function checkTicketNet() {
  const base = { lang: 'en', ack: 'reply' };

  // Early acknowledgement: before any of the work.
  let log = fakeLog();
  let i = fakeInteraction();
  const order = [];
  const original = i.deferReply;
  i.deferReply = async (options) => { order.push('ack'); return original(options); };
  const ok = await safeTicketAction(i, 'tk_delete', async (ctx) => { order.push('work'); await ctx.say('done'); }, base, { logger: log });
  assert.deepEqual(order, ['ack', 'work'], 'Discord is answered before the work starts');
  assert.equal(ok.status, 'ok');
  assert.equal(i.calls[0][1].flags, 64, 'a private answer');
  assert.equal(said(i), 'done');
  i = fakeInteraction();
  await safeTicketAction(i, 'tk_reopen', async () => {}, { ...base, ack: 'update' }, { logger: log });
  assert.equal(i.calls[0][0], 'deferUpdate', 'a button on a message is acknowledged as an update');

  // The channel is already gone: success, bookkeeping, no error.
  log = fakeLog();
  i = fakeInteraction();
  let healed = 0;
  const gone = await safeTicketAction(i, 'tk_delete', async () => { throw api(10003, 'Unknown Channel'); }, { ...base, onGone: async () => { healed += 1; return true; } }, { logger: log });
  assert.equal(gone.status, 'gone');
  assert.equal(healed, 1, 'the bookkeeping is finished');
  assert.ok(!log.lines.some(([level]) => level === 'error' || level === 'warn'), 'nothing is reported');
  assert.match(said(i), /already closed or gone/, 'and the member is told kindly');
  const notGone = await safeTicketAction(fakeInteraction(), 'tk_delete', async () => { throw api(10003, 'Unknown Channel'); }, { ...base, onGone: async () => false }, { logger: fakeLog() });
  assert.equal(notGone.status, 'failed', 'when the ticket channel is in fact still there it is a real failure');
  assert.equal((await safeTicketAction(fakeInteraction(), 'tk_open', async () => { throw api(10008, 'Unknown Message'); }, { ...base, goneIsDone: false }, { logger: fakeLog(), sleep: async () => {} })).status, 'failed', 'opening a ticket does not treat "gone" as done');

  // A second press while the first still works is harmless.
  log = fakeLog();
  let gate;
  const hold = new Promise((resolve) => { gate = resolve; });
  let runs = 0;
  const firstPress = safeTicketAction(fakeInteraction(), 'tk_delete', async () => { runs += 1; await hold; }, { ...base, lockKey: 'delete:3' }, { logger: log });
  await sleep(5);
  const second = fakeInteraction();
  const secondResult = await safeTicketAction(second, 'tk_delete', async () => { runs += 1; }, { ...base, lockKey: 'delete:3' }, { logger: log });
  gate();
  await firstPress;
  assert.equal(runs, 1, 'the work is done once');
  assert.equal(secondResult.status, 'busy');
  assert.match(said(second), /already working/);
  assert.equal((await safeTicketAction(fakeInteraction(), 'tk_delete', async () => { runs += 1; }, { ...base, lockKey: 'delete:3' }, { logger: log })).status, 'ok', 'and the lock is released');

  // An expired interaction: nothing logged as an error, the work still finishes, the member gets one normal message.
  log = fakeLog();
  i = fakeInteraction({ deferReply: async () => { throw api(10062, 'Unknown interaction'); } });
  let finished = false;
  const notes = [];
  const late = await safeTicketAction(i, 'tk_transcript', async (ctx) => { finished = true; await ctx.say('Transcript posted'); }, base, { logger: log, notify: async (text) => { notes.push(text); } });
  assert.equal(late.status, 'ok');
  assert.equal(finished, true, 'the work is done without the interaction');
  assert.ok(!log.lines.some(([level]) => level === 'error'), 'no error');
  assert.equal(notes.length, 1, 'one normal message instead of the dead reply');
  assert.match(notes[0], /took longer than Discord allows/);
  assert.ok(!i.calls.some(([kind]) => ['editReply', 'followUp', 'reply'].includes(kind)), 'nothing goes through the dead interaction');
  // The channel note is a real message, not a ping of anybody else.
  i = fakeInteraction({ deferReply: async () => { throw api(10062, 'Unknown interaction'); } });
  await safeTicketAction(i, 'tk_claim', async () => {}, base, { logger: fakeLog() });
  assert.deepEqual(i.calls.find(([kind]) => kind === 'channel.send')[1].allowedMentions, { users: ['333333333333333333'] }, 'only the member is mentioned');
  // It dies while the work runs.
  log = fakeLog();
  const dying = await safeTicketAction(fakeInteraction(), 'tk_close', async () => { throw api(10062, 'Unknown interaction'); }, { ...base, ack: 'none' }, { logger: log, notify: async () => {} });
  assert.equal(dying.status, 'expired');
  assert.ok(!log.lines.some(([level]) => level === 'error'));
  assert.equal(log.lines.filter(([level]) => level === 'warn').length, 1, 'a warning for the general log');

  // One retry on a timeout; after it works nobody hears of it.
  log = fakeLog();
  let attempts = 0;
  const sleeps = [];
  const recovered = await safeTicketAction(fakeInteraction(), 'tk_transcript', async () => { attempts += 1; if (attempts === 1) throw coded('ETIMEDOUT', 'connect ETIMEDOUT'); }, base, { logger: log, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(recovered.status, 'ok');
  assert.deepEqual([attempts, sleeps], [2, [1500]], 'tried again after 1.5 s');
  assert.equal(log.lines.length, 0, 'and nothing was reported');
  attempts = 0;
  const waits = [];
  await safeTicketAction(fakeInteraction(), 'tk_transcript', async () => { attempts += 1; if (attempts === 1) throw api(0, 'rate limited', { status: 429, retry_after: 3.2 }); }, base, { logger: fakeLog(), sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [3200], 'Discord is asked how long to wait');

  // A timeout that keeps happening: friendly message, and a PRIORITY error through the triage.
  log = fakeLog();
  i = fakeInteraction();
  attempts = 0;
  const failed = await safeTicketAction(i, 'tk_delete', async () => { attempts += 1; throw coded('ETIMEDOUT', 'connect ETIMEDOUT'); }, { ...base, label: 'Ticket button "tk_delete" failed:' }, { logger: log, sleep: async () => {} });
  assert.equal(failed.status, 'failed');
  assert.equal(attempts, 2, 'one retry and no more');
  assert.match(said(i), /did not work. The Petto team was told.*try again/, 'a short friendly message');
  assert.equal(i.calls.find(([kind]) => kind === 'editReply')[1].flags, undefined, 'the announced private answer is edited');
  const errorLogs = log.lines.filter(([level]) => level === 'error');
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0][1].exhausted, true);
  assert.equal(errorLogs[0][1].guildId, '111111111111111111');
  assert.equal(errorLogs[0][1].command, 'tk_delete');
  const generalCalls = [];
  const priorityCalls = [];
  const router = createErrorRouter({ general: async (...a) => generalCalls.push(a), priority: async (...a) => priorityCalls.push(a) });
  await router('error', errorLogs[0].slice(2), 's', errorLogs[0][1]);
  assert.equal(priorityCalls.length, 1, 'the failure reaches the priority log');
  assert.equal(generalCalls.length, 0);
  // Not an expected kind at all: no retry, priority at once.
  log = fakeLog();
  attempts = 0;
  await safeTicketAction(fakeInteraction(), 'tk_delete', async () => { attempts += 1; throw new TypeError('x is undefined'); }, base, { logger: log, sleep: async () => { throw new Error('no retry for a bug'); } });
  assert.equal(attempts, 1);
  const bugLog = log.lines.find(([level]) => level === 'error');
  await router('error', bugLog.slice(2), 's', bugLog[1]);
  assert.equal(priorityCalls.length, 2);
  // An error that is already written for the member is just shown; a missing permission is explained, not reported.
  i = fakeInteraction();
  const refused = await safeTicketAction(i, 'tk_closemodal', async () => { throw Object.assign(new Error('A reason is required.'), { userFacing: true }); }, base, { logger: log });
  assert.equal(refused.status, 'refused');
  assert.match(said(i), /A reason is required/);
  log = fakeLog();
  i = fakeInteraction();
  await safeTicketAction(i, 'tk_claim', async () => { throw api(50013, 'Missing Permissions', { status: 403 }); }, base, { logger: log });
  assert.ok(!log.lines.some(([level]) => level === 'error'), 'a permission of the server is not an error');
  assert.ok(said(i).length > 10);
  // The state is restored when it fails.
  let restored = 0;
  await safeTicketAction(fakeInteraction(), 'tk_delete', async () => { throw new Error('boom'); }, { ...base, onFail: async () => { restored += 1; } }, { logger: fakeLog() });
  assert.equal(restored, 1);
  // The interaction is dead and it fails: the member is told in the channel.
  const deadNotes = [];
  await safeTicketAction(fakeInteraction({ deferReply: async () => { throw api(10062, 'Unknown interaction'); } }), 'tk_delete', async () => { throw new Error('boom'); }, base, { logger: fakeLog(), notify: async (text) => { deadNotes.push(text); } });
  assert.ok(deadNotes.some((text) => /did not work/.test(text)), 'a message in the channel when the interaction is gone');
}

/** The actions behind the buttons: delete is never half done, a gone channel is a deleted one, healing the database. */
async function checkTicketActions() {
  const db = require('../src/db/tickets');
  const actions = require('../src/utils/ticketActions');
  const gone = require('../src/utils/ticketChannelGone');
  const trail = [];
  let row;
  Object.assign(db, {
    getTicketById: async () => row,
    closeOpenTicket: async (id, patch) => { trail.push('close'); row = { ...row, status: 'closed', ...patch }; return row; },
    setTicketChannel: async (id, channel) => { trail.push(`channel=${channel}`); row = { ...row, channel_id: channel }; return row; },
    saveTranscriptHtml: async () => { trail.push('transcript-saved'); },
    getCategoryById: async () => null,
  });
  const settingsDb = require('../src/db/ticketSettings');
  settingsDb.getSettings = async () => ({});
  const i18n = require('../src/i18n');
  const guild = { id: '10', client: { users: { fetch: async () => ({ id: '5', username: 'liam' }) } }, members: { me: null, cache: new Map() }, channels: { cache: new Map(), fetch: async () => { throw api(10003, 'Unknown Channel'); } } };
  const client = guild.client;
  const actor = { id: '6', username: 'mod' };
  const makeChannel = (error = null) => ({ id: '300', client, delete: async () => { trail.push('delete'); if (error) throw error; } });
  const ticket = () => ({ id: 3, guild_id: '10', ticket_number: 3, channel_id: '300', opener_id: '5', status: 'open', category_id: null });
  assert.ok(i18n.guildLanguage);

  // The transcript fails: nothing is deleted, nothing is closed, and the member is told why.
  row = ticket();
  transcriptFails = new Error('transcript exploded');
  trail.length = 0;
  await assert.rejects(() => actions.deleteTicketChannel({ guild, client, channel: makeChannel(), ticket: row, actor }), (error) => error.friendlyKey === 'tickets.safe.transcriptFailed');
  assert.deepEqual(trail, [], 'never half deleted: the channel, the row and the channel number are untouched');
  assert.equal(row.status, 'open');
  transcriptFails = null;

  // It works: the transcript first, then the row, then the channel, then the channel is forgotten.
  trail.length = 0;
  await actions.deleteTicketChannel({ guild, client, channel: makeChannel(), ticket: row, actor });
  assert.deepEqual(trail, ['transcript-saved', 'close', 'delete', 'channel=null']);
  // A second press, or a second run, finds it done: no second transcript, the channel is already gone, nothing breaks.
  trail.length = 0;
  await actions.deleteTicketChannel({ guild, client, channel: makeChannel(api(10003, 'Unknown Channel')), ticket: { ...row, channel_id: '300' }, actor });
  assert.deepEqual(trail, ['delete', 'channel=null'], 'a closed ticket has no new transcript, and a channel that was already deleted is a deleted one');
  // The channel disappears while the transcript is made: the caller finishes the bookkeeping.
  row = ticket();
  transcriptFails = api(10003, 'Unknown Channel');
  await assert.rejects(() => actions.deleteTicketChannel({ guild, client, channel: makeChannel(), ticket: row, actor }), (error) => error.code === 10003);
  transcriptFails = null;

  // Healing: an open ticket whose channel is gone is closed and forgets the channel; a channel that is still there is not touched.
  const closed = [];
  const cleared = [];
  const deps = {
    db: { getTicketById: async () => row, closeOpenTicket: async (id, patch) => { closed.push({ id, ...patch }); return { ...row, status: 'closed' }; }, setTicketChannel: async (id, channel) => { cleared.push([id, channel]); } },
    settingsDb: { getSettings: async () => ({}) },
    t: (lang, key) => key,
    guildLanguage: async () => 'en',
    sendLog: async () => {},
    fetchEntry: async () => null,
    textCard: (text) => ({ text }),
    EMOJI: { DENY: 'x' },
  };
  row = ticket();
  assert.equal(await gone.healGoneTicket({ guild, client, ticket: row, actorId: '6' }, deps), true);
  assert.equal(closed.length, 1, 'the open ticket is closed');
  assert.equal(closed[0].clearChannel, true, 'and the channel is released');
  row = { ...ticket(), status: 'closed' };
  await gone.healGoneTicket({ guild, client, ticket: row }, deps);
  assert.deepEqual(cleared, [[3, null]], 'a closed ticket only forgets its channel');
  const stillThere = { ...guild, channels: { cache: new Map([['300', {}]]), fetch: async () => ({}) } };
  assert.equal(await gone.healGoneTicket({ guild: stillThere, client, ticket: ticket() }, deps), false, 'a channel that exists is not healed');

  // The panels that point to a deleted channel forget their message; the sweep is a small batch and only for 10003.
  const forgotten = [];
  const panelDeps = { db: { listPanelsWithMessage: async (limit) => { assert.ok(limit <= 500); return [{ id: 1, guild_id: '10', channel_id: 'dead', message_id: 'm' }, { id: 2, guild_id: '10', channel_id: 'alive', message_id: 'm' }, { id: 3, guild_id: '20', channel_id: 'dead', message_id: 'm' }]; }, setPanelMessageId: async (id, value) => { forgotten.push([id, value]); } } };
  const sweepClient = { guilds: { cache: new Map([['10', { id: '10', available: true, channels: { cache: new Map([['alive', {}]]), fetch: async () => { throw api(10003, 'Unknown Channel'); } } }]]) } };
  assert.equal(await gone.reconcileTicketPanels(sweepClient, panelDeps), 1);
  assert.deepEqual(forgotten, [[1, null]], 'only the panel whose channel is gone, in a server Petto can see');
  const many = Array.from({ length: 250 }, (_, n) => ({ id: n + 1, guild_id: '10', ticket_number: n + 1, channel_id: `dead${n}`, status: 'open', created_at: '2026-01-01T00:00:00Z' }));
  const batchDeps = { ...deps, db: { listAllOpenTickets: async () => many, closeOpenTicket: async (id) => ({ id }) } };
  const deadGuild = { id: '10', available: true, channels: { cache: new Map(), fetch: async () => { throw api(10003, 'Unknown Channel'); } } };
  assert.equal(await gone.reconcileTicketChannels({ guilds: { cache: new Map([['10', deadGuild]]) } }, batchDeps), 100, 'one sweep heals a conservative batch and the next continues');
}

(async () => {
  checkClassification();
  checkRedaction();
  checkCard();
  checkPolicy();
  await checkSinkAndRouter();
  checkConfig();
  await checkTicketNet();
  await checkTicketActions();
  console.log('Checked the error triage: the table, fingerprints, secrets and mentions, pings, repeats, the two channels and the ticket safety net.');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
