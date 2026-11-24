// The packs of ceramos that are sold: four packs that give more and cost more, valid ids and prices, the catalog that lists them, and the ceramos of a paid order arriving once however many
// times the payment service sends it. No database: the wallet is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (relative, exports) => { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const orders = new Set();
const wallets = new Map();
stub('src/db/ceramos.js', {
  getWallet: async (id) => ({ balance: wallets.get(id) ?? 0, lastDaily: null }),
  giveOnce: async (id, amount, pack, order) => { if (orders.has(order)) return { balance: wallets.get(id) ?? 0, applied: false }; orders.add(order); wallets.set(id, (wallets.get(id) ?? 0) + amount); return { balance: wallets.get(id), applied: true }; },
});
const packs = require('../src/utils/coinPacks');
const apiSource = require('node:fs').readFileSync(path.join(__dirname, '../src/utils/ceramosApi.js'), 'utf8');
const { credit: creditPack } = require('../src/utils/coinPackActions');

(async () => {
  assert.equal(packs.COIN_PACKS.length, 4, 'four packs');
  for (let i = 0; i < packs.COIN_PACKS.length; i += 1) {
    const pack = packs.COIN_PACKS[i];
    assert.match(pack.id, /^[a-z0-9][a-z0-9-]{2,30}$/);
    assert.ok(Number.isInteger(pack.coins) && pack.coins > 0);
    assert.ok(pack.price > 0 && Math.round(pack.price * 100) === pack.price * 100 || Math.abs(pack.price * 100 - Math.round(pack.price * 100)) < 1e-9, 'a price in cents');
    if (i) { assert.ok(pack.coins > packs.COIN_PACKS[i - 1].coins, 'each pack gives more'); assert.ok(pack.price > packs.COIN_PACKS[i - 1].price, 'and costs more'); }
  }
  assert.deepEqual(packs.COIN_PACKS.map((pack) => [pack.coins, pack.price]), [[500, 2.99], [850, 4.99], [1200, 7.99], [2000, 11.99]]);
  assert.equal(packs.packById('chest').coins, 2000);
  assert.equal(packs.packById('nope'), null);
  assert.ok(/coinPacks: coinPacks\.COIN_PACKS/.test(apiSource), 'the catalog lists the packs');

  // The ceramos of a paid order: once, however many times it arrives; a wrong pack or order id gives nothing.
  let result = await creditPack('1', 'small-bag', 'order_abc123');
  assert.deepEqual([result.ok, result.coins, result.balance, result.applied], [true, 850, 850, true]);
  result = await creditPack('1', 'small-bag', 'order_abc123');
  assert.deepEqual([result.ok, result.applied, result.balance], [true, false, 850], 'the same order again gives nothing');
  result = await creditPack('1', 'chest', 'order_def456');
  assert.equal(result.balance, 2850);
  assert.equal((await creditPack('1', 'nope', 'order_zzz999')).ok, false, 'a pack that does not exist');
  assert.equal((await creditPack('1', 'pile', 'x')).ok, false, 'an order id that is too short');
  assert.equal((await creditPack('1', 'pile', 'bad id with spaces')).ok, false);
  console.log('Coin pack checks passed (the list, the catalog, one credit for each order).');
})().catch((error) => { console.error(error); process.exit(1); });
