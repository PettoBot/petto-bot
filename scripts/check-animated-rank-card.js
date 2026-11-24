// The rank card of a person with an own picture: with the Gold plan an approved GIF moves (the card goes out as an APNG), with another plan it is still, and the card a person designed shows in a
// server that has a card of its own. No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');
const stub = (relative, exports) => { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
let plan = { plan: 'gold', active: true };
let approved = null;
stub('src/db/imageCards.js', { getCard: async (_g, name) => (name === 'server' ? { data: { kind: 'rank', mode: 'basic', basic: { preset: 'rank', accent: '#123456' }, background: { color: '#000000' } } } : null) });
stub('src/db/cardAssets.js', { getAsset: async () => null });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });
stub('src/db/shop.js', { getActive: async () => ({ banner: null, font: null }), getUserItems: async () => [] });
stub('src/utils/badgeRegistry.js', { ensure: async () => {}, bannerImage: async () => null });
stub('src/db/userRankCard.js', { getRankCard: async () => ({ settings: { background: 'upload:own' }, gradientPaid: false }) });
stub('src/db/userPlans.js', { getPlan: async () => plan });
stub('src/db/userUploads.js', { approvedBytes: async () => approved, isBlocked: async () => false, policyVersionOf: async () => 9 });
const { createCanvas } = require('@napi-rs/canvas');
const { renderRankCard } = require('../src/utils/cardService');
const animated = require('../src/utils/animatedPicture');
const { readChunks, decodeApng } = require('../src/imgutils/apng');
const types = (buffer) => readChunks(buffer).map((chunk) => chunk.type);

// A GIF made by hand (flat colours, "clear" codes only).
const gif = (w, h, colours) => {
  const parts = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0])];
  const table = Buffer.alloc(768); colours.forEach((c, i) => { table[i * 3] = c[0]; table[i * 3 + 1] = c[1]; table[i * 3 + 2] = c[2]; });
  parts.push(table);
  colours.forEach((_, i) => {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]), Buffer.from([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8]));
    const codes = []; const total = w * h;
    for (let at = 0; at < total; at += 250) { codes.push(256); for (let k = 0; k < Math.min(250, total - at); k += 1) codes.push(i); }
    codes.push(257);
    let bits = 0, count = 0; const bytes = [];
    for (const code of codes) { bits |= code << count; count += 9; while (count >= 8) { bytes.push(bits & 255); bits >>= 8; count -= 8; } }
    if (count) bytes.push(bits & 255);
    for (let at = 0; at < bytes.length; at += 255) { const chunk = bytes.slice(at, at + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
    parts.push(Buffer.from([0]));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
};

(async () => {
  const kept = await animated.normalizeAnimated(gif(800, 200, [[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
  assert.ok(kept.ok); approved = kept.bytes;
  const user = { id: '1', username: 'liam', displayName: 'liam', displayAvatarURL: () => null, createdAt: new Date() };
  const guild = { id: '9', name: 'Petto', memberCount: 5, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() } };
  const member = { id: '1', user, displayName: 'liam', displayAvatarURL: () => null, joinedTimestamp: 1, roles: { cache: new Collection(), highest: { name: 'Member' } }, premiumSince: null };
  const ctx = { guild, member, user, levelData: { level: 12, xp: 23450, xpNeeded: 2350, xpCurrent: 1420, xpToNext: 930, progress: 60, rank: 3, total: 120, source: 'text' } };

  // Gold: it moves, even in a server that has its own card.
  const moving = await renderRankCard(ctx, 'server', 'messages');
  assert.ok(types(moving.buffer).includes('acTL'), 'a Gold plan: the card is an APNG');
  const frames = await decodeApng(moving.buffer, { maxSide: 1100 });
  assert.equal(frames.length, 3, 'with the three frames of the GIF');
  assert.notDeepEqual(frames[0].canvas.toBuffer('image/png'), frames[1].canvas.toBuffer('image/png'), 'and the frames are not the same picture');
  // Silver: the first picture, as a plain PNG.
  plan = { plan: 'silver', active: true };
  const still = await renderRankCard(ctx, 'server', 'messages');
  assert.ok(!types(still.buffer).includes('acTL'), 'a Silver plan: a plain PNG'); assert.ok(still.buffer.length > 20_000);
  // The plan ended: still too.
  plan = { plan: 'gold', active: false };
  assert.ok(!types((await renderRankCard(ctx, null, 'messages')).buffer).includes('acTL'), 'a plan that ended: a plain PNG');
  // A picture that does not move is never turned into an animation.
  plan = { plan: 'gold', active: true }; approved = createCanvas(1024, 320).toBuffer('image/webp', 90);
  assert.ok(!types((await renderRankCard(ctx, null, 'messages')).buffer).includes('acTL'), 'a still picture stays still');
  console.log('Checked the animated rank card: Gold moves, the others are still, and the card of the person shows in every server.');
})().catch((error) => { console.error(error); process.exit(1); });
