// Checks that a dashboard request from someone who is not in the server (a developer's read-only view) is "no access", not an error:
// Unknown Member / Unknown User give null without logging, the answer is remembered for a minute, and other errors still throw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fetchDashboardMember, isNotMemberError, NEGATIVE_TTL_MS } = require('../src/web/dashboardMember');

function discordError(code, status = 404) {
  return Object.assign(new Error(code === 10007 ? 'Unknown Member' : 'Unknown User'), { code, status, method: 'GET' });
}
function fakeGuild(id, answer) {
  const guild = { id, calls: 0, members: { fetch: async (userId) => { guild.calls += 1; return answer(userId); } } };
  return guild;
}

(async () => {
  assert.equal(isNotMemberError(discordError(10007)), true);
  assert.equal(isNotMemberError(discordError(10013)), true);
  assert.equal(isNotMemberError(discordError(10004)), false);
  assert.equal(isNotMemberError(new Error('boom')), false);
  assert.equal(isNotMemberError(null), false);

  // A member is returned, and asked again each time (only the negative answer is remembered).
  const member = { id: '200000000000000001', permissions: { has: () => true } };
  const g1 = fakeGuild('100000000000000001', () => member);
  assert.equal(await fetchDashboardMember(g1, member.id), member);
  assert.equal(await fetchDashboardMember(g1, member.id), member);
  assert.equal(g1.calls, 2);

  // A member already in the cache of discord.js is used without asking Discord.
  const g0 = fakeGuild('100000000000000009', () => { throw new Error('not asked'); });
  g0.members.cache = new Map([[member.id, member]]);
  assert.equal(await fetchDashboardMember(g0, member.id), member);
  assert.equal(g0.calls, 0);

  // Unknown Member: null, and Discord is not asked again inside the minute; after it, it is.
  const now = 1_000_000;
  const g2 = fakeGuild('100000000000000002', () => { throw discordError(10007); });
  assert.equal(await fetchDashboardMember(g2, '200000000000000002', now), null);
  assert.equal(await fetchDashboardMember(g2, '200000000000000002', now + 1_000), null);
  assert.equal(await fetchDashboardMember(g2, '200000000000000002', now + NEGATIVE_TTL_MS - 1), null);
  assert.equal(g2.calls, 1);
  assert.equal(await fetchDashboardMember(g2, '200000000000000002', now + NEGATIVE_TTL_MS + 1), null);
  assert.equal(g2.calls, 2);
  // Another user in the same server is asked separately.
  assert.equal(await fetchDashboardMember(g2, '200000000000000003', now), null);
  assert.equal(g2.calls, 3);
  assert.ok(NEGATIVE_TTL_MS >= 30_000 && NEGATIVE_TTL_MS <= 120_000);

  // Unknown User too.
  const g3 = fakeGuild('100000000000000003', () => { throw discordError(10013); });
  assert.equal(await fetchDashboardMember(g3, '200000000000000004', now), null);

  // Any other failure is still an error for the caller (and is not cached).
  const g4 = fakeGuild('100000000000000004', () => { throw discordError(0, 500); });
  await assert.rejects(fetchDashboardMember(g4, '200000000000000005', now));
  await assert.rejects(fetchDashboardMember(g4, '200000000000000005', now));
  assert.equal(g4.calls, 2);

  // Both access checks of the dashboard API go through it and treat a missing member as no access.
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.js'), 'utf8');
  assert.equal((server.match(/await fetchDashboardMember\(guild, userId\)/g) ?? []).length, 2);
  assert.equal((server.match(/canManage = Boolean\(member\) &&/g) ?? []).length, 2);
  assert.doesNotMatch(server, /await guild\.members\.fetch\(userId\);/);

  console.log('dashboard member checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
