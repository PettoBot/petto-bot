// Checks the reaction boards: the starboard and the monkeyboard share one engine but keep their own settings and posts.
// A message with enough monkeys is reposted only by the monkeyboard, the repost follows the count and goes when the
// reactions are taken back. Storage and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
let lastContext = null;
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name, ctx) => { lastContext = ctx; return name ? { content: 'custom' } : null; } });
const { syncBoard, buildPayload } = require('../src/utils/reactionBoard');
const monkeyDefaults = require('../src/db/monkeyboard').DEFAULTS;
const starDefaults = require('../src/db/starboard').DEFAULTS;

function memoryBoard(config) {
  const entries = new Map();
  return {
    entries,
    getConfig: async () => config,
    getEntry: async (guildId, id) => entries.get(id) ?? null,
    saveEntry: async ({ sourceMessageId, starboardMessageId, count }) => { entries.set(sourceMessageId, { starboard_message_id: starboardMessageId, count }); },
    removeEntry: async (guildId, id) => { entries.delete(id); },
  };
}

function discord(emoji, voters) {
  const sent = [];
  const reposts = new Map();
  const destination = {
    isTextBased: () => true,
    send: async (payload) => { const repost = { id: `repost${sent.length + 1}`, payload, deleted: false, edit: async (next) => { repost.payload = next; }, delete: async () => { repost.deleted = true; } }; sent.push(repost); reposts.set(repost.id, repost); return repost; },
    messages: { fetch: async (id) => reposts.get(id) ?? null },
  };
  const message = {
    id: 'm1', content: 'a message', url: 'https://discord.com/x', createdAt: new Date(), attachments: new Map(), channel: { id: 'c1', name: 'general' },
    author: { id: 'author', tag: 'author#0', displayAvatarURL: () => null },
    guild: { id: 'g1', channels: { fetch: async () => destination }, members: { fetch: async () => ({ roles: { cache: [] } }) } },
  };
  const reaction = { partial: false, message, emoji: { toString: () => emoji }, users: { fetch: async () => new Map(voters().map((id) => [id, { id, bot: false }])) } };
  // A Map filters through its values, so give it the same `filter` a Collection has.
  reaction.users.fetch = async () => { const list = voters().map((id) => ({ id, bot: false })); return { filter: (test) => ({ size: list.filter(test).length }) }; };
  return { reaction, sent };
}

(async () => {
  assert.deepEqual([monkeyDefaults.emoji, starDefaults.emoji], ['🐒', '⭐'], 'each board has its own emoji');
  assert.notEqual(monkeyDefaults.color, starDefaults.color);

  let voters = ['u1', 'u2'];
  const monkey = memoryBoard({ ...monkeyDefaults, channel_id: 'dest' });
  const star = memoryBoard({ ...starDefaults, channel_id: 'dest' });
  const { reaction, sent } = discord('🐒', () => voters);

  await syncBoard(reaction, { db: monkey });
  assert.equal(sent.length, 0, 'below the threshold nothing is posted');
  voters = ['u1', 'u2', 'u3'];
  await syncBoard(reaction, { db: star });
  assert.equal(sent.length, 0, 'the starboard ignores monkeys');
  await syncBoard(reaction, { db: monkey });
  assert.equal(sent.length, 1, 'three monkeys reach the monkeyboard');
  assert.ok(sent[0].payload.content.startsWith('🐒 **3**'), 'the line above counts the monkeys');
  assert.equal(sent[0].payload.embeds[0].data.color, monkeyDefaults.color, 'and the repost has the monkey color');
  assert.equal(monkey.entries.size, 1);
  assert.equal(star.entries.size, 0, 'the starboard keeps nothing');

  voters = ['u1', 'u2', 'u3', 'u4'];
  await syncBoard(reaction, { db: monkey });
  assert.equal(sent.length, 1, 'the same message is edited, not posted again');
  assert.ok(sent[0].payload.content.startsWith('🐒 **4**'));

  // The author's own monkey does not count unless the board allows it: one voter left, so the repost goes.
  voters = ['author', 'u1'];
  await syncBoard(reaction, { db: monkey });
  assert.equal(sent[0].deleted, true, 'with the reactions taken back the repost goes');
  assert.equal(monkey.entries.size, 0);
  // A saved embed gets its own variables: {monkey.…} on the monkeyboard, {star.…} on the starboard.
  const custom = memoryBoard({ ...monkeyDefaults, channel_id: 'dest', embed_template: 'funny' });
  const second = discord('🐒', () => ['u1', 'u2', 'u3']);
  await syncBoard(second.reaction, { db: custom, variable: 'monkey' });
  assert.deepEqual([Object.keys(lastContext).includes('monkey'), Object.keys(lastContext).includes('star'), lastContext.monkey.count, lastContext.monkey.emoji], [true, false, 3, '🐒']);
  assert.equal(second.sent[0].payload.content, 'custom');
  const plain = memoryBoard({ ...starDefaults, channel_id: 'dest', embed_template: 'loved' });
  const third = discord('⭐', () => ['u1', 'u2', 'u3']);
  await syncBoard(third.reaction, { db: plain });
  assert.deepEqual([Object.keys(lastContext).includes('star'), Object.keys(lastContext).includes('monkey')], [true, false]);
  // The usual repost looks like the reference: "⭐ 4 | #channel", the author, the text, the date and an "Original Message" button.
  const original = { content: 'Fuh', member: { displayName: 'Friend (Dusto)', displayAvatarURL: () => 'https://cdn.example/a.png' }, author: { username: 'dusto' }, attachments: new Map(), createdAt: new Date('2026-09-25T22:17:00Z'), channel: { toString: () => '<#123>' }, url: 'https://discord.com/channels/1/2/3' };
  const usual = buildPayload(original, { ...starDefaults, emoji: '⭐' }, 4);
  assert.equal(usual.content, '⭐ **4** | <#123>');
  const usualEmbed = usual.embeds[0].toJSON();
  assert.deepEqual([usualEmbed.author.name, usualEmbed.description, Boolean(usualEmbed.timestamp), usualEmbed.footer], ['Friend (Dusto)', 'Fuh', true, undefined]);
  assert.deepEqual([usual.components[0].toJSON().components[0].label, usual.components[0].toJSON().components[0].url], ['Original Message', 'https://discord.com/channels/1/2/3']);
  assert.equal(buildPayload(original, { ...starDefaults, emoji: '⭐', jumpurl: false }, 4).components, undefined, 'no button when the link is off');
  console.log('Checked the monkeyboard and the starboard: one engine, separate settings and posts.');
})().catch((error) => { console.error(error); process.exit(1); });
