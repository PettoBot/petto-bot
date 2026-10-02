// Checks the Components V2 templates (made in the dashboard's V2 editor): variables are resolved, anything Discord would
// refuse is cleaned or left out, the limits hold, and only the senders that ask for V2 get it.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const templates = {};
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const { build, hasContent } = require('../src/utils/embedBuilder');
const { buildV2, isV2, hasV2Content, LIMITS } = require('../src/utils/embedV2');
const { templatePayload } = require('../src/utils/templatedMessage');
const { questMessage } = require('../src/utils/questMessages');

const guild = { id: '9', name: 'Test Server', memberCount: 50, ownerId: '5', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
const quest = { name: 'Watch the trailer', reward: '200 Orbs', image: 'https://cdn.discordapp.com/quests/1/a.jpg', reward_image: '', url: 'https://discord.com/quests/1', link: '', limits: 'None' };
const ctx = { guild, quest };

const design = {
  v2: {
    components: [{
      type: 17, accent_color: 0xff91c2, components: [
        { type: 10, content: '# [{quest.name}]({quest.url})' },
        { type: 12, items: [{ media: { url: '{quest.image}' } }] },
        { type: 14, divider: true, spacing: 1 },
        { type: 9, components: [{ type: 10, content: '## Rewards\n{quest.reward}' }], accessory: { type: 11, media: { url: '{quest.reward_image}' } } },
        { type: 10, content: '{quest.link}' },
        { type: 1, components: [{ type: 2, style: 5, label: 'Accept {quest.name}', url: '{quest.url}' }, { type: 2, style: 5, label: 'Game page', url: '{quest.link}' }, { type: 2, style: 1, label: 'Not a link', custom_id: 'x' }] },
      ],
    }],
  },
};

(async () => {
  assert.equal(isV2(design), true); assert.equal(isV2({ content: 'x', embeds: [] }), false); assert.equal(isV2(null), false);
  assert.equal(hasV2Content(design), true); assert.equal(hasV2Content({ v2: { components: [] } }), false); assert.equal(hasContent(design), true);

  const built = await buildV2(design.v2, ctx);
  assert.equal(built.flags, MessageFlags.IsComponentsV2);
  const container = built.components[0];
  assert.equal(container.accent_color, 0xff91c2);
  assert.deepEqual(container.components.map((c) => c.type), [10, 12, 14, 10, 1], 'the empty text, the empty section picture and the empty button are left out; the section became plain text');
  assert.equal(container.components[0].content, '# [Watch the trailer](https://discord.com/quests/1)');
  assert.equal(container.components[1].items[0].media.url, quest.image);
  assert.equal(container.components[3].content, '## Rewards\n200 Orbs', 'a section without its picture is plain text');
  assert.deepEqual(container.components[4].components, [{ type: 2, style: 5, label: 'Accept Watch the trailer', url: 'https://discord.com/quests/1' }], 'only link buttons with a label and a link stay');

  // A section keeps its thumbnail when it has one.
  const withPicture = await buildV2(design.v2, { ...ctx, quest: { ...quest, reward_image: 'https://cdn.discordapp.com/x.png' } });
  const sectionNode = withPicture.components[0].components.find((c) => c.type === 9);
  assert.equal(sectionNode.accessory.media.url, 'https://cdn.discordapp.com/x.png');

  // Anything that is not an https link, and unknown types, are dropped.
  const unsafe = await buildV2({ components: [{ type: 17, components: [{ type: 12, items: [{ media: { url: 'javascript:alert(1)' } }] }, { type: 3, custom_id: 'menu', options: [] }, { type: 10, content: 'kept' }] }] }, ctx);
  assert.deepEqual(unsafe.components[0].components, [{ type: 10, content: 'kept' }]);
  assert.deepEqual((await buildV2({ components: [{ type: 17, components: [{ type: 14 }] }] }, ctx)).components.length, 1, 'a container with only a divider still has a component');
  assert.equal((await buildV2({ components: [{ type: 17, components: [{ type: 10, content: '   ' }] }] }, ctx)).components.length, 0, 'a container with nothing in it is left out');

  // The limits.
  const many = { components: [{ type: 17, components: Array.from({ length: 60 }, (_, n) => ({ type: 10, content: `line ${n}` })) }] };
  const limited = await buildV2(many, ctx);
  const count = (nodes) => nodes.reduce((total, node) => total + 1 + count(node.components ?? []) + (node.accessory ? 1 : 0), 0);
  assert.ok(count(limited.components) <= LIMITS.components, 'at most 40 components');
  const longText = await buildV2({ components: [{ type: 10, content: 'a'.repeat(3000) }, { type: 10, content: 'b'.repeat(3000) }] }, ctx);
  assert.equal(longText.components.map((c) => c.content.length).reduce((a, b) => a + b, 0), LIMITS.text, 'at most 4000 characters of text in all');
  const label = await buildV2({ components: [{ type: 1, components: [{ type: 2, style: 5, label: 'x'.repeat(200), url: 'https://example.com' }] }] }, ctx);
  assert.equal(label.components[0].components[0].label.length, LIMITS.buttonLabel);

  // build(): only the senders that ask for V2 get it.
  const refused = await build(design, ctx);
  assert.deepEqual([refused.components.length, refused.embeds.length, refused.flags], [0, 0, undefined], 'a sender that does not know V2 gets an empty message and uses its own');
  const allowed = await build(design, { ...ctx, allowV2: true });
  assert.equal(allowed.flags, MessageFlags.IsComponentsV2); assert.equal(allowed.components.length, 1);

  // templatePayload carries the flag, and the quest alert adds the ping and the credit inside.
  templates.v2 = design; templates.classic = { content: 'hi {quest.name}', embeds: [] };
  const payload = await templatePayload('9', 'v2', ctx);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2); assert.equal(payload.content, undefined);
  assert.equal((await templatePayload('9', 'classic', ctx)).flags, undefined, 'a classic message has no flag');
  const alert = await questMessage(guild, { style: 'template', embed_template: 'v2', role_id: '777' }, { id: '1', name: 'Q', game: 'G', publisher: 'P', startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86_400_000), url: 'https://discord.com/quests/1', link: 'https://example.com', color: '#5865f2', image: 'https://cdn.discordapp.com/quests/1/a.jpg', logo: null, rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200, premiumAmount: 240 }], tasks: [{ label: 'Watch a video', kind: 'video', platform: 'Desktop', seconds: 120 }], platforms: ['Desktop'], global: true, regions: { include: [], exclude: [] }, ageGate: false }, 'new');
  assert.equal(alert.flags, MessageFlags.IsComponentsV2);
  assert.equal(alert.components[0].content, '-# <@&777>', 'the role ping comes first, as small text');
  assert.ok(alert.components.at(-1).content.includes('Data from'), 'the credit comes last');
  assert.deepEqual(alert.allowedMentions, { parse: [], roles: ['777'] });
  console.log('Checked the Components V2 templates: variables, cleaning, limits, and who gets them.');
})().catch((error) => { console.error(error); process.exit(1); });
