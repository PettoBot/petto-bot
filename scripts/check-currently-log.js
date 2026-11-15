// Checks the Currently log: the entries are checked before they are posted, each kind has its color, the cards hold five entries and fit in a message,
// and what was posted is never posted again (and what Discord refused comes again).
const assert = require('node:assert/strict');
const log = require('../src/utils/currentlyLog');

const entry = (id, category = 'feature', extra = {}) => ({ id, category, title: `Title ${id}`, area: 'Partners › Variables', summary: 'It does this and it changes that.', ...extra });

// The colors asked for: red security, green added to a feature, yellow a new feature, black a feature removed, gray something removed, orange a fix.
assert.deepEqual(Object.keys(log.CATEGORIES).sort(), ['addition', 'feature', 'fix', 'improvement', 'removal', 'removed-feature', 'security', 'web']);
const hue = (key) => log.CATEGORIES[key].color;
assert.ok(hue('security') >> 16 > 0xc0 && (hue('security') & 0xffff) < 0x4000, 'security is red');
assert.ok(((hue('addition') >> 8) & 0xff) > (hue('addition') >> 16) && ((hue('addition') >> 8) & 0xff) > (hue('addition') & 0xff), 'added to a feature is green');
assert.ok((hue('feature') >> 16) > 0xe0 && ((hue('feature') >> 8) & 0xff) > 0xb0 && (hue('feature') & 0xff) < 0x40, 'a new feature is yellow');
assert.equal(hue('removed-feature'), 0x000000, 'a feature removed is black');
assert.ok(Math.abs((hue('removal') >> 16) - ((hue('removal') >> 8) & 0xff)) < 0x18 && Math.abs(((hue('removal') >> 8) & 0xff) - (hue('removal') & 0xff)) < 0x18, 'something removed is gray (the three channels are close)');
assert.ok((hue('fix') >> 16) > 0xe0 && ((hue('fix') >> 8) & 0xff) > 0x40 && ((hue('fix') >> 8) & 0xff) < 0x90 && (hue('fix') & 0xff) < 0x20, 'a fix is orange');
assert.equal(new Set(Object.values(log.CATEGORIES).map((each) => each.color)).size, 8, 'no two kinds share a color');

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

// The real file of changes is well made.
const real = log.loadEntries();
assert.deepEqual(real.problems, [], 'src/data/currentlyLog.json has a problem');

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
function fake({ failOnCall = 0, channel = true, reactFails = false } = {}) {
  const sent = [];
  const reactions = [];
  const target = { send: async (payload) => { if (failOnCall && sent.length + 1 === failOnCall && !target.failed) { target.failed = true; throw new Error('Missing Permissions'); } sent.push(payload); return { react: async (emoji) => { if (reactFails) throw new Error('Unknown Emoji'); reactions.push(emoji); } }; } };
  return { sent, reactions, client: { channels: { fetch: async () => (channel ? target : null) } } };
}
function memory(start = []) {
  const state = { ids: [...start], writes: 0 };
  return { state, read: async () => [...state.ids], write: async (ids) => { state.writes += 1; state.ids = [...ids]; } };
}
(async () => {
  const entries = [entry('a', 'feature'), entry('b', 'fix'), entry('c', 'fix'), entry('d', 'security')];
  const none = fake();
  assert.deepEqual(await log.announceNewEntries(none.client, { entries, channelId: null, store: memory(), pauseMs: 0 }), { cards: 0, entries: 0, skipped: 'no-channel' }, 'no variable: nothing is posted');
  assert.equal(none.sent.length, 0);

  const first = fake();
  const store = memory();
  const result = await log.announceNewEntries(first.client, { entries, channelId: '1234567890123456789', store, pauseMs: 0, version: '0.7.11' });
  assert.deepEqual(result, { cards: 3, entries: 4 });
  assert.deepEqual([...store.state.ids].sort(), ['a', 'b', 'c', 'd']);
  assert.match(JSON.stringify(first.sent[0].components[0].toJSON()), /Security fix/, 'security goes first');

  // Every card gets the like and the dislike of the feedback board, in that order (3 cards, 2 reactions each).
  const { EMOJI: board } = require('../src/feedback/card');
  assert.deepEqual(first.reactions, Array.from({ length: 3 }, () => [`${board.like.name}:${board.like.id}`, `${board.dislike.name}:${board.dislike.id}`]).flat());
  assert.deepEqual(log.voteEmojis(), [`like:${board.like.id}`, `dislike:${board.dislike.id}`], 'they are the emojis of the feedback buttons');
  // A reaction that fails never stops the log.
  const noReact = fake({ reactFails: true });
  assert.deepEqual(await log.announceNewEntries(noReact.client, { entries, channelId: '1234567890123456789', store: memory(), pauseMs: 0 }), { cards: 3, entries: 4 });

  const again = fake();
  assert.deepEqual(await log.announceNewEntries(again.client, { entries, channelId: '1234567890123456789', store, pauseMs: 0 }), { cards: 0, entries: 0, skipped: 'nothing-new' }, 'a restart posts nothing twice');
  assert.equal(again.sent.length, 0);

  // A new entry is posted alone, next to the old ones.
  const extra = fake();
  await log.announceNewEntries(extra.client, { entries: [...entries, entry('e', 'web')], channelId: '1234567890123456789', store, pauseMs: 0 });
  assert.equal(extra.sent.length, 1);
  assert.match(JSON.stringify(extra.sent[0].components[0].toJSON()), /Web, dashboard and docs/);

  // Discord refuses the second card: what was posted stays remembered, the rest comes again at the next start.
  const refusing = fake({ failOnCall: 2 });
  const retryStore = memory();
  const partial = await log.announceNewEntries(refusing.client, { entries, channelId: '1234567890123456789', store: retryStore, pauseMs: 0 });
  assert.deepEqual(partial, { cards: 1, entries: 1 });
  assert.deepEqual(retryStore.state.ids, ['d'], 'only the card that was posted is remembered');
  const retry = await log.announceNewEntries(refusing.client, { entries, channelId: '1234567890123456789', store: retryStore, pauseMs: 0 });
  assert.deepEqual(retry, { cards: 2, entries: 3 }, 'the refused ones are posted at the next start');

  // A channel that is not there, and a store that fails: a line in the log, no crash.
  assert.equal((await log.announceNewEntries(fake({ channel: false }).client, { entries, channelId: '1234567890123456789', store: memory(), pauseMs: 0 })).skipped, 'channel-unavailable');
  const broken = { read: async () => { throw new Error('db down'); }, write: async () => {} };
  assert.equal((await log.announceNewEntries(fake().client, { entries, channelId: '1234567890123456789', store: broken, pauseMs: 0 })).skipped, 'store-failed');

  console.log('Checked the Currently log: the entries, the colors, the cards, and posting each change once.');
})().catch((error) => { console.error(error); process.exit(1); });
