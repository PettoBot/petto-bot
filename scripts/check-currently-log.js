// Checks the Currently log: the entries are checked before they are posted, each kind has its color, the cards hold five entries and fit in a message,
// and what was posted is never posted again (and what Discord refused comes again).
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const log = require('../src/utils/currentlyLog');

const entry = (id, category = 'feature', extra = {}) => ({ id, category, title: `Title ${id}`, area: 'Partners › Variables', summary: 'It does this and it changes that.', ...extra });

// The colors asked for, all of them bright and soft like the green of the dashboard: red security, green added to a feature, yellow a new feature,
// dark (the dark of Petto) a feature removed, light gray something removed, orange a fix.
assert.deepEqual(Object.keys(log.CATEGORIES).sort(), ['addition', 'feature', 'fix', 'improvement', 'removal', 'removed-feature', 'security', 'web']);
const hue = (key) => log.CATEGORIES[key].color;
const channels = (key) => [hue(key) >> 16, (hue(key) >> 8) & 0xff, hue(key) & 0xff];
assert.equal(hue('addition'), 0xa5ea7a, 'added to a feature is the green of the dashboard');
assert.equal(hue('security'), 0xfe6465, 'security is the red of Petto');
assert.equal(hue('feature'), 0xfed53c, 'a new feature is the yellow of Petto');
{
  const [r, g, b] = channels('fix');
  assert.ok(r > 0xe0 && g > 0x80 && g < 0xc0 && b < 0x90, 'a fix is orange');
  const [gr, gg, gb] = channels('removal');
  assert.ok(Math.max(gr, gg, gb) - Math.min(gr, gg, gb) < 0x18 && gr > 0xa0, 'something removed is a light gray');
  for (const key of ['security', 'feature', 'addition', 'improvement', 'fix', 'web', 'removal']) assert.ok(Math.max(...channels(key)) >= 0xa0, `${key} is a bright color, not a dark one`);
}
assert.equal(hue('removed-feature'), 0x4b4f59, 'a feature removed is the dark of Petto');
assert.equal(new Set(Object.values(log.CATEGORIES).map((each) => each.color)).size, 8, 'no two kinds share a color');
for (const each of Object.values(log.CATEGORIES)) assert.match(each.dot, /^<:[a-z_]+:\d+>$/i, 'the mark of each kind is an emoji of Petto');
assert.equal(new Set(Object.values(log.CATEGORIES).map((each) => each.dot)).size, 8, 'no two kinds share an emoji');

// Entries: the good one passes, each mistake skips only its own entry and says why.
const good = entry('partner-top-lists', 'addition', { images: ['https://petto.sbs/assets/log/a.png'], docs: 'https://petto.sbs/blog/x' });
const checked = log.validateEntries([
  good,
  entry('Bad Id'), entry('good-id', 'party'), entry('dup'), entry('dup'),
  { ...entry('empty'), summary: '  ' },
  { ...entry('long-title'), title: 'x'.repeat(101) },
  { ...entry('four-images'), images: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png', 'https://a/4.png'] },
  { ...entry('http-image'), images: ['http://a/1.png'] },
  { ...entry('bad-docs'), docs: 'not a link' },
  null,
]);
assert.deepEqual(checked.entries.map((each) => each.id), ['partner-top-lists', 'dup']);
assert.equal(checked.problems.length, 9, checked.problems.join(' | '));
assert.match(checked.problems.join('\n'), /category "party"/);
assert.match(checked.problems.join('\n'), /used twice/);
assert.deepEqual(log.validateEntries('nope').entries, [], 'a file that is not a list posts nothing');
assert.ok(log.validateEntries('nope').problems.length === 1);

// The log is read from the web: its version and revision, the entries that are well made, and what is wrong with the rest.
const parsed = log.parseLog({ revision: 4, version: '0.7.12', entries: [entry('ok-one'), entry('Bad Id')] });
assert.deepEqual([parsed.revision, parsed.version, parsed.entries.map((each) => each.id), parsed.problems.length], [4, '0.7.12', ['ok-one'], 1]);
assert.deepEqual([log.parseLog({ entries: [] }).revision, log.parseLog({ entries: [] }).version], [1, ''], 'no revision is 1, and a version that is not a version is nothing');
assert.equal(log.parseLog({ version: 'next', entries: [] }).version, '');

// Cards: one kind at a time, five entries each, the most important first.
const many = [...Array.from({ length: 10 }, (_, i) => entry(`f${i}`, 'feature')), entry('s1', 'security'), entry('x1', 'fix'), entry('x2', 'fix')];
const cards = log.buildCards(many, '0.7.11');
assert.deepEqual(cards.map((card) => [card.category, card.ids.length]), [['security', 1], ['feature', 5], ['feature', 5], ['fix', 2]]);
assert.deepEqual(cards[1].ids, ['f0', 'f1', 'f2', 'f3', 'f4']);
const text = (card) => JSON.stringify(card.payload.components[0].toJSON());
assert.match(text(cards[0]), /Security fix/);
assert.match(text(cards[1]), /New features \(1-5 of 10\)/);
assert.match(text(cards[2]), /New features \(6-10 of 10\)/);
assert.match(text(cards[3]), /Fixes \(2\)/);
assert.match(text(cards[3]), /Petto 0\.7\.11/);
assert.equal(cards[0].payload.components[0].toJSON().accent_color, log.CATEGORIES.security.color, 'the card has the color of its kind');
assert.equal(cards[0].payload.flags, 1 << 15, 'Components V2');
assert.deepEqual(cards[0].payload.allowedMentions, { parse: [] }, 'a change never pings');

// Long entries make smaller cards: every card still fits in a message (Discord: 40 components, 4000 characters of text), whatever the entries are.
const heavy = Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, category: 'addition', title: 'T'.repeat(100), area: 'A'.repeat(80), summary: 'S'.repeat(700), images: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png'], docs: 'https://petto.sbs/blog/' + 'p'.repeat(80) }));
const heavyCards = log.buildCards(heavy, '0.7.11');
assert.ok(heavyCards.length > 1 && heavyCards.every((card) => card.ids.length <= 5), 'five long entries do not fit in one card');
assert.deepEqual(heavyCards.flatMap((card) => card.ids), heavy.map((each) => each.id), 'every entry is in a card, in order');
const count = (node) => 1 + (node.components ?? []).reduce((total, child) => total + count(child), 0) + (node.items ?? []).length;
const characters = (node) => (node.content?.length ?? 0) + (node.components ?? []).reduce((total, child) => total + characters(child), 0);
for (const card of [...heavyCards, ...cards]) {
  const json = card.payload.components[0].toJSON();
  assert.ok(count(json) - 1 <= 40, `${count(json) - 1} components`);
  assert.ok(characters(json) <= 4000, `${characters(json)} characters of text in a card`);
}
console.log(`longest card: ${Math.max(...heavyCards.map((card) => characters(card.payload.components[0].toJSON())))} characters`);

// The channel: the `currently_log` variable (and the same name in capitals).
assert.equal(log.channelIdFromEnv({ currently_log: '1234567890123456789' }), '1234567890123456789');
assert.equal(log.channelIdFromEnv({ CURRENTLY_LOG: ' 1234567890123456789 ' }), '1234567890123456789');
assert.equal(log.channelIdFromEnv({ currently_log: 'general' }), null);
assert.equal(log.channelIdFromEnv({}), null);

// Posting.
const CHANNEL = '1234567890123456789';
const BOT = '999999999999999999';
let nextMessage = 1;
function fake({ failOnCall = 0, channel = true, reactFails = false, existing = [] } = {}) {
  const sent = [];
  const reactions = [];
  const deleted = [];
  const target = {
    send: async (payload) => {
      if (failOnCall && sent.length + 1 === failOnCall && !target.failed) { target.failed = true; throw new Error('Missing Permissions'); }
      sent.push(payload);
      return { id: `m${nextMessage++}`, react: async (emoji) => { if (reactFails) throw new Error('Unknown Emoji'); reactions.push(emoji); } };
    },
    // `existing` are the messages already in the channel (the posts of before the log remembered its messages).
    messages: { fetch: async () => new Collection(existing.map((message) => [message.id, message])), delete: async (id) => { deleted.push(id); } },
  };
  return { sent, reactions, deleted, client: { channels: { fetch: async () => (channel ? target : null) } } };
}
function memory(start = {}) {
  const state = { revision: 1, posted: [], messages: [], ...start, writes: 0 };
  return { state, read: async () => ({ revision: state.revision, posted: [...state.posted], messages: [...state.messages] }), write: async (next) => { state.writes += 1; state.revision = next.revision; state.posted = [...next.posted]; state.messages = [...next.messages]; } };
}
const loaded = async () => true;
const base = { channelId: CHANNEL, pauseMs: 0, reachable: loaded, revision: 1 };
(async () => {
  const answer = (status, body) => async () => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new Error('not JSON'); return body; } });
  assert.equal((await log.fetchLog('https://web.example/log', answer(200, { revision: 2, version: '0.7.12', entries: [entry('w1')] }))).entries[0].id, 'w1', 'a good answer is read');
  assert.equal(await log.fetchLog('https://web.example/log', answer(500, {})), null, 'the site is down or being deployed: nothing is posted, it is tried again');
  assert.equal(await log.fetchLog('https://web.example/log', answer(200, undefined)), null, 'an answer that is not JSON');
  assert.equal(await log.fetchLog('https://web.example/log', answer(200, { hello: 1 })), null, 'JSON that is not a log');
  assert.equal(await log.fetchLog('https://web.example/log', async () => { throw new Error('ECONNREFUSED'); }), null, 'the network fails');
  assert.equal(log.LOG_URL, 'https://petto.sbs/api/currently-log');
  const entries = [entry('a', 'feature'), entry('b', 'fix'), entry('c', 'fix'), entry('d', 'security')];
  const none = fake();
  assert.deepEqual(await log.announceNewEntries(none.client, { ...base, entries, channelId: null, store: memory() }), { cards: 0, entries: 0, skipped: 'no-channel' }, 'no variable: nothing is posted');
  assert.equal(none.sent.length, 0);

  const first = fake();
  const store = memory();
  const result = await log.announceNewEntries(first.client, { ...base, entries, store, version: '0.7.11' });
  assert.deepEqual(result, { cards: 3, entries: 4 });
  assert.deepEqual([...store.state.posted].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(store.state.messages.length, 3, 'the log remembers the message of each card');
  assert.match(JSON.stringify(first.sent[0].components[0].toJSON()), /Security fix/, 'security goes first');

  // Every card gets the like and the dislike of the feedback board, in that order (3 cards, 2 reactions each).
  const { EMOJI: board } = require('../src/feedback/card');
  assert.deepEqual(first.reactions, Array.from({ length: 3 }, () => [`${board.like.name}:${board.like.id}`, `${board.dislike.name}:${board.dislike.id}`]).flat());
  assert.deepEqual(log.voteEmojis(), [`like:${board.like.id}`, `dislike:${board.dislike.id}`], 'they are the emojis of the feedback buttons');
  // A reaction that fails never stops the log.
  const noReact = fake({ reactFails: true });
  assert.deepEqual(await log.announceNewEntries(noReact.client, { ...base, entries, store: memory() }), { cards: 3, entries: 4 });

  const again = fake();
  assert.deepEqual(await log.announceNewEntries(again.client, { ...base, entries, store }), { cards: 0, entries: 0, skipped: 'nothing-new' }, 'a restart posts nothing twice');
  assert.equal(again.sent.length, 0);
  assert.equal(again.deleted.length, 0);

  // A new entry is posted alone, next to the old ones.
  const extra = fake();
  await log.announceNewEntries(extra.client, { ...base, entries: [...entries, entry('e', 'web')], store });
  assert.equal(extra.sent.length, 1);
  assert.match(JSON.stringify(extra.sent[0].components[0].toJSON()), /Web, dashboard and docs/);
  assert.equal(extra.deleted.length, 0, 'nothing old is deleted');

  // Discord refuses the second card: what was posted stays remembered, the rest comes again at the next start.
  const refusing = fake({ failOnCall: 2 });
  const retryStore = memory();
  const partial = await log.announceNewEntries(refusing.client, { ...base, entries, store: retryStore });
  assert.deepEqual(partial, { cards: 1, entries: 1 });
  assert.deepEqual(retryStore.state.posted, ['d'], 'only the card that was posted is remembered');
  const retry = await log.announceNewEntries(refusing.client, { ...base, entries, store: retryStore });
  assert.deepEqual(retry, { cards: 2, entries: 3 }, 'the refused ones are posted at the next start');

  // A higher revision of the file: the cards the log remembers are deleted, and so are the old ones of the bot that it did not remember
  // (Components V2 and the footer of the log); nothing else of the bot or of anybody is touched. Then everything is posted again.
  const card = (id, { by = BOT, v2 = true, footer = true } = {}) => ({ id, author: { id: by }, flags: { has: (flag) => v2 && flag === 1 << 15 }, components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: footer ? '-# Petto 0.7.11' : 'something else' }] }) }] });
  const old = fake({ existing: [card('old1'), card('old2'), card('human', { by: 'someone' }), card('sticky', { footer: false }), card('plain', { v2: false })] });
  const oldStore = memory({ revision: 0, posted: ['a', 'b', 'c', 'd'], messages: ['known1'] });
  const reposted = await log.announceNewEntries(old.client, { ...base, entries, store: oldStore, revision: 2, botId: BOT });
  assert.deepEqual(reposted, { cards: 3, entries: 4, removed: 3 });
  assert.deepEqual([...old.deleted].sort(), ['known1', 'old1', 'old2'], 'only the log of the bot is deleted');
  assert.equal(oldStore.state.revision, 2);
  assert.deepEqual([...oldStore.state.posted].sort(), ['a', 'b', 'c', 'd'], 'all of it was posted again');
  assert.equal(oldStore.state.messages.length, 3, 'and the new messages are remembered, not the old ones');
  const settled = fake();
  assert.equal((await log.announceNewEntries(settled.client, { ...base, entries, store: oldStore, revision: 2, botId: BOT })).skipped, 'nothing-new', 'the same revision posts nothing again');
  assert.equal(settled.deleted.length, 0);

  // A picture that cannot be loaded yet (the web is still being deployed): Discord would keep it broken, so that entry waits, and the rest goes.
  const withPicture = [entry('p', 'addition', { images: ['https://petto.sbs/assets/log/p.png'] }), entry('q', 'addition')];
  const missing = fake();
  const pictureStore = memory();
  let up = false;
  const reachable = async () => up;
  const waiting = await log.announceNewEntries(missing.client, { ...base, entries: withPicture, store: pictureStore, reachable });
  assert.deepEqual(waiting, { cards: 1, entries: 1, waiting: 1 });
  assert.deepEqual(pictureStore.state.posted, ['q'], 'the entry with the missing picture is not remembered as posted');
  up = true;
  const later = fake();
  assert.deepEqual(await log.announceNewEntries(later.client, { ...base, entries: withPicture, store: pictureStore, reachable }), { cards: 1, entries: 1 }, 'once the picture answers it is posted');
  assert.deepEqual([...pictureStore.state.posted].sort(), ['p', 'q']);

  // `startCurrentlyLog` keeps looking by itself: an entry that waits for its picture, and a change that the web gets later, are posted at a later look.
  up = false;
  const retried = fake();
  const retryingStore = memory();
  const bot = { channels: retried.client.channels, user: { id: BOT } };
  let published = [withPicture[0]];
  const looking = await log.startCurrentlyLog(bot, { channelId: CHANNEL, pauseMs: 0, store: retryingStore, reachable, pollMs: 5, load: async () => log.parseLog({ revision: 1, version: '0.7.12', entries: published }) });
  assert.equal(looking.result.waiting, 1);
  up = true;
  published = withPicture;
  await new Promise((resolve) => setTimeout(resolve, 150));
  looking.stop();
  assert.deepEqual([...retryingStore.state.posted].sort(), ['p', 'q'], 'a later look posted the picture that was missing and the new entry');

  // A channel that is not there, and a store that fails: a line in the log, no crash.
  assert.equal((await log.announceNewEntries(fake({ channel: false }).client, { ...base, entries, store: memory() })).skipped, 'channel-unavailable');
  const broken = { read: async () => { throw new Error('db down'); }, write: async () => {} };
  assert.equal((await log.announceNewEntries(fake().client, { ...base, entries, store: broken })).skipped, 'store-failed');

  // The version at the bottom of the cards is the one of the log of the web (0.7.12 from the start the maintainer marked), not the one of package.json.
  const web = (over = {}) => ({ revision: 1, version: '0.7.12', entries: [entry('v1')], ...over });
  const loadWeb = (current) => async () => log.parseLog(current());
  let current = web();
  const versioned = fake();
  const versionedStore = memory();
  await log.announceNewEntries(versioned.client, { channelId: CHANNEL, pauseMs: 0, reachable: loaded, store: versionedStore, load: loadWeb(() => current) });
  assert.match(JSON.stringify(versioned.sent[0].components[0].toJSON()), /-# Petto 0\.7\.12/, 'the footer says the version of the log');
  assert.notEqual('0.7.12', require('../package.json').version, 'it does not follow package.json');
  // The web is not there: nothing is posted and nothing is forgotten.
  const down = fake();
  assert.equal((await log.announceNewEntries(down.client, { channelId: CHANNEL, pauseMs: 0, store: memory(), load: async () => null })).skipped, 'log-unavailable');
  assert.equal(down.sent.length, 0);
  // The bot starts while the web is being deployed (it answers 404 for a minute): nothing is said in the log of the team, the bot asks again soon
  // by itself and posts as soon as the web answers, without waiting ten minutes. Only a web that never answers is said, once.
  {
    const logger = require('../src/utils/logger');
    const warnings = [];
    const warn = logger.warn;
    logger.warn = (text) => { warnings.push(String(text)); };
    try {
      let answers = 0;
      const deploying = async () => { answers += 1; return answers <= 2 ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ revision: 1, version: '0.7.12', entries: [entry('late')] }) }; };
      const early = fake();
      const earlyStore = memory();
      const looking = await log.startCurrentlyLog({ channels: early.client.channels, user: { id: BOT } }, { channelId: CHANNEL, pauseMs: 0, store: earlyStore, reachable: loaded, pollMs: 60_000, retryMs: [5, 5, 5], load: () => log.fetchLog('https://web.example/log', deploying) });
      assert.equal(looking.result.skipped, 'log-unavailable', 'the first look found the web deploying');
      await new Promise((resolve) => setTimeout(resolve, 120));
      looking.stop();
      assert.deepEqual(earlyStore.state.posted, ['late'], 'the quick retry posted it as soon as the web answered, long before the look of every ten minutes');
      assert.deepEqual(warnings, [], 'a web that is being deployed is not a warning');

      const never = fake();
      const lost = await log.startCurrentlyLog({ channels: never.client.channels, user: { id: BOT } }, { channelId: CHANNEL, pauseMs: 0, store: memory(), pollMs: 60_000, retryMs: [5, 5], load: () => log.fetchLog('https://web.example/log', async () => ({ ok: false, status: 404 })) });
      await new Promise((resolve) => setTimeout(resolve, 120));
      lost.stop();
      assert.equal(warnings.length, 1, 'a web that never answers is said once');
      assert.match(warnings[0], /answered 404/, 'and it says why');
      assert.equal(never.sent.length, 0);
    } finally {
      logger.warn = warn;
    }
  }
  // A change that only the web has: the web is deployed with a new entry and the next look posts it (and only it), with no change to the bot.
  current = web({ entries: [entry('v1'), entry('only-web', 'web')] });
  const webOnly = fake();
  assert.deepEqual(await log.announceNewEntries(webOnly.client, { channelId: CHANNEL, pauseMs: 0, reachable: loaded, store: versionedStore, load: loadWeb(() => current) }), { cards: 1, entries: 1 });
  assert.deepEqual([...versionedStore.state.posted].sort(), ['only-web', 'v1']);

  console.log('Checked the Currently log: the entries, the colors, the cards, each change once, the pictures that wait and the log posted again.');
})().catch((error) => { console.error(error); process.exit(1); });

// The picture check reads the whole file the way Discord asks, and refuses what Discord could not show (and the improvement card has no clock-like icon).
(async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const answer = (body, type = 'image/png', status = 200) => async () => new Response(body, { status, headers: { 'content-type': type } });
  assert.equal(await log.imageReachable('https://x/a.png', answer(png), 0), true, 'a real PNG is fine');
  assert.equal(await log.imageReachable('https://x/a.png', answer(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), 'image/jpeg'), 0), true, 'a JPEG is fine');
  assert.equal(await log.imageReachable('https://x/a.png', answer(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp'), 0), true, 'a WebP is fine');
  assert.equal(await log.imageReachable('https://x/a.png', answer('<html>not found</html>'), 0), false, 'a page that says it is an image is not');
  assert.equal(await log.imageReachable('https://x/a.png', answer(png, 'text/html'), 0), false, 'a page with the wrong type is not');
  assert.equal(await log.imageReachable('https://x/a.png', answer(png, 'image/png', 404), 0), false, 'a missing picture is not');
  assert.equal(await log.imageReachable('https://x/a.png', answer(new Uint8Array(0)), 0), false, 'an empty file is not');
  assert.equal(await log.imageReachable('https://x/a.png', answer(new Uint8Array(9 * 1024 * 1024).fill(1).map((v, i) => (i < 4 ? [0x89, 0x50, 0x4e, 0x47][i] : v))), 0), false, 'a picture over 8 MB is not');
  let calls = 0;
  const flaky = async () => { calls += 1; return calls === 1 ? new Response('wait', { status: 503, headers: { 'content-type': 'text/plain' } }) : new Response(png, { headers: { 'content-type': 'image/png' } }); };
  assert.equal(await log.imageReachable('https://x/a.png', flaky, 1), true, 'a second try covers a file that is just being put in place');
  assert.equal(calls, 2);
  let requested = null;
  await log.imageReachable('https://x/a.png', async (url, options) => { requested = options; return new Response(png, { headers: { 'content-type': 'image/png' } }); }, 0);
  assert.equal(requested.method, 'GET', 'the whole file is read, which also leaves it in the cache of the web');
  assert.match(requested.headers['User-Agent'], /Discordbot/, 'asked the way Discord asks');
  const clockLike = require('../src/utils/emojis').EMOJI.RELEASE_RELOAD;
  assert.notEqual(log.CATEGORIES.improvement.dot, clockLike, 'the improvement card does not use the circular arrows that look like a clock');
  console.log('Currently log picture checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });

