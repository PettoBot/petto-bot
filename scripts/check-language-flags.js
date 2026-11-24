// The badge of each language of the shop carries the flag of the country that stands for it (a language has no flag of its own): every language has one, it is a country
// that has a badge in the shop, and the catalog of the website passes it along.
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost/db';
const assert = require('node:assert/strict');
const badges = require('../src/utils/profileBadges');

const languages = badges.SHOP_BADGES.filter((def) => def.language);
assert.equal(languages.length, 20, 'the twenty languages of the shop');
const countries = new Set(badges.SHOP_BADGES.filter((def) => def.region).map((def) => def.region));
for (const def of languages) {
  assert.match(String(def.flag), /^[A-Z]{2}$/, `${def.id} has a flag`);
  assert.ok(countries.has(def.flag), `${def.id}: the flag ${def.flag} is a country of the shop`);
}
assert.equal(badges.LANGUAGE_FLAGS.es, 'ES');
assert.equal(badges.LANGUAGE_FLAGS.pt, 'BR');
assert.equal(Object.keys(badges.LANGUAGE_FLAGS).length, 20);
// The countries keep their own flag and carry no `flag` field.
assert.ok(badges.SHOP_BADGES.filter((def) => def.region).every((def) => def.flag === undefined));
console.log('Language flags checks passed (one flag for each of the twenty languages, all of them countries of the shop).');
