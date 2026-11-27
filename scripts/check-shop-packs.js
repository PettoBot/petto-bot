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
const images = require('../src/utils/shopImages');

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

  // The price of a whole pack: its fixed price when the team set one, or the sum of pieces; once you own part of the pack, you never pay more than the remaining paid pieces.
  badges.setPacks([pack({ price: 150 })]);
  catalog.setItems([item('a'), item('b'), item('c', { rarity: 'common' }), item('gone', { retired: true }), item('nofile', { hasFile: false })]);
  assert.deepEqual(catalog.packSummary('winter-pack').pieces, ['banner:a', 'banner:b', 'banner:c'], 'retired pieces and pieces with no file are not sold');
  assert.equal(catalog.packSummary('winter-pack').fullPrice, 50 + 50 + 20);
  assert.equal(catalog.packSummary('winter-pack').price, 150, 'a fixed pack price is respected when buying the whole pack');
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

  // Every banner is cut to the same size (the middle of the picture, never stretched), so the proportions are right on the profile, the rank card and the shop.
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const picture = (w, h) => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#38bdf8'; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
  for (const [w, h] of [[1500, 900], [3000, 400], [1024, 320], [900, 900]]) {
    const out = await images.normalizeBanner(picture(w, h));
    assert.equal(out.ok, true, `${w}x${h} is accepted`);
    const image = await loadImage(out.bytes);
    assert.deepEqual([image.width, image.height, out.type], [images.BANNER_WIDTH, images.BANNER_HEIGHT, 'image/webp'], `${w}x${h} is saved at 1024x320`);
  }
  assert.equal((await images.normalizeBanner(picture(600, 600))).error, 'file_too_small');
  assert.equal((await images.normalizeBanner(Buffer.from('not a picture'))).error, 'bad_file');

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

  // The packs the shop starts with: five of banners and two of name fonts, each piece pointing at a pack that exists, and a whole pack never dearer than its pieces.
  const fsMod = require('node:fs');
  const schema = fsMod.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const seeded = new Map([...schema.matchAll(/insert into shop_packs \(id, kind, names, color, free(, price)?\) values \('([a-z0-9-]+)', '(badge|banner|font)', '[^']*'::jsonb, '#[0-9a-f]{6}', (true|false)(?:, (\d+))?\)/g)].map((m) => [m[2], { kind: m[3], free: m[4] === 'true', price: m[5] ? Number(m[5]) : null }]));
  assert.equal([...seeded.values()].filter((pack) => pack.kind === 'banner').length, 5, 'five packs of banners');
  assert.equal([...seeded.values()].filter((pack) => pack.kind === 'font').length, 2, 'two packs of name fonts');
  const banners = JSON.parse(fsMod.readFileSync(path.join(__dirname, '../src/assets/shop-banners/index.json'), 'utf8'));
  const rarityPrice = { common: 20, rare: 50, epic: 120, legendary: 300 };
  const pieces = new Map();
  for (const banner of banners) {
    assert.ok(fsMod.existsSync(path.join(__dirname, '../src/assets/shop-banners', `${banner.id}.webp`)), `${banner.id}.webp exists`);
    assert.ok(banner.credit, `${banner.id} has its credit`);
    if (banner.pack) { assert.equal(seeded.get(banner.pack)?.kind, 'banner', `${banner.id} is in a pack of banners that exists`); pieces.set(banner.pack, (pieces.get(banner.pack) ?? 0) + (banner.price ?? rarityPrice[banner.rarity])); }
  }
  for (const font of seed.FONTS) if (font.pack) { assert.equal(seeded.get(font.pack)?.kind, 'font', `${font.slug} is in a pack of fonts that exists`); pieces.set(font.pack, (pieces.get(font.pack) ?? 0) + rarityPrice[font.rarity]); }
  for (const [id, pack] of seeded) {
    if (pack.kind === 'badge') continue;
    assert.ok(pieces.get(id) > 0, `${id} has pieces`);
    if (pack.price !== null) assert.ok(pack.price < pieces.get(id), `${id}: the whole pack (${pack.price}) is cheaper than its pieces (${pieces.get(id)})`);
  }

  console.log('Shop checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });
