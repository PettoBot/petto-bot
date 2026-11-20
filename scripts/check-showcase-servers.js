// Checks the servers of the carousel of the home page: who shows (500 members or more, not hidden), the order, the limit of 15, how a bigger server takes
// the place of the last one, the animated icon, the marks, the online members kept for five minutes, and that a failure of Discord keeps the last number.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const showcase = require('../src/utils/showcaseServers');

const entry = (id, members) => ({ id: String(id), members });

// Who shows, in what order.
assert.deepEqual(showcase.pickShowcase([entry(1, 499), entry(2, 500), entry(3, 1200)]).map((e) => e.id), ['3', '2'], '500 and more show, 499 does not, the biggest first');
assert.deepEqual(showcase.pickShowcase([entry(1, 900), entry(2, 2000)], new Set(['2'])).map((e) => e.id), ['1'], 'a hidden server never shows');
assert.deepEqual(showcase.pickShowcase([entry(5, 700), entry(4, 700)]).map((e) => e.id), ['4', '5'], 'a tie keeps the order of the id');
assert.deepEqual(showcase.pickShowcase([entry(1, Number.NaN), entry(2, 800)]).map((e) => e.id), ['2'], 'a number that is not one never shows');

// At most 15, and a bigger server takes the place of the last one.
const twenty = Array.from({ length: 20 }, (_, i) => entry(100 + i, 600 + i));
const top = showcase.pickShowcase(twenty);
assert.equal(top.length, 15, 'at most 15');
assert.equal(top[0].members, 619);
assert.equal(top.at(-1).members, 605, 'the last one is the 15th biggest');
const bigger = showcase.pickShowcase([...twenty, entry(999, 606)]);
assert.ok(bigger.some((e) => e.id === '999'), 'a server with more members than the last one comes in');
assert.ok(!bigger.some((e) => e.members === 605), 'and the last one goes out');
assert.equal(bigger.length, 15);
assert.equal(showcase.MIN_MEMBERS, 500);
assert.equal(showcase.MAX_SERVERS, 15);

// The marks.
assert.deepEqual(showcase.badgesOf(['COMMUNITY', 'DISCOVERABLE', 'VERIFIED', 'PARTNERED']), ['partnered', 'verified', 'discoverable'], 'discoverable replaces community');
assert.deepEqual(showcase.badgesOf(['COMMUNITY']), ['community']);
assert.deepEqual(showcase.badgesOf(['COMMUNITY', 'VERIFIED']), ['verified', 'community']);
assert.deepEqual(showcase.badgesOf(['NEWS']), [], 'a server that is nothing special has no mark');
assert.deepEqual(showcase.badgesOf(), []);

// The whole list from a client: icon (animated or not), online members, kept for five minutes, kept when Discord does not answer.
function guild(id, members, extra = {}) {
  return { id, name: `Server ${id}`, memberCount: members, icon: extra.icon ?? null, features: extra.features ?? [], premiumTier: extra.tier ?? 0, iconURL: ({ forceStatic }) => (extra.icon ? `https://cdn.discordapp.com/icons/${id}/${extra.icon}.${!forceStatic && extra.icon.startsWith('a_') ? 'gif' : 'png'}?size=128` : null) };
}
let fetches = 0; let online = 40; let fail = false;
const guilds = [guild('1', 800, { icon: 'abc', features: ['DISCOVERABLE'] }), guild('2', 3000, { icon: 'a_def', features: ['VERIFIED'], tier: 2 }), guild('3', 100), guild('4', 5000, { features: [] })];
const client = {
  guilds: {
    cache: new Map(guilds.map((g) => [g.id, g])),
    fetch: async ({ guild: id, withCounts }) => { fetches += 1; assert.equal(withCounts, true); if (fail) throw new Error('down'); return { approximatePresenceCount: online + Number(id) }; },
  },
};
(async () => {
  const list = await showcase.buildShowcase(client, new Set(['4']), 1_000);
  assert.deepEqual(list.map((s) => s.id), ['2', '1'], 'the small server and the hidden one are left out');
  assert.equal(list[0].icon, 'https://cdn.discordapp.com/icons/2/a_def.gif?size=128', 'an animated icon is a GIF');
  assert.equal(list[0].animated, true);
  assert.equal(list[1].animated, false);
  assert.ok(list[1].icon.endsWith('.png?size=128'));
  assert.deepEqual(list[0].badges, ['verified']);
  assert.equal(list[0].boost, 2, 'the boost level');
  assert.equal(list[1].boost, 0, 'no boost, no mark');
  assert.deepEqual([list[0].members, list[0].online], [3000, 42]);
  assert.equal(fetches, 2);

  online = 100; // the numbers change, but within five minutes they are not asked again
  const again = await showcase.buildShowcase(client, new Set(['4']), 1_000 + 4 * 60_000);
  assert.equal(fetches, 2, 'not asked again within five minutes');
  assert.equal(again[0].online, 42);

  fail = true; // after five minutes Discord does not answer: the last number stays
  const kept = await showcase.buildShowcase(client, new Set(['4']), 1_000 + 6 * 60_000);
  assert.equal(kept[0].online, 42, 'the last known number stays when Discord does not answer');

  fail = false;
  const fresh = await showcase.buildShowcase(client, new Set(['4']), 1_000 + 12 * 60_000);
  assert.equal(fresh[0].online, 102, 'and it is read again when it answers');

  // A server that is not in the list any more is forgotten, and a server without an icon has none.
  client.guilds.cache.delete('2');
  const left = await showcase.buildShowcase(client, new Set(), 1_000 + 12 * 60_000 + 1);
  assert.deepEqual(left.map((s) => s.id), ['4', '1']);
  assert.equal(left[0].icon, null);
  console.log('Checked the carousel of servers: who shows, the order, the limit, the bigger one that comes in, the icons, the marks and the online members.');
})().catch((error) => { console.error(error); process.exit(1); });
