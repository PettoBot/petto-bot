// The shop of the profile, round two: what the editor accepts (packs, banners, name fonts, changes to the badges of the code), what a change of the team does to a badge,
// the days and the plan of a pack counting for its pieces, free packs, the price of a whole pack, buying a banner, a font or a pack once (and giving the ceramos back when a
// purchase cannot be finished), wearing only what you have, and the name fonts the shop starts with. No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// In-memory wallet and tables that behave like the statements of the database.
const wallets = new Map();
const wallet = (u) => wallets.get(u) ?? { balance: 0 };
const userItems = new Map(); // user -> Set('kind:id')
const badgeRows = new Map(); // user -> [{ id }]
const active = new Map();
let failOnAdd = false;
stub('src/db/ceramos.js', {
  getWallet: async (u) => ({ ...wallet(u), lastDaily: null }),
  give: async (u, amount) => { const w = wallet(u); wallets.set(u, { balance: w.balance + amount }); return w.balance + amount; },
  spend: async (u, amount) => { const w = wallet(u); if (w.balance < amount) return null; wallets.set(u, { balance: w.balance - amount }); return w.balance - amount; },
});
stub('src/db/shop.js', {
  getUserItems: async (u) => [...(userItems.get(u) ?? [])].map((key) => ({ kind: key.split(':')[0], id: key.split(':')[1] })),
  addUserItem: async (u, kind, id) => { if (failOnAdd) throw new Error('database down'); const set = userItems.get(u) ?? new Set(); const key = `${kind}:${id}`; if (set.has(key)) return false; set.add(key); userItems.set(u, set); return true; },
  getActive: async (u) => active.get(u) ?? { banner: null, font: null },
  setActive: async (u, kind, id) => { const now = active.get(u) ?? { banner: null, font: null }; active.set(u, { ...now, [kind]: id }); },
});
stub('src/db/userProfile.js', {
  getBadgeRows: async (u) => (badgeRows.get(u) ?? []).map((id) => ({ id, frame: 'normal', source: 'shop' })),
  addBadge: async (u, id) => { const list = badgeRows.get(u) ?? []; if (list.includes(id)) return false; list.push(id); badgeRows.set(u, list); return true; },
});
stub('src/utils/badgeRegistry.js', { ensure: async () => {}, invalidate: () => {} });
stub('src/db/customBadges.js', { ownerCounts: async () => ({}), listCustomBadges: async () => [] });
stub('src/utils/badgeAdmin.js', { list: async () => ({ badges: [] }) });
let plan = null;
stub('src/utils/profileView.js', { planOfUser: async () => plan });

const rules = require('../src/utils/shopRules');
const badges = require('../src/utils/profileBadges');
const catalog = require('../src/utils/shopCatalog');
const buy = require('../src/utils/shopBuy');
const seed = require('../src/utils/shopSeed');
const admin = require('../src/utils/shopAdmin');

(async () => {
  const names = { en: 'Winter', es: 'Invierno', 'pt-BR': 'Inverno' };

  // Packs: an id, a kind, the words, a price that is not set together with "free", days in order, a plan.
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'badge', names }).ok, true);
  assert.equal(rules.checkPackInput({ id: 'ab', kind: 'badge', names }).error, 'bad_id');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'sticker', names }).error, 'bad_kind');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'badge', names: {} }).error, 'bad_name');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'badge', names, free: true, price: 10 }).error, 'free_and_price');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'badge', names, saleFrom: '2026-12-02', saleUntil: '2026-12-01' }).error, 'bad_dates');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'badge', names, planMin: 'diamond' }).error, 'bad_plan');
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'font', names, price: 150 }).value.price, 150);
  assert.equal(rules.checkPackInput({ id: 'winter-pack', kind: 'font', names, color: 'nope' }).value.color, '#8f7bd6');

  // Banners and name fonts: the price may be left to the rarity; a pack has to be a real id.
  assert.equal(rules.checkItemInput({ kind: 'banner', id: 'aurora', names }).value.price, null);
  assert.equal(rules.checkItemInput({ kind: 'banner', id: 'aurora', names, price: 0 }).value.price, 0);
  assert.equal(rules.checkItemInput({ kind: 'banner', id: 'aurora', names, price: -1 }).error, 'bad_price');
  assert.equal(rules.checkItemInput({ kind: 'poster', id: 'aurora', names }).error, 'bad_kind');
  assert.equal(rules.checkItemInput({ kind: 'font', id: 'aurora', names, packId: 'Bad Id' }).error, 'bad_pack');

  // A change to a badge of the code: only the ones of the code, never a plan; empty fields stay as they are.
  assert.equal(rules.checkOverrideInput({ id: 'country-co', names: { en: 'Colombia' } }).ok, true);
  assert.equal(rules.checkOverrideInput({ id: 'femboy', color: '#112233', price: 5 }).value.color, '#112233');
  assert.equal(rules.checkOverrideInput({ id: 'plan-gold', color: '#112233' }).error, 'bad_id');
  assert.equal(rules.checkOverrideInput({ id: 'custom-one', color: '#112233' }).error, 'bad_id');
  assert.equal(rules.checkOverrideInput({ id: 'furro', color: 'red' }).error, 'bad_color');
  assert.equal(rules.checkOverrideInput({ id: 'furro' }).value.names, null);

  // The files are checked by their first bytes, never by what the sender says.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
  assert.equal(rules.checkBanner(png).type, 'image/png');
  assert.equal(rules.checkBanner(gif).error, 'bad_file');
  assert.equal(rules.checkBanner(Buffer.alloc(0)).error, 'file_required');
  assert.equal(rules.checkBanner(Buffer.alloc(rules.MAX_BANNER_BYTES + 1, 1)).error, 'file_too_big');
  assert.equal(rules.checkFont(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(40)])).type, 'font/ttf');
  assert.equal(rules.checkFont(Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(40)])).type, 'font/otf');
  assert.equal(rules.checkFont(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40)])).type, 'font/woff2');
  assert.equal(rules.checkFont(png).error, 'bad_file');

  // A change of the team over a badge of the code: names, colour, price, pack, picture; the plans never change.
  badges.setPacks([{ id: 'fablo', kind: 'badge', names, color: '#ff8fc2', price: null, free: true, saleFrom: null, saleUntil: null, planMin: null, retired: false }]);
  badges.setBadgeChanges(new Map([
    ['femboy', { names: { en: 'Femboy!' }, color: '#112233', dbArt: true, version: 'v2' }],
    ['country-co', { price: 7, rarity: 'rare', pack: 'andes' }],
    ['plan-gold', { color: '#000000', names: { en: 'Hacked' } }],
  ]));
  assert.equal(badges.badgeById('femboy').color, '#112233');
  assert.equal(badges.badgeById('femboy').dbArt, true);
  assert.equal(badges.badgeName('en', badges.badgeById('femboy'), () => 'x'), 'Femboy!');
  assert.equal(badges.badgeById('plan-gold').color, '#f4cf3a', 'the official plan icons are never changed');
  assert.equal(badges.priceOf(badges.badgeById('country-co')), 7);
  assert.equal(badges.badgeById('country-co').pack, 'andes');
  assert.equal(badges.badgeById('hetero').color, '#6fb4ff', 'a badge nobody changed stays as the code has it');
  badges.setBadgeChanges(new Map());
  assert.equal(badges.badgeById('femboy').color, '#ff8fc2', 'taking the changes away brings the code back');

  // Packs: their days and their plan count for every piece, a retired pack sells nothing, a free pack makes its pieces free.
  const pack = (over) => ({ id: 'winter-pack', kind: 'banner', names, color: '#5a8be0', price: 150, free: false, saleFrom: null, saleUntil: null, planMin: null, retired: false, ...over });
  const item = (id, over = {}) => ({ kind: 'banner', id, names: { en: id }, rarity: 'rare', price: null, hasFile: true, version: 'v1', pack: 'winter-pack', saleFrom: null, saleUntil: null, planMin: null, retired: false, ...over });
  const day = (iso) => new Date(iso);
  badges.setPacks([pack({ saleFrom: '2026-12-01T00:00:00Z', saleUntil: '2027-01-01T00:00:00Z' })]);
  assert.equal(badges.onSale(item('a'), day('2026-11-30T00:00:00Z')), false, 'the pack has not started');
  assert.equal(badges.onSale(item('a'), day('2026-12-15T00:00:00Z')), true);
  assert.equal(badges.onSale(item('a'), day('2027-01-01T00:00:00Z')), false, 'the pack ended');
  assert.equal(badges.onSale(item('a', { retired: true }), day('2026-12-15T00:00:00Z')), false);
  badges.setPacks([pack({ retired: true })]);
  assert.equal(badges.onSale(item('a')), false, 'a retired pack sells nothing');
  badges.setPacks([pack({ planMin: 'silver' })]);
  assert.equal(badges.planNeeded(item('a')), 'silver');
  assert.equal(badges.planNeeded(item('a', { planMin: 'gold' })), 'gold', 'the stricter of the two');
  assert.equal(badges.planAllows(item('a'), 'bronze'), false);
  assert.equal(badges.planAllows(item('a'), 'gold'), true);
  badges.setPacks([pack({ free: true, price: null })]);
  catalog.setItems([item('a'), item('b')]);
  assert.equal(catalog.priceOf(catalog.itemById('banner', 'a')), 0, 'a free pack makes its pieces free');

  // The price of a whole pack: its own price, never dearer than the pieces you do not have; every piece you have is left out.
  badges.setPacks([pack({ price: 150 })]);
  catalog.setItems([item('a'), item('b'), item('c', { rarity: 'common' }), item('gone', { retired: true }), item('nofile', { hasFile: false })]);
  assert.deepEqual(catalog.packSummary('winter-pack').pieces, ['banner:a', 'banner:b', 'banner:c'], 'retired pieces and pieces with no file are not sold');
  assert.equal(catalog.packSummary('winter-pack').fullPrice, 50 + 50 + 20);
  assert.equal(catalog.packSummary('winter-pack').price, 120, 'the pack is never dearer than the pieces');
  assert.equal(catalog.packSummary('winter-pack', new Set(['banner:a', 'banner:b'])).price, 20);
  assert.equal(catalog.packSummary('nope'), null);
  badges.setPacks([pack({ price: null })]);
  assert.equal(catalog.packSummary('winter-pack').price, 120, 'with no price of its own it is the sum');

  // Buying a banner: once, with ceramos, only when the sale is open and the plan is enough; the ceramos come back when someone else won the race.
  badges.setPacks([pack({ price: 100 })]);
  catalog.setItems([item('a'), item('b', { price: 0 }), item('c', { planMin: 'gold' }), item('d', { saleUntil: '2020-01-01T00:00:00Z' })]);
  wallets.set('u1', { balance: 60 });
  let result = await buy.buyItem('u1', 'banner', 'a');
  assert.deepEqual([result.ok, result.balance], [true, 10]);
  assert.equal((await buy.buyItem('u1', 'banner', 'a')).reason, 'owned');
  assert.equal(wallet('u1').balance, 10, 'owning it again costs nothing');
  assert.equal((await buy.buyItem('u1', 'banner', 'zzz')).reason, 'unknown');
  assert.equal((await buy.buyItem('u1', 'banner', 'c')).reason, 'plan');
  assert.equal((await buy.buyItem('u1', 'banner', 'd')).reason, 'closed');
  assert.equal((await buy.buyItem('u2', 'banner', 'a')).reason, 'poor');
  assert.equal((await buy.buyItem('u2', 'banner', 'b')).ok, true, 'a free piece costs nothing');
  plan = 'gold';
  wallets.set('u3', { balance: 500 });
  assert.equal((await buy.buyItem('u3', 'banner', 'c')).ok, true);
  plan = null;

  // Buying a whole pack: every piece you do not have, for the price of the pack, once.
  catalog.setItems([item('a'), item('b'), item('c', { rarity: 'common' })]);
  wallets.set('u4', { balance: 130 });
  let bought = await buy.buyPack('u4', 'winter-pack');
  assert.deepEqual([bought.ok, bought.price, bought.added, bought.balance], [true, 100, 3, 30]);
  assert.equal((await buy.buyPack('u4', 'winter-pack')).reason, 'nothing');
  wallets.set('u5', { balance: 30 });
  assert.equal((await buy.buyPack('u5', 'winter-pack')).reason, 'poor');
  assert.equal((await buy.buyPack('u5', 'ghost-pack')).reason, 'unknown');
  wallets.set('u6', { balance: 100 });
  failOnAdd = true;
  await assert.rejects(buy.buyPack('u6', 'winter-pack'));
  failOnAdd = false;
  assert.equal(wallet('u6').balance, 100, 'when a piece cannot be saved the ceramos come back');
  // A pack of badges adds badges.
  badges.setPacks([pack({ id: 'andes-pack', kind: 'badge', price: 30 })]);
  badges.setBadgeChanges(new Map([['country-co', { pack: 'andes-pack' }], ['country-pe', { pack: 'andes-pack' }]]));
  badges.setCustomBadges([]);
  wallets.set('u7', { balance: 100 });
  bought = await buy.buyPack('u7', 'andes-pack');
  assert.deepEqual([bought.ok, bought.price, bought.added], [true, 30, 2], 'the pack is cheaper than 20 + 20 would be only when the team says so');
  assert.deepEqual(badgeRows.get('u7').sort(), ['country-co', 'country-pe']);
  badges.setBadgeChanges(new Map());

  // Wearing: only what you have, and null takes it off.
  assert.equal((await buy.wear('u1', 'banner', 'a')).ok, true);
  assert.equal(active.get('u1').banner, 'a');
  assert.equal((await buy.wear('u2', 'banner', 'a')).reason, 'notOwned');
  assert.equal((await buy.wear('u1', 'banner', 'zzz')).reason, 'unknown');
  assert.equal((await buy.wear('u1', 'banner', null)).ok, true);
  assert.equal(active.get('u1').banner, null);

  // The status of what the editor lists.
  const now = day('2026-12-15T00:00:00Z');
  assert.equal(admin.packStatus({ active: true, saleFrom: null, saleUntil: null }, now), 'live');
  assert.equal(admin.packStatus({ active: false, saleFrom: null, saleUntil: null }, now), 'retired');
  assert.equal(admin.packStatus({ active: true, saleFrom: '2027-01-01T00:00:00Z', saleUntil: null }, now), 'scheduled');
  assert.equal(admin.packStatus({ active: true, saleFrom: null, saleUntil: '2026-12-01T00:00:00Z' }, now), 'ended');

  // The name fonts the shop starts with: the ones of Vetox, every file is there and is really a font, no repeats, a few of each rarity.
  assert.equal(new Set(seed.FONTS.map((font) => font.slug)).size, seed.FONTS.length);
  assert.ok(seed.FONTS.length >= 24);
  for (const font of seed.FONTS) {
    const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'fonts', `${font.slug}-400.woff2`));
    assert.equal(rules.checkFont(file).ok, true, `${font.slug} is a font file`);
    assert.match(font.slug, /^[a-z0-9][a-z0-9-]{2,39}$/);
  }
  for (const rarity of ['rare', 'epic', 'legendary']) assert.ok(seed.FONTS.some((font) => font.rarity === rarity));

  console.log('Shop checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });
