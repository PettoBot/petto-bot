// The Bufis: six badges of the shop (the special tab), with names in the three languages, and Black Friday only on sale for its days.
process.env.DISCORD_TOKEN ||= 'check-only'; process.env.DISCORD_CLIENT_ID ||= '1'; process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const rules = require('../src/utils/profileBadges');
const ids = ['bufi-normal', 'bufi-silver', 'bufi-girl', 'bufi-boy', 'bufi-bu', 'bufi-black-friday'];
for (const id of ids) {
  const def = rules.badgeById(id);
  assert.ok(def, `${id} exists`); assert.equal(def.unlock, 'shop'); assert.equal(rules.categoryOf(def), 'special');
  assert.ok(rules.priceOf(def) > 0, `${id} has a price`);
  for (const lang of ['en', 'es', 'pt-BR']) assert.ok(rules.badgeName(lang, def, (key) => require('../src/i18n').t(lang, key)) && !rules.badgeName(lang, def, (key) => require('../src/i18n').t(lang, key)).startsWith('profiles.badge'), `${id} is named in ${lang}`);
  assert.ok(def.art === `${id}.png` && def.color, `${id} has its own picture`);
  assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'src', 'assets', 'badges', def.art)), `the picture of ${id} exists`);
}
assert.ok(rules.shopBadges().some((def) => def.id === 'bufi-silver'), 'the shop lists the Bufis');
const friday = rules.badgeById('bufi-black-friday');
assert.equal(rules.onSale(friday, new Date('2026-11-27T12:00:00Z')), true, 'on sale on Black Friday');
assert.equal(rules.onSale(friday, new Date('2026-11-10T12:00:00Z')), false, 'not before');
assert.equal(rules.onSale(friday, new Date('2026-12-05T12:00:00Z')), false, 'not after');
assert.equal(rules.onSale(rules.badgeById('bufi-silver'), new Date('2027-03-01T12:00:00Z')), true, 'the others are always on sale');
console.log('bufis: ok');
