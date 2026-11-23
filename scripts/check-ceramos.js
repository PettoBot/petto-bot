// The ceramos: what a day gives by plan, once for each UTC day, buying a badge of the shop once, the frames one step at a time, giving the ceramos back when a purchase
// cannot be finished, the pictures of the wallet and the shop, and the commands (the team tool is hidden and owner only). No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// An in-memory wallet and badge table that behave like the statements of the database (the balance never goes below zero, a day is claimed once).
const wallets = new Map(); // user -> { balance, lastDaily }
const ledger = [];
const badgeRows = new Map(); // user -> [{ id, frame, source }]
const showcases = new Map();
let raceOnAdd = false; // when true, addBadge answers "already there" as if another purchase had won
const wallet = (u) => wallets.get(u) ?? { balance: 0, lastDaily: null };
stub('src/db/ceramos.js', {
  getWallet: async (u) => ({ ...wallet(u) }),
  claimDaily: async (u, amount, day) => { const w = wallet(u); if (w.lastDaily && w.lastDaily >= day) return null; wallets.set(u, { balance: w.balance + amount, lastDaily: day }); ledger.push({ u, delta: amount, reason: 'daily' }); return w.balance + amount; },
  give: async (u, amount, reason, ref) => { const w = wallet(u); wallets.set(u, { ...w, balance: w.balance + amount }); ledger.push({ u, delta: amount, reason, ref }); return w.balance + amount; },
  spend: async (u, amount, reason, ref) => { const w = wallet(u); if (w.balance < amount) return null; wallets.set(u, { ...w, balance: w.balance - amount }); ledger.push({ u, delta: -amount, reason, ref }); return w.balance - amount; },
  lastMovements: async () => [],
});
const customRows = new Map(); // id -> row of the editor
const customImages = new Map();
const voters = new Set();
stub('src/db/customBadges.js', {
  listCustomBadges: async () => [...customRows.values()].map((row) => ({ ...row, hasImage: customImages.has(row.id), updatedAt: row.updatedAt })),
  getCustomImage: async (id) => (customImages.has(id) ? { ...customImages.get(id), updatedAt: customRows.get(id)?.updatedAt ?? '' } : null),
  saveCustomBadge: async (input) => { const had = customRows.has(input.id); customRows.set(input.id, { id: input.id, names: input.names, category: input.category, rarity: input.rarity, price: input.price, color: input.color, saleFrom: input.saleFrom, saleUntil: input.saleUntil, planMin: input.planMin, grantRule: input.grantRule, active: customRows.get(input.id)?.active ?? true, updatedAt: new Date().toISOString() }); return !had; },
  setCustomImage: async (id, bytes, type) => { if (!customRows.has(id)) return false; customImages.set(id, { bytes, type }); return true; },
  setBadgeActive: async (id, active) => { const row = customRows.get(id); if (!row) return false; row.active = active; return true; },
  votedRecently: async (userId) => voters.has(userId),
  ownerCounts: async () => ({}),
});
stub('src/db/userProfile.js', {
  getBadgeRows: async (u) => (badgeRows.get(u) ?? []).map((row) => ({ ...row })),
  addBadge: async (u, id, source) => { if (raceOnAdd) return false; const rows = badgeRows.get(u) ?? []; if (rows.some((row) => row.id === id)) return false; rows.push({ id, frame: 'normal', source }); badgeRows.set(u, rows); return true; },
  getSavedBadges: async (u) => (badgeRows.get(u) ?? []).map((row) => row.id),
  getShowcase: async (u) => [...(showcases.get(u) ?? [])],
  setShowcase: async (u, list) => { showcases.set(u, [...list]); return list; },
  removeBadge: async (u, id) => { const rows = badgeRows.get(u) ?? []; const had = rows.some((row) => row.id === id); badgeRows.set(u, rows.filter((row) => row.id !== id)); showcases.set(u, (showcases.get(u) ?? []).filter((each) => each !== id)); return had; },
  setFrame: async (u, id, from, to) => { const row = (badgeRows.get(u) ?? []).find((each) => each.id === id && each.frame === from); if (!row) return false; row.frame = to; return true; },
});
const OWNER = '111111111111111111';
stub('src/config.js', { ownerId: OWNER, developerIds: [] });
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });

const rules = require('../src/utils/ceramos');
const badges = require('../src/utils/profileBadges');
const shop = require('../src/utils/ceramosShop');
const image = require('../src/utils/ceramosImage');
const { loadImage } = require('@napi-rs/canvas');

(async () => {
  // What a day gives: 2 with no plan, 5, 10 and 20 with a plan.
  assert.deepEqual([null, 'bronze', 'silver', 'gold'].map((plan) => rules.dailyAmount(plan)), [2, 5, 10, 20]);

  // A day is claimed once: the calendar is UTC, so the same moment is the same day for everybody, and the next claim opens at midnight UTC.
  const noon = new Date('2026-11-23T12:00:00Z');
  assert.equal(rules.dayOf(new Date('2026-11-23T23:59:59Z')), '2026-11-23');
  assert.equal(rules.claimStatus(null, noon).canClaim, true);
  assert.equal(rules.claimStatus('2026-11-22', noon).canClaim, true);
  const done = rules.claimStatus('2026-11-23', noon);
  assert.equal(done.canClaim, false);
  assert.equal(done.nextAt.toISOString(), '2026-11-24T00:00:00.000Z');
  assert.equal(rules.parseAmount('250'), 250); assert.equal(rules.parseAmount(0), null); assert.equal(rules.parseAmount('2.5'), null); assert.equal(rules.parseAmount(-3), null); assert.equal(rules.parseAmount(2_000_000), null); assert.equal(rules.parseAmount('abc'), null);

  // Frames: one step at a time, normal, bright (15) and divine (40), and the last one has no next.
  assert.deepEqual(rules.FRAMES.map((frame) => [frame.id, frame.cost]), [['normal', 0], ['bright', 15], ['divine', 40]]);
  // The prices are meant to be reachable: a common badge is a day of the best plan, and a week and a bit with no plan.
  assert.ok(rules.BADGE_PRICE <= rules.DAILY.gold && rules.BADGE_PRICE <= rules.DAILY.none * 14, 'a common badge can be had in two weeks with no plan');
  assert.equal(rules.nextFrame('normal').id, 'bright'); assert.equal(rules.nextFrame('bright').id, 'divine'); assert.equal(rules.nextFrame('divine'), null);
  assert.equal(rules.nextFrame('nonsense').id, 'bright', 'an unknown frame is the first one');

  // The daily claim: the amount of the plan, once for the day, and again the next day.
  let claimed = await shop.claimToday('ana', null, noon);
  assert.deepEqual([claimed.ok, claimed.amount, claimed.balance], [true, 2, 2]);
  claimed = await shop.claimToday('ana', 'gold', noon);
  assert.equal(claimed.ok, false, 'a second claim the same day gives nothing');
  assert.equal(wallet('ana').balance, 2);
  claimed = await shop.claimToday('ana', 'gold', new Date('2026-11-24T00:00:01Z'));
  assert.deepEqual([claimed.ok, claimed.amount, claimed.balance], [true, 20, 22]);
  const bob = await shop.claimToday('bob', 'silver', noon);
  assert.equal(bob.amount, 10);

  // The shop: countries and languages at 250, with their names from the language and their code on the badge. The free ones and the plan ones are not for sale.
  assert.ok(badges.SHOP_BADGES.length >= 10 && badges.SHOP_BADGES.every((def) => def.unlock === 'shop' && badges.badgeLabel(def)));
  assert.equal(badges.badgeName('es', badges.badgeById('country-co'), () => 'x'), 'Colombia');
  assert.equal(badges.badgeName('pt-BR', badges.badgeById('lang-en'), () => 'x'), 'inglês');
  assert.equal(badges.badgeName('en', badges.badgeById('femboy'), (key) => key), 'profiles.badge.femboy');
  assert.equal(rules.BADGE_PRICE, 20);

  // Buying: not enough, not for sale, bought once (the ceramos go once), and never twice.
  assert.equal((await shop.buyBadge('zed', 'country-co')).reason, 'poor');
  assert.equal(wallet('zed').balance, 0, 'a purchase that cannot be paid takes nothing');
  await require('../src/db/ceramos').give('zed', rules.BADGE_PRICE - 1, 'grant', null);
  assert.equal((await shop.buyBadge('zed', 'country-co')).reason, 'poor', 'one ceramo short is still short');
  assert.equal((await shop.buyBadge('ana', 'femboy')).reason, 'unknown');
  assert.equal((await shop.buyBadge('ana', 'plan-gold')).reason, 'unknown');
  assert.equal((await shop.buyBadge('ana', 'made-up')).reason, 'unknown');
  await require('../src/db/ceramos').give('ana', 1000, 'grant', null);
  const bought = await shop.buyBadge('ana', 'country-co');
  assert.deepEqual([bought.ok, bought.balance], [true, 22 + 1000 - 20]);
  assert.equal((await shop.buyBadge('ana', 'country-co')).reason, 'owned');
  assert.equal(wallet('ana').balance, 1002, 'the second purchase did not charge');
  assert.deepEqual(badgeRows.get('ana').map((row) => [row.id, row.source, row.frame]), [['country-co', 'shop', 'normal']]);

  // A purchase that loses a race gives the ceramos back.
  raceOnAdd = true;
  const lost = await shop.buyBadge('ana', 'lang-es');
  raceOnAdd = false;
  assert.equal(lost.reason, 'owned');
  assert.equal(wallet('ana').balance, 1002, 'the ceramos came back');
  assert.ok(ledger.some((row) => row.reason === 'refund' && row.u === 'ana'));

  // Frames: only owned badges, not the badge of a plan, one step each, paid, and the best one has no next.
  assert.equal((await shop.upgradeFrame('ana', 'lang-es')).reason, 'notOwned');
  assert.equal((await shop.upgradeFrame('ana', 'plan-gold')).reason, 'noFrame');
  let up = await shop.upgradeFrame('ana', 'country-co');
  assert.deepEqual([up.ok, up.frame, up.balance], [true, 'bright', 1002 - 15]);
  up = await shop.upgradeFrame('ana', 'country-co');
  assert.deepEqual([up.ok, up.frame, up.balance], [true, 'divine', 1002 - 15 - 40]);
  up = await shop.upgradeFrame('ana', 'country-co');
  assert.equal(up.reason, 'max'); assert.equal(wallet('ana').balance, 1002 - 55, 'nothing is charged past the best frame');
  await require('../src/db/userProfile').addBadge('bob', 'country-mx', 'shop');
  up = await shop.upgradeFrame('bob', 'country-mx');
  assert.equal(up.reason, 'poor'); assert.equal(badgeRows.get('bob')[0].frame, 'normal', 'a frame that is not paid is not given');
  // The Fablo badges can have a frame too once the person has them.
  await require('../src/db/userProfile').addBadge('ana', 'femboy', 'self');
  assert.equal((await shop.upgradeFrame('ana', 'femboy')).ok, true);

  // The pictures: PNG of the right size, the shop grows with its rows, a long name and a huge balance do not break them.
  const dark = { id: 'country-co', art: null, color: '#f2c230', label: 'CO' };
  const wallet1 = image.renderWalletImage({ name: 'a'.repeat(120), avatar: null, balance: '12,345,678', title: 'Ceramos', daily: 'Next daily in 5h 12m', dailyReady: false, movementsTitle: 'Last movements', noMovements: 'none', movements: [{ text: 'Daily', amount: '+20', positive: true }, { text: 'Badge Colombia', amount: '−250', positive: false }] });
  const w1 = await loadImage(wallet1);
  assert.equal(w1.width, 1024); assert.equal(w1.height, image.WALLET_HEIGHT);
  const empty = image.renderWalletImage({ name: 'Ana', avatar: null, balance: '0', title: 'Ceramos', daily: 'Your daily ceramos are ready: /daily', dailyReady: true, movementsTitle: 'Last movements', noMovements: 'No movements yet', movements: [] });
  assert.ok((await loadImage(empty)).width === 1024);
  const items = (n) => Array.from({ length: n }, (_, i) => ({ badge: { ...dark, frame: ['normal', 'bright', 'divine'][i % 3] }, name: 'Colombia'.repeat(3), price: '20', owned: i % 4 === 0 }));
  const s6 = await loadImage(image.renderShopImage({ title: 'Badge shop', balanceText: '772', items: items(6), ownedText: 'Yours' }));
  const s13 = await loadImage(image.renderShopImage({ title: 'Badge shop', balanceText: '772', items: items(13), ownedText: 'Yours' }));
  assert.equal(s6.width, 1024); assert.ok(s13.height > s6.height, 'a second and a third row make it taller');

  // The commands: /ceramos and /daily are slash commands of the second set; the team tool is prefix only, hidden and for the owner only.
  const ceramos = require('../src/commands/utility/ceramos');
  assert.deepEqual(ceramos.data.toJSON().options.map((option) => option.name), ['balance', 'shop', 'buy', 'upgrade']);
  assert.equal(ceramos.guildScoped, true); assert.equal(require('../src/commands/utility/daily').guildScoped, true);
  assert.equal(ceramos.prefixDefaultSubcommand, 'balance');
  const admin = require('../src/commands/info/ceramosadmin');
  assert.ok(admin.prefixOnly && admin.hiddenEverywhere && admin.teamOnly && admin.ownerOnly);
  const replies = [];
  const ask = (userId, sub, values) => admin.execute({ user: { id: userId }, options: { getSubcommand: () => sub, getUser: () => ({ id: 'ana' }), getInteger: () => values.amount, getString: () => values.note ?? null }, reply: async (payload) => { replies.push(payload); } });
  assert.equal(await ask('somebody', 'give', { amount: 50 }), undefined); assert.equal(replies.length, 0, 'nobody but the owner gets an answer');
  const before = wallet('ana').balance;
  await ask(OWNER, 'give', { amount: 50, note: 'prize' });
  assert.equal(wallet('ana').balance, before + 50); assert.equal(replies.length, 1);
  await ask(OWNER, 'take', { amount: 10 * before });
  assert.equal(wallet('ana').balance, before + 50, 'a take of more than they have takes nothing');
  await ask(OWNER, 'take', { amount: 20 });
  assert.equal(wallet('ana').balance, before + 30);

  // The catalog: every country with its flag code, the languages, the Fablo pack and the stars; a common badge costs 20 and the rarities go up.
  const api = require('../src/utils/ceramosApi');
  const cat = await api.catalog();
  const byCategory = (name) => cat.badges.filter((badge) => badge.category === name);
  assert.ok(byCategory('country').length >= 240 && byCategory('country').every((badge) => /^[A-Z]{2}$/.test(badge.region) && badge.price === 20 && badge.rarity === 'common'));
  assert.ok(byCategory('language').length >= 15 && byCategory('fablo').length === 4 && byCategory('plan').length === 3);
  assert.deepEqual(cat.rarityPrice, { common: 20, rare: 50, epic: 120, legendary: 300 });
  assert.deepEqual(cat.slots, { none: 1, bronze: 2, silver: 4, gold: 6 });
  assert.equal(new Set(cat.badges.map((badge) => badge.id)).size, cat.badges.length, 'no two badges share an id');
  // Every flag of the catalog is in the open package (the picture of the badge), and the names come from the language.
  const flagsDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '1x1');
  for (const badge of byCategory('country')) assert.ok(fs.existsSync(path.join(flagsDir, `${badge.region.toLowerCase()}.svg`)), `flag of ${badge.region}`);
  const view = require('../src/utils/profileView');
  const flag = await view.artOfBadge(badges.badgeById('country-co'));
  assert.ok(flag && flag.width > 0, 'the flag of Colombia loads');
  assert.equal(await view.artOfBadge(badges.badgeById('lang-es')), null, 'a language has no picture: it is drawn with its code');

  // The state and the actions the website uses (the same code as the commands).
  let st = await api.state('cami', noon);
  assert.deepEqual([st.balance, st.plan, st.slots, st.owned.length, st.daily.canClaim, st.daily.amount], [0, null, 1, 0, true, 2]);
  assert.equal((await api.claim('cami')).ok, true);
  assert.equal((await api.state('cami')).balance, 2);
  assert.equal((await api.setIdentity('cami', 'plan-gold', true)).reason, 'notYours');
  let id = await api.setIdentity('cami', 'femboy', true);
  assert.deepEqual([id.ok, id.changed, id.showcase], [true, true, ['femboy']], 'a new free badge goes to the free place');
  id = await api.setIdentity('cami', 'hetero', true);
  assert.deepEqual(id.showcase, ['femboy'], 'with one place only, the second stays out of the showcase');
  const saved = await api.saveShowcase('cami', ['hetero', 'femboy', 'country-co']);
  assert.deepEqual([saved.kept, saved.dropped.sort(), saved.slots], [['hetero'], ['country-co', 'femboy'], 1]);
  id = await api.setIdentity('cami', 'hetero', false);
  assert.deepEqual([id.changed, id.showcase], [true, []]);

  // The routes: the secret first, then a good user id, a limit of writes, and the answer of the action.
  const handlers = {};
  const fakeApp = { get: (route, ...rest) => { handlers[`GET ${route}`] = rest[rest.length - 1]; }, post: (route, ...rest) => { handlers[`POST ${route}`] = rest[rest.length - 1]; } };
  let authorized = true;
  require('../src/web/ceramosRoutes').registerCeramosRoutes(fakeApp, { isAuthorized: () => authorized, limiter: (req, res, next) => next(), raw: (req, res, next) => next() });
  assert.ok(['GET /api/dashboard/ceramos/admin/badges', 'POST /api/dashboard/ceramos/admin/badge', 'POST /api/dashboard/ceramos/admin/badge-active', 'POST /api/dashboard/ceramos/admin/badge-image', 'GET /api/dashboard/ceramos/badge-art/:id', 'GET /api/dashboard/ceramos/catalog', 'GET /api/dashboard/ceramos/state', 'POST /api/dashboard/ceramos/daily', 'POST /api/dashboard/ceramos/buy', 'POST /api/dashboard/ceramos/upgrade', 'POST /api/dashboard/ceramos/identity', 'POST /api/dashboard/ceramos/showcase'].every((route) => handlers[route]));
  const call = async (route, { query = {}, body = {}, params = {} } = {}) => { const out = { code: 200 }; await handlers[route]({ query, body, params }, { status(code) { out.code = code; return this; }, json(payload) { out.body = payload; }, set(name, value) { out.headers = { ...out.headers, [name]: value }; return this; }, send(bytes) { out.bytes = bytes; }, headersSent: false }); return out; };
  authorized = false;
  assert.equal((await call('GET /api/dashboard/ceramos/state', { query: { user_id: '123456789012345678' } })).code, 401);
  authorized = true;
  assert.equal((await call('GET /api/dashboard/ceramos/state', { query: { user_id: 'nope' } })).code, 400);
  const good = '123456789012345678';
  assert.equal((await call('GET /api/dashboard/ceramos/catalog', { query: { user_id: good } })).body.badges.length, cat.badges.length);
  assert.equal((await call('POST /api/dashboard/ceramos/buy', { body: { user_id: good, badge: 'country-co' } })).body.result.reason, 'poor');
  assert.equal((await call('POST /api/dashboard/ceramos/buy', { body: { user_id: good, badge: '../x' } })).body.result.reason, 'bad_request');
  await require('../src/db/ceramos').give(good, 5000, 'grant', null);
  const boughtWeb = await call('POST /api/dashboard/ceramos/buy', { body: { user_id: good, badge: 'country-mx' } });
  assert.deepEqual([boughtWeb.body.result.ok, boughtWeb.body.result.balance], [true, 4980]);
  assert.equal((await call('POST /api/dashboard/ceramos/upgrade', { body: { user_id: good, badge: 'country-mx' } })).body.result.frame, 'bright');
  assert.equal((await call('POST /api/dashboard/ceramos/identity', { body: { user_id: good, badge: 'furro', enabled: 'yes' } })).body.result.reason, 'bad_request');
  assert.equal((await call('POST /api/dashboard/ceramos/showcase', { body: { user_id: good, badges: 'x' } })).body.result.reason, 'bad_request');
  let last;
  for (let i = 0; i < 45; i += 1) last = await call('POST /api/dashboard/ceramos/daily', { body: { user_id: '999999999999999999' } });
  assert.equal(last.code, 429, 'more than 40 writes a minute from one person are refused');

  // ---- The editor of badges (only the owner) ----
  const rulesOfEditor = require('../src/utils/customBadgeRules');
  const good1 = { id: 'xmas-2026', names: { en: 'Christmas 2026', es: 'Navidad 2026' }, category: 'special', rarity: 'epic', price: 30, color: '#d9483b', saleFrom: '2026-12-01T00:00:00Z', saleUntil: '2027-01-01T00:00:00Z' };
  assert.equal(rulesOfEditor.checkBadgeInput(good1).ok, true);
  assert.equal(rulesOfEditor.checkBadgeInput(good1).value.names['pt-BR'], 'Christmas 2026', 'a missing language takes the English name');
  for (const [change, error] of [[{ id: 'AB' }, 'bad_id'], [{ id: 'country-xx' }, 'bad_id'], [{ id: 'femboy' }, 'bad_id'], [{ names: { en: '' } }, 'bad_name'], [{ names: { en: 'x'.repeat(41) } }, 'bad_name'], [{ price: -1 }, 'bad_price'], [{ price: 1.5 }, 'bad_price'],
    [{ saleFrom: 'nope' }, 'bad_date'], [{ saleFrom: '2027-02-01T00:00:00Z' }, 'bad_dates'], [{ planMin: 'diamond' }, 'bad_plan'], [{ grantRule: 'magic' }, 'bad_rule'], [{ grantRule: 'voter', price: 5 }, 'rule_and_price']]) {
    assert.equal(rulesOfEditor.checkBadgeInput({ ...good1, ...change }).error, error, `${JSON.stringify(change)} is refused`);
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
  assert.deepEqual(rulesOfEditor.checkImage(png), { ok: true, type: 'image/png' });
  assert.equal(rulesOfEditor.checkImage(Buffer.from('<?php echo 1; ?>')).error, 'bad_image', 'what is not a picture by its bytes is refused');
  assert.equal(rulesOfEditor.checkImage(Buffer.concat([png, Buffer.alloc(300 * 1024)])).error, 'image_too_big');
  assert.equal(rulesOfEditor.checkImage(Buffer.alloc(0)).error, 'image_required');

  // How a badge stands, and what a sale does: nobody buys before or after it, the ones who bought keep it, and it can be put back.
  const editor = require('../src/utils/badgeAdmin');
  const row = { active: true, grantRule: null, saleFrom: '2026-12-01T00:00:00Z', saleUntil: '2027-01-01T00:00:00Z' };
  assert.deepEqual([new Date('2026-11-23'), new Date('2026-12-24'), new Date('2027-01-01T00:00:00Z')].map((at) => editor.saleStatus(row, at)), ['scheduled', 'live', 'ended']);
  assert.equal(editor.saleStatus({ ...row, active: false }, new Date('2026-12-24')), 'retired');
  assert.equal(editor.saleStatus({ ...row, grantRule: 'voter' }, new Date('2026-12-24')), 'rule');
  assert.equal((await editor.save(OWNER, { ...good1, id: 'bad id' })).error, 'bad_id');
  let saved1 = await editor.save(OWNER, good1);
  assert.deepEqual([saved1.ok, saved1.created], [true, true]);
  assert.equal((await editor.save(OWNER, { ...good1, price: 25 })).created, false, 'saving again edits it');
  assert.equal((await editor.setImage('xmas-2026', Buffer.from('nope'))).error, 'bad_image');
  assert.equal((await editor.setImage('nothing-here', png)).error, 'not_found');
  assert.equal((await editor.setImage('xmas-2026', png)).ok, true);
  assert.equal((await editor.list()).badges[0].hasImage, true);
  await require('../src/utils/badgeRegistry').refresh();
  const xmas = badges.badgeById('xmas-2026');
  assert.ok(xmas && xmas.custom && badges.priceOf(xmas) === 25, 'the badge of the editor is in the catalog with its own price');
  assert.equal(badges.categoryOf(xmas), 'special');
  assert.equal(badges.badgeName('es', xmas, () => 'x'), 'Navidad 2026');
  assert.ok(badges.shopBadges().includes(xmas) && !badges.SHOP_BADGES.includes(xmas));
  const early = new Date('2026-11-30T12:00:00Z'), during = new Date('2026-12-24T12:00:00Z'), after = new Date('2027-01-01T00:00:01Z');
  await require('../src/db/ceramos').give('nina', 100, 'grant', null);
  await require('../src/db/ceramos').give('omar', 100, 'grant', null);
  assert.equal((await shop.buyBadge('nina', 'xmas-2026', early)).reason, 'closed', 'not before the sale');
  const sold = await shop.buyBadge('nina', 'xmas-2026', during);
  assert.deepEqual([sold.ok, sold.balance, sold.price], [true, 75, 25]);
  assert.equal((await shop.buyBadge('omar', 'xmas-2026', after)).reason, 'closed', 'nor after it');
  assert.equal(wallet('omar').balance, 100, 'nothing was charged');
  assert.equal((await shop.buyBadge('nina', 'xmas-2026', after)).reason, 'owned');
  assert.ok((await view.profileState('nina')).owned.includes('xmas-2026'), 'the one who bought it still has it after the sale');
  await editor.setActive('xmas-2026', false);
  await require('../src/utils/badgeRegistry').refresh();
  assert.equal((await shop.buyBadge('omar', 'xmas-2026', during)).reason, 'closed', 'taken off sale, nobody buys it');
  assert.ok((await view.profileState('nina')).owned.includes('xmas-2026'), 'and whoever has it keeps it');
  assert.equal((await shop.upgradeFrame('nina', 'xmas-2026')).ok, true, 'it can still be framed');
  await editor.setActive('xmas-2026', true); await require('../src/utils/badgeRegistry').refresh();
  assert.equal((await shop.buyBadge('omar', 'xmas-2026', during)).ok, true, 'put back, it is bought again');
  // A free one is got without spending; one that asks for a plan is for that plan.
  await editor.save(OWNER, { id: 'gift-badge', names: { en: 'Gift' }, price: 0 });
  await require('../src/utils/badgeRegistry').refresh();
  const gift = await shop.buyBadge('zed', 'gift-badge');
  assert.deepEqual([gift.ok, gift.balance, wallet('zed').balance], [true, rules.BADGE_PRICE - 1, rules.BADGE_PRICE - 1], 'free means no ceramos are taken');
  assert.equal(badges.planAllows({ planMin: 'silver' }, null), false); assert.equal(badges.planAllows({ planMin: 'silver' }, 'bronze'), false);
  assert.equal(badges.planAllows({ planMin: 'silver' }, 'gold'), true); assert.equal(badges.planAllows({}, null), true);
  await editor.save(OWNER, { id: 'gold-only', names: { en: 'Gold only' }, price: 5, planMin: 'gold' });
  await require('../src/utils/badgeRegistry').refresh();
  assert.equal((await shop.buyBadge('omar', 'gold-only')).reason, 'plan', 'nobody has a plan yet, so the badge for a plan is closed to them');
  // A badge given by itself: had while the person is what it says (a voter), and gone when they stop.
  await editor.save(OWNER, { id: 'voter-badge', names: { en: 'Voter' }, grantRule: 'voter' });
  await require('../src/utils/badgeRegistry').refresh();
  assert.equal((await shop.buyBadge('omar', 'voter-badge')).reason, 'unknown', 'a badge given by a rule cannot be bought');
  assert.equal((await view.profileState('vera')).owned.includes('voter-badge'), false);
  voters.add('vera');
  assert.equal((await view.profileState('vera')).owned.includes('voter-badge'), true);
  assert.equal((await shop.upgradeFrame('vera', 'voter-badge')).reason === 'poor' || (await shop.upgradeFrame('vera', 'voter-badge')).ok, true, 'it can be framed once had (a poor person is told they lack ceramos, not that they do not have it)');
  voters.delete('vera');
  assert.equal((await view.profileState('vera')).owned.includes('voter-badge'), false, 'and it goes when they stop being a voter');
  // The routes: only the owner, the picture and the art.
  assert.equal((await call('GET /api/dashboard/ceramos/admin/badges', { query: { user_id: good } })).body.error, 'forbidden');
  assert.equal((await call('POST /api/dashboard/ceramos/admin/badge', { body: { user_id: good, ...good1, id: 'sneaky-one' } })).body.error, 'forbidden');
  assert.equal((await call('GET /api/dashboard/ceramos/admin/badges', { query: { user_id: OWNER } })).body.badges.length >= 4, true);
  assert.equal((await call('POST /api/dashboard/ceramos/admin/badge', { body: { user_id: OWNER, ...good1, id: 'new-year-27' } })).body.created, true);
  assert.equal((await call('POST /api/dashboard/ceramos/admin/badge-image', { query: { user_id: OWNER, id: 'new-year-27' }, body: png })).body.ok, true);
  assert.equal((await call('POST /api/dashboard/ceramos/admin/badge-image', { query: { user_id: OWNER, id: 'new-year-27' }, body: 'not bytes' })).body.reason, 'bad_request');
  const art = await call('GET /api/dashboard/ceramos/badge-art/:id', { params: { id: 'new-year-27' } });
  assert.deepEqual([art.code, art.headers['Content-Type']], [200, 'image/png']);
  assert.equal((await call('GET /api/dashboard/ceramos/badge-art/:id', { params: { id: 'nothing-here' } })).code, 404);
  const tagged = (await api.catalog()).badges.find((badge) => badge.id === 'xmas-2026');
  assert.deepEqual([tagged.custom, tagged.category, tagged.names.es, tagged.onSale, tagged.rarity], [true, 'special', 'Navidad 2026', false, 'epic'], 'the sale of the example starts in December, so today it is not on sale');

  console.log('ceramos checks passed'); // i18n-ignore: output of a check
})().catch((error) => { console.error(error); process.exit(1); });
