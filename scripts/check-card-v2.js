// Checks that an image card can go in a Components V2 design: at the top of its first container, or above everything.
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
let drawn = 0;
stub('src/utils/cardService.js', {
  renderCardForMessage: async () => { drawn += 1; return { buffer: Buffer.from('png'), name: 'card.png' }; },
  normalizeCardRef: (ref) => (ref && ref.name ? { name: ref.name, placement: ref.placement === 'attachment' ? 'attachment' : 'default' } : null),
  CARD_FILE_NAME: 'card.png',
});
const { build } = require('../src/utils/embedBuilder');

const guild = { id: '9', name: 'Test Server', memberCount: 50, ownerId: '5', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
const design = (card) => ({ v2: { components: [{ type: 17, components: [{ type: 10, content: 'Hello' }] }] }, ...(card ? { card } : {}) });

(async () => {
  const none = await build(design(null), { guild, allowV2: true });
  assert.equal(none.files.length, 0);
  assert.equal(none.components[0].components.length, 1, 'no card: the container is as it was');

  const inside = await build(design({ name: 'welcome' }), { guild, allowV2: true });
  assert.equal(inside.files.length, 1);
  assert.equal(inside.files[0].name, 'card.png');
  assert.deepEqual(inside.components[0].components[0], { type: 12, items: [{ media: { url: 'attachment://card.png' } }] }, 'the card is the first thing in the first container');
  assert.equal(inside.components[0].components[1].content, 'Hello');

  const above = await build(design({ name: 'welcome', placement: 'attachment' }), { guild, allowV2: true });
  assert.equal(above.components[0].type, 12, 'on its own above the container');
  assert.equal(above.components[1].type, 17);

  const plain = await build(design({ name: 'welcome' }), { guild });
  assert.deepEqual([plain.components.length, plain.files.length], [0, 0], 'a sender that does not take V2 still gets an empty message');
  console.log('Checked the image card inside a V2 design: inside the container, above it, and not where V2 is not asked for.');
})().catch((e) => { console.error(e); process.exit(1); });
