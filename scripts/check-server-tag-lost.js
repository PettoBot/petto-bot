// A server that loses the improvement that allows a Server Tag keeps the roles it gave for showing the tag, because no event comes for each member. The rules about its own tag
// (`is_guild_id` with its id) must match nobody while it cannot have the tag, so the engine takes those roles away, and a change of the server (and a look every few hours)
// checks everybody again. Discord, the database and the sync are replaced where needed; the rules of the comparison are the real ones.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const logs = [];
stub('src/utils/logger.js', { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]), debug() {} });
let ownRules = [{ id: 'r1', enabled: true, condition: 'is_guild_id', value: '900', role_id: 'role' }];
stub('src/db/identity.js', { listGuildTagRules: async () => ownRules, listVanityRules: async () => [], hasActiveRules: async () => true });
const syncCalls = [];
class SyncError extends Error {}
let syncOutcome = 'ok';
stub('src/utils/identity/sync.js', { SyncError, syncGuild: async (guild, options) => { syncCalls.push([guild.id, options]); if (syncOutcome === 'running') throw new SyncError('running'); if (syncOutcome === 'boom') throw new Error('boom'); return { added: 0, removed: 3 }; } });
const { matchGuildTag } = require('../src/utils/identity/compare');
const service = require('../src/utils/identity/service');
const { recheckServerTag } = require('../src/utils/identity/serverTagWatch');
const event = require('../src/events/guildUpdateServerTag');
const { lookOnce } = require('../src/jobs/serverTagCheckJob');

const withTags = (id) => ({ id, features: ['COMMUNITY', 'GUILD_TAGS'] });
const withoutTags = (id) => ({ id, features: ['COMMUNITY'] });

(async () => {
  // Whether the server can have the tag: the feature, and yes when it is not known.
  assert.equal(service.serverTagsAvailable(withTags('900')), true);
  assert.equal(service.serverTagsAvailable(withoutTags('900')), false);
  assert.equal(service.serverTagsAvailable({ id: '900' }), true, 'features unknown: nothing is taken away on a guess');
  assert.equal(service.serverTagsAvailable(null), true);

  // Only the rules about the server's own tag are marked, and only while it cannot have the tag.
  const own = { id: 'r1', condition: 'is_guild_id', value: '900' };
  const other = { id: 'r2', condition: 'is_guild_id', value: '123' };
  const enabled = { id: 'r3', condition: 'identity_enabled', value: '' };
  const rules = { vanity: null, guildtag: [own, other, enabled] };
  assert.equal(service.withServerTagState(rules, withTags('900')), rules, 'with the improvement nothing changes');
  const lost = service.withServerTagState(rules, withoutTags('900'));
  assert.deepEqual(lost.guildtag.map((rule) => Boolean(rule.tagUnavailable)), [true, false, false], 'only its own tag rule');
  assert.equal(rules.guildtag[0].tagUnavailable, undefined, 'the rules are not changed in place');
  assert.equal(service.withServerTagState({ vanity: [], guildtag: null }, withoutTags('900')).guildtag, null);

  // The comparison: a member who shows the tag matches until the server loses the improvement; the rules about other servers' tags are not touched.
  const primary = { identityGuildId: '900', identityEnabled: true, tag: 'DUCK' };
  assert.equal(matchGuildTag(own, primary), true);
  assert.equal(matchGuildTag(lost.guildtag[0], primary), false, 'the server lost the tag: nobody matches, so the role goes');
  assert.equal(matchGuildTag(lost.guildtag[1], { identityGuildId: '123', identityEnabled: true, tag: 'X' }), true, 'a rule about another server is as it was');
  assert.equal(matchGuildTag(own, primary), true, 'and it returns with the improvement');

  // The server changes: it lost the improvement, gained it, or something else changed.
  syncCalls.length = 0;
  await event.execute(withTags('900'), withoutTags('900'));
  assert.deepEqual(syncCalls.map((c) => [c[0], c[1].source]), [['900', 'guildtag']], 'losing the improvement checks everybody again (only the tag rules)');
  await event.execute(withoutTags('900'), withTags('900'));
  assert.equal(syncCalls.length, 2, 'and so does gaining it: the roles come back');
  await event.execute(withTags('900'), { id: '900', features: ['COMMUNITY', 'GUILD_TAGS', 'NEWS'] });
  assert.equal(syncCalls.length, 2, 'another change of the server does nothing');
  await event.execute(null, withTags('900'));
  assert.equal(syncCalls.length, 2);

  // A server with no rule about its own tag is left alone, and a failing or running sync never throws.
  ownRules = [{ id: 'r2', enabled: true, condition: 'is_guild_id', value: '123', role_id: 'role' }];
  assert.equal(await recheckServerTag(withoutTags('900'), 'test'), false);
  assert.equal(syncCalls.length, 2, 'no own-tag rule: no sync');
  ownRules = [{ id: 'r1', enabled: true, condition: 'is_guild_id', value: '900', role_id: 'role' }];
  syncOutcome = 'running';
  assert.equal(await recheckServerTag(withoutTags('900'), 'test'), false, 'a sync already running is fine');
  syncOutcome = 'boom';
  assert.equal(await recheckServerTag(withoutTags('900'), 'test'), false, 'a failing sync is logged, not thrown');
  assert.ok(logs.some((l) => l[0] === 'warn' && /could not check/.test(l[1])));
  syncOutcome = 'ok';

  // The look every few hours: only the servers without the improvement.
  syncCalls.length = 0;
  const guilds = new Map([['1', withTags('1')], ['900', withoutTags('900')], ['2', withoutTags('2')]]);
  ownRules = [{ id: 'r1', enabled: true, condition: 'is_guild_id', value: '900', role_id: 'role' }];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, Math.min(ms, 5), ...args); // the pause between servers is short here
  await lookOnce({ guilds: { cache: guilds } });
  global.setTimeout = originalSetTimeout;
  assert.deepEqual(syncCalls.map((c) => c[0]), ['900'], 'the server that has the tag is skipped, the one without a rule is not synced');

  console.log('Checked the Server Tag that is lost: the improvement, the own-tag rules, the comparison, the change of the server, the look and the failures.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
