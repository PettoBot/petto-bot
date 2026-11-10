// Checks that Petto does not ask Discord for what Discord already said to wait a long time on: the route is remembered per server for as long as Discord said, a short wait
// or a global one is not, and the invites and the vanity URL of a joining member are not asked while it lasts.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const perf = require('../src/utils/perf');
const inviteCache = require('../src/utils/inviteCache');
const { wasVanityJoin } = require('../src/utils/inviteResolve');

const GUILD = '1148061133756964964';
const OTHER = '1148061133756964965';
const family = perf.routeFamily('GET', `/guilds/${GUILD}/vanity-url`);
assert.equal(family, 'GET /guilds/:id/vanity-url');
assert.equal(perf.majorOf(`https://discord.com/api/v10/guilds/${GUILD}/vanity-url`), GUILD);
assert.equal(perf.majorOf('/users/@me'), null);

perf.recordRateLimit({ family, waitMs: 2_703_000, major: GUILD, source: 'discord' });
const left = perf.routeBlockedMs('GET', `/guilds/${GUILD}/vanity-url`, GUILD);
assert.ok(left > 2_600_000 && left <= 2_703_000, 'the wait Discord said, for that server');
assert.equal(perf.routeBlockedMs('GET', `/guilds/${OTHER}/vanity-url`, OTHER), 0, 'another server is not blocked');
assert.equal(perf.routeBlockedMs('GET', `/guilds/${GUILD}/invites`, GUILD), 0, 'another route of the same server is not blocked');
perf.recordRateLimit({ family: 'GET /guilds/:id/invites', waitMs: 2_000, major: GUILD });
assert.equal(perf.routeBlockedMs('GET', `/guilds/${GUILD}/invites`, GUILD), 0, 'a short wait is not remembered');
perf.recordRateLimit({ family: 'GET /guilds/:id/invites', waitMs: 600_000, major: GUILD, global: true });
assert.equal(perf.routeBlockedMs('GET', `/guilds/${GUILD}/invites`, GUILD), 0, 'a global limit is not a route');
assert.equal(perf.routeBlockedMs('GET', `/guilds/${GUILD}/vanity-url`, GUILD, Date.now() + 2_800_000), 0, 'and it is over when the wait is');

(async () => {
  perf.recordRateLimit({ family, waitMs: 2_703_000, major: GUILD, source: 'discord' }); // the checks above ended it on purpose
  let asked = 0;
  const guild = (id) => ({ id, vanityURLCode: 'petto', fetchVanityData: async () => { asked += 1; return { uses: 5 }; } });
  assert.equal(await wasVanityJoin(guild(GUILD)), false);
  assert.equal(asked, 0, 'the vanity URL is not asked while Discord says to wait');
  await wasVanityJoin(guild(OTHER));
  assert.equal(asked, 1, 'another server still asks');

  perf.recordRateLimit({ family: 'GET /guilds/:id/invites', waitMs: 600_000, major: GUILD });
  let fetched = 0;
  const withInvites = { id: GUILD, members: { me: { permissions: { has: () => true } } }, invites: { fetch: async () => { fetched += 1; return new Map(); } } };
  assert.equal(await inviteCache.fetchInvites(withInvites), null);
  assert.equal(fetched, 0, 'the invites are not asked while Discord says to wait');
  assert.ok(await inviteCache.fetchInvites({ ...withInvites, id: OTHER }), 'another server still asks');
  assert.equal(fetched, 1);
  console.log('Route block checks passed (the vanity URL and the invites of a server Discord limited are not asked).');
})();
