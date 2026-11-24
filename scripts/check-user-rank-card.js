// The rank card a person designs for themselves: what is free and what costs (the two-color bar, once), settings that are not valid becoming the defaults, the card of the
// bot following the settings (colors, font, layout, theme, background) and being drawn as a real picture, and a server that designed its own card keeping it.
// No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let saved = null;
let wallet = 100;
const spent = [];
stub('src/db/imageCards.js', { getCard: async (_guild, name) => (name === 'own' ? { data: { kind: 'rank', mode: 'basic', basic: { preset: 'rank', accent: '#123456' }, background: { color: '#000000' } } } : null) });
stub('src/db/cardAssets.js', { getAsset: async () => null });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });
stub('src/db/shop.js', { getActive: async () => ({ banner: null, font: null }), getUserItems: async () => [] });
stub('src/utils/badgeRegistry.js', { ensure: async () => {}, bannerImage: async () => null });
stub('src/db/userRankCard.js', {
  getRankCard: async () => saved,
  saveRankCard: async (_id, settings, paid) => { saved = { settings, gradientPaid: paid || Boolean(saved?.gradientPaid) }; },
  resetRankCard: async () => { saved = saved ? { settings: {}, gradientPaid: saved.gradientPaid } : null; },
});
stub('src/db/ceramos.js', {
  getWallet: async () => ({ balance: wallet, lastDaily: null }),
  spend: async (_id, amount, reason) => { if (wallet < amount) return null; wallet -= amount; spent.push([amount, reason]); return wallet; },
});
const rules = require('../src/utils/userRankCard');
const { renderRankCard, userRankCardFor, defaultRankCard } = require('../src/utils/cardService');
const designs = require('../src/utils/cardDesigns');

(async () => {
  // Defaults and checking: nothing the page cannot send gets through.
  const empty = rules.normalize({});
  assert.deepEqual(empty, rules.DEFAULTS);
  const messy = rules.normalize({ barColor: 'red', barColor2: '#GGGGGG', textColor: '#ABCDEF', font: 'Comic Sans', layout: 'x', avatarShape: 'hex', theme: 'neon', background: 'design:../x' });
  assert.equal(messy.barColor, rules.DEFAULTS.barColor);
  assert.equal(messy.barColor2, null);
  assert.equal(messy.textColor, '#abcdef', 'a good hex is kept, in lower case');
  assert.equal(messy.font, 'Poppins');
  assert.equal(messy.layout, 'side');
  assert.equal(messy.avatarShape, 'circle');
  assert.equal(messy.theme, 'dark');
  assert.equal(messy.background, 'default');
  assert.equal(rules.normalize({ background: 'design:nope-nope' }, () => false).background, 'default', 'a design that does not exist is not kept');
  assert.equal(rules.normalize({ background: 'design:nature-night' }, () => true).background, 'design:nature-night');
  assert.equal(rules.normalize({ background: 'banner' }).background, 'banner');
  assert.equal(rules.normalize({ background: 'shop:gta-vi-couple' }).background, 'shop:gta-vi-couple', 'a banner of the shop');
  assert.equal(rules.normalize({ background: 'shop:../x' }).background, 'default');
  assert.deepEqual(rules.backgroundOf(rules.normalize({ background: 'shop:gta-vi-couple' })), { kind: 'shop', id: 'gta-vi-couple' });

  // Prices: only the two-color bar, once.
  assert.equal(rules.costOf(rules.normalize({ barColor2: '#38bdf8' }), false), 40);
  assert.equal(rules.costOf(rules.normalize({ barColor2: '#38bdf8' }), true), 0, 'paid once, kept');
  assert.equal(rules.costOf(rules.normalize({ barColor: '#38bdf8', font: 'Anton', theme: 'light', layout: 'below' }), false), 0, 'colors, font, layout and theme are free');

  // The basic settings of the card.
  const basic = rules.toBasic(rules.normalize({ barColor: '#38bdf8', barColor2: '#a855f7', font: 'Anton', layout: 'below', theme: 'light', avatarShape: 'rounded' }));
  assert.equal(basic.preset, 'rankBottom');
  assert.equal(basic.accent, '#38bdf8');
  assert.equal(basic.accent2, '#a855f7');
  assert.equal(basic.textColor, '#111827', 'the light theme reads dark on its light panel');
  assert.equal(basic.panelColor, '#ffffff');
  assert.equal(rules.toBasic(rules.normalize({})).accent2, undefined, 'no second color: a plain bar');

  // Saving: the API charges the gradient once and refuses without ceramos.
  const api = { rankCardSave: require('../src/utils/rankCardActions').save, rankCardReset: (id) => require('../src/db/userRankCard').resetRankCard(id) };
  let result = await api.rankCardSave('1', { barColor: '#38bdf8', barColor2: '#a855f7', font: 'Anton' });
  assert.equal(result.ok, true);
  assert.equal(result.charged, 40);
  assert.equal(wallet, 60);
  result = await api.rankCardSave('1', { barColor: '#ef4444', barColor2: '#a855f7' });
  assert.equal(result.charged, 0, 'the gradient is not charged twice');
  assert.equal(wallet, 60);
  await api.rankCardReset('1');
  result = await api.rankCardSave('1', { barColor2: '#22c55e' });
  assert.equal(result.charged, 0, 'a reset keeps what was paid');
  wallet = 10; saved = null;
  result = await api.rankCardSave('1', { barColor2: '#22c55e' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'noCeramos');
  assert.equal(saved, null, 'nothing is saved when it could not be paid');
  wallet = 100;

  // The card of the bot follows the settings; the default one does not change for a person who designed nothing.
  assert.equal(await userRankCardFor('1'), null, 'nothing designed');
  saved = { settings: { barColor: '#38bdf8', barColor2: '#a855f7', layout: 'below', background: `design:${designs.designs()[3].id}` }, gradientPaid: true };
  const custom = await userRankCardFor('1');
  const card = defaultRankCard('messages', 'en', false, custom);
  assert.equal(card.basic.preset, 'rankBottom');
  assert.equal(card.basic.accent2, '#a855f7');
  assert.equal(card.background.image.src, `petto:${designs.designs()[3].id}`);
  assert.equal(defaultRankCard('messages', 'en', false, null).basic.accent2, undefined);
  const plain = defaultRankCard('messages', 'en', true, { basic: {}, background: { kind: 'default' } });
  assert.equal(plain.background.image.src, 'petto:user-banner', 'with the background left at default, a banner on still shows');
  const chosen = defaultRankCard('messages', 'en', true, custom);
  assert.ok(chosen.background.image.src.startsWith('petto:') && chosen.background.image.src !== 'petto:user-banner', 'a design chosen on the page wins over the banner');

  // Drawn for real, with a gradient bar and a font of the list, and a server with its own card keeping it.
  const user = { id: '1', username: 'liam', displayName: 'liam', displayAvatarURL: () => null, createdAt: new Date() };
  const guild = { id: '9', name: 'Petto', memberCount: 5, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const member = { id: '1', user, displayName: 'liam', displayAvatarURL: () => null, joinedTimestamp: 1, roles: { cache: new Collection(), highest: { name: 'Member' } }, premiumSince: null };
  const ctx = { guild, member, user, levelData: { level: 12, xp: 23450, xpNeeded: 2350, xpCurrent: 1420, xpToNext: 930, progress: 60, rank: 3, total: 120, source: 'text' } };
  const file = await renderRankCard(ctx, null, 'messages');
  assert.ok(file && file.buffer.length > 20_000, 'the card of the person is drawn');
  assert.deepEqual([...file.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const own = await renderRankCard(ctx, 'own', 'messages');
  assert.ok(own && own.buffer.length > 1000, 'a server card is drawn');
  assert.deepEqual(file.buffer, own.buffer, 'the card a person designed goes over the card of the server: it shows in every server');
  // Whoever designed nothing gets the card of the server.
  const kept = saved; saved = null;
  const serverCard = await renderRankCard(ctx, 'own', 'messages');
  assert.ok(serverCard && serverCard.buffer.length > 1000); assert.notDeepEqual(serverCard.buffer, file.buffer, 'a person with no design of their own gets the card of the server');
  saved = kept;
  console.log('User rank card checks passed (rules, prices, the API, the card of the bot).');
})().catch((error) => { console.error(error); process.exit(1); });
