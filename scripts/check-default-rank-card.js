// Checks the rank card a server has not designed: it keeps the layout with the bar under the level, uses the pictures that come
// with Petto as its background (messages and voice), and is drawn as a real picture. The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/imageCards.js', { getCard: async () => null });
stub('src/db/cardAssets.js', { getAsset: async () => null });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });
const { defaultRankCard, renderRankCard } = require('../src/utils/cardService');
const { normalizeCard, source } = require('../src/utils/cardSchema');

(async () => {
  assert.equal(source('petto:rank-default'), 'petto:rank-default', 'a picture that comes with Petto is a valid source');
  assert.equal(source('petto:../secret'), '', 'but not a path');
  for (const kind of ['messages', 'voice']) {
    const card = defaultRankCard(kind);
    assert.equal(card.basic.preset, 'rank', 'the layout with the avatar on the left');
    assert.equal(card.background.gradient, undefined, 'no gradient: a picture');
    const name = card.background.image.src.replace('petto:', '');
    assert.ok(fs.existsSync(path.join(__dirname, '../src/assets/backgrounds', `${name}.webp`)), `${name}.webp exists`);
    const { card: normal } = normalizeCard(card, { premium: false });
    assert.equal(normal.background.image.src, card.background.image.src, 'the schema keeps it');
  }
  assert.notEqual(defaultRankCard('messages').basic.accent, defaultRankCard('voice').basic.accent, 'voice has its own color');

  const user = { id: '1', username: 'liam', displayName: 'liam', displayAvatarURL: () => null, createdAt: new Date() };
  const guild = { id: '9', name: 'Petto', memberCount: 5, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const member = { id: '1', user, displayName: 'liam', displayAvatarURL: () => null, joinedTimestamp: 1, roles: { cache: new Collection(), highest: { name: 'Member' } }, premiumSince: null };
  for (const kind of ['messages', 'voice']) {
    const ctx = { guild, member, user, levelData: { level: 12, xp: 23450, xpNeeded: 2350, xpCurrent: 1420, xpToNext: 930, progress: 60, rank: 3, total: 120, source: kind === 'voice' ? 'voice' : 'text' } };
    const file = await renderRankCard(ctx, null, kind);
    assert.ok(file && file.buffer.length > 20_000, `the ${kind} card is drawn`);
    assert.deepEqual([...file.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'as a PNG');
  }
  console.log('Checked the default rank card: the layout, the pictures that come with Petto and the drawing.');
})().catch((error) => { console.error(error); process.exit(1); });
