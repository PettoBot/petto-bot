// Checks the saved embeds used for the starboard repost, the verification DMs and the bump messages: the variables reach the
// embed, and a missing or broken template gives the usual message.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const templates = {};
const settings = {};
stub('src/config.js', { verifyBaseUrl: null });
stub('src/utils/logger.js', { info() {}, warn(a, b) { if (process.env.SHOW) console.log(b ?? a); }, error() {} });
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (name === 'boom' ? Promise.reject(new Error('db down')) : templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
stub('src/db/verificationConfig.js', { getConfig: async () => settings });
stub('src/db/starboard.js', {});
const { buildCustomPayload } = require('../src/events/starboardReaction');
const { sendVerifyDM, sendVerifiedDM } = require('../src/utils/verifyMessage');
const { templatePayload } = require('../src/utils/templatedMessage');

const guild = {
  id: '9', name: 'Test Server', memberCount: 50, ownerId: '5', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'),
  iconURL: () => null, bannerURL: () => null,
  members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() },
};
const author = { id: '111', username: 'starry', displayAvatarURL: () => 'https://cdn.test/a.png' };

(async () => {
  // Starboard.
  const image = { url: 'https://cdn.test/pic.png', name: 'pic.png', contentType: 'image/png' };
  const file = { url: 'https://cdn.test/doc.pdf', name: 'doc.pdf', contentType: 'application/pdf' };
  const message = {
    id: '55', content: 'a great message', url: 'https://discord.com/channels/9/3/55', createdTimestamp: 1_700_000_000_000,
    author, member: null, guild, channel: { id: '3', name: 'general' },
    attachments: new Collection([['1', image], ['2', file]]),
  };
  const row = { emoji: '⭐', embed_template: 'star' };
  assert.equal(await buildCustomPayload(message, { ...row, embed_template: null }, 5), null, 'no template, the usual repost');
  assert.equal(await buildCustomPayload(message, row, 5), null, 'a template that does not exist, the usual repost');
  templates.star = { content: '{star.count} {star.emoji} in {star.channel_name} by {star.author_name}', embeds: [{ description: '{star.content}\n{star.link}\n{star.attachments}', image: { url: '{star.image}' } }] };
  const payload = await buildCustomPayload(message, row, 5);
  assert.equal(payload.content, '5 ⭐ in general by starry');
  assert.deepEqual(payload.embeds[0].data.description.split('\n'), ['a great message', 'https://discord.com/channels/9/3/55', '[doc.pdf](https://cdn.test/doc.pdf)']);
  assert.equal(payload.embeds[0].data.image.url, 'https://cdn.test/pic.png');
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(await buildCustomPayload(message, { ...row, embed_template: 'boom' }, 5), null, 'a broken template, the usual repost');

  // Verification DMs.
  const sent = [];
  const member = {
    id: '111', user: author, displayName: 'starry', displayAvatarURL: () => 'https://cdn.test/a.png', joinedAt: new Date('2024-01-01'), joinedTimestamp: 1_704_067_200_000,
    premiumSince: null, displayHexColor: '#000000', roles: { cache: new Collection(), highest: { name: '@everyone', id: '9' } }, guild,
    send: async (payload) => { sent.push(payload); } };
  await sendVerifyDM(member, { guild, link: 'https://petto.test/verify/abc' });
  assert.equal(sent.pop().flags, MessageFlags.IsComponentsV2, 'no template, the usual card');
  settings.prompt_embed_template = 'verify';
  templates.verify = { embeds: [{ title: 'Welcome {user.name}', description: 'Verify here: {verify.link}' }] };
  await sendVerifyDM(member, { guild, link: 'https://petto.test/verify/abc' });
  const verifyDM = sent.pop();
  assert.equal(verifyDM.embeds[0].data.title, 'Welcome starry');
  assert.equal(verifyDM.embeds[0].data.description, 'Verify here: https://petto.test/verify/abc');
  settings.verified_embed_template = 'boom';
  await sendVerifiedDM(member, { guild });
  assert.equal(sent.pop().flags, MessageFlags.IsComponentsV2, 'a broken template, the usual card');
  settings.verified_embed_template = 'done';
  templates.done = { content: 'You are in, {user}!', embeds: [] };
  await sendVerifiedDM(member, { guild });
  assert.equal(sent.pop().content, 'You are in, <@111>!');

  // Bump messages.
  templates.bump = { content: 'Thanks {user.mention}! Next bump {nextBump}', embeds: [] };
  const thanks = await templatePayload('9', 'bump', { guild, user: author, bump: { nextUnix: 1_700_007_200 } });
  assert.equal(thanks.content, 'Thanks <@111>! Next bump <t:1700007200:R>');
  const reminder = await templatePayload('9', 'bump', { guild, user: author, bump: {} });
  assert.equal(reminder.content, 'Thanks <@111>! Next bump ');
  console.log('Checked the starboard, verification and bump messages with and without a template.');
})().catch((error) => { console.error(error); process.exit(1); });
