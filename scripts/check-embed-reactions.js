// Checks the reactions of saved embeds: the `reactions` list the dashboard editor writes and the {reactreply:emoji} tags
// give the same result, and a message built from a saved embed carries them to be put on it once sent.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const saved = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => saved.get(`${guildId}:${name}`) ?? null });

const { Collection } = require('discord.js');
const flags = require('../src/utils/messageFlags');
const { templatePayload } = require('../src/utils/templatedMessage');

const user = { id: 'u', username: 'Mia', bot: false, tag: 'Mia', globalName: 'Mia', displayName: 'Mia', createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => '<@u>' };
const member = { id: 'u', user, displayName: 'Mia', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1, roles: { cache: new Collection() } };
const guild = { id: 'g', name: 'Mine', ownerId: 'o', memberCount: 10, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() } };
const ctx = { guild, member, user };

(async () => {
  // Collecting.
  const found = [];
  const clean = flags.extractReactRepliesFromTemplate({ content: 'Hi {reactreply:🌸}', embeds: [{ title: 'T {reactreply:🎀}', description: 'D' }], reactions: ['✅', ' 💛 ', '', 5] }, found);
  assert.deepEqual(found.sort(), ['✅', '🌸', '🎀', '💛'].sort(), 'the list and the tags are both collected, blanks and non-text dropped');
  assert.equal(clean.content, 'Hi'); assert.equal(clean.embeds[0].title, 'T'); assert.ok(!('reactions' in clean), 'the field is not left in the data');
  assert.deepEqual(flags.uniqueReactions(['🌸', '🌸', ' 🎀 ', '', 'a', 'b', 'c', 'd']), ['🌸', '🎀', 'a', 'b', 'c'], 'no repeats and at most five');
  assert.deepEqual(flags.extractReactReplies('hello {reactreply:🌸}{reactreply:🎀}'), { text: 'hello', emojis: ['🌸', '🎀'] });

  // A message built from a saved embed.
  saved.set('g:one', { data: { content: 'Vote below', embeds: [{ title: 'Poll' }], reactions: ['👍', '👎'] } });
  let payload = await templatePayload('g', 'one', ctx);
  assert.deepEqual(payload.reactions, ['👍', '👎']); assert.equal(payload.content, 'Vote below'); assert.equal(payload.embeds.length, 1);
  saved.set('g:two', { data: { content: 'Hi {reactreply:🌸}', embeds: [{ title: 'Poll' }], reactions: ['🌸', '🎀'] } });
  payload = await templatePayload('g', 'two', ctx);
  assert.deepEqual(payload.reactions, ['🌸', '🎀'], 'a tag and the list with the same emoji react once'); assert.equal(payload.content, 'Hi');
  saved.set('g:none', { data: { content: 'Plain', embeds: [] } });
  payload = await templatePayload('g', 'none', ctx); assert.deepEqual(payload.reactions, []);
  saved.set('g:v2', { data: { v2: { type: 'container', children: [{ type: 'text', content: 'V2 {reactreply:🔥}' }] }, reactions: ['⭐'] } });
  payload = await templatePayload('g', 'v2', ctx);
  assert.deepEqual(payload?.reactions ?? [], payload ? ['⭐', '🔥'] : [], 'a V2 design carries them too');
  assert.equal(await templatePayload('g', 'missing', ctx), null);

  // They are put on the sent message, and a bad emoji does not stop the others.
  const added = [];
  await flags.applyReactReplies({ react: async (emoji) => { if (emoji === 'bad') throw new Error('Unknown Emoji'); added.push(emoji); } }, ['🌸', 'bad', '🎀']);
  assert.deepEqual(added, ['🌸', '🎀']);
  console.log('Checked the reactions of saved embeds: the list, the tags, V2 designs and the messages that send them.');
})().catch((error) => { console.error(error); process.exit(1); });
