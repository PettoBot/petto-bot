// Checks the public leaderboard answer: only a server that turned it on answers, the pages and the two kinds (messages and voice),
// the names of members (and the ones who left), the join link and the limits. The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
for (const file of ['src/db/levelUsers.js', 'src/db/database.js']) stub(file, {});
stub('src/utils/dashboardMembers.js', { lookupMembers: async () => ({}) });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const { buildLeaderboard, findConfig, clearCache, PAGE_SIZE, MAX_PAGE } = require('../src/web/publicLeaderboard');

const guild = { id: '123456789012345678', name: 'Petto HQ', memberCount: 42, iconURL: () => 'https://cdn.example/icon.png' };
const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
const config = { guild_id: guild.id, leaderboard_public: true, leaderboard_slug: 'petto-hq', leaderboard_join_url: 'https://discord.gg/abc' };
const asked = [];
const users = {
  getLeaderboardPage: async (guildId, { offset, limit }) => { asked.push(['text', offset, limit]); return [{ user_id: 'u1', xp: 5000, level: 12, messages: 90 }, { user_id: 'gone', xp: 400, level: 3, messages: 10 }]; },
  getVoiceLeaderboardPage: async (guildId, { offset, limit }) => { asked.push(['voice', offset, limit]); return [{ user_id: 'u1', voice_xp: 800, voice_level: 4, vc_minutes: 120 }]; },
  countRanked: async () => 2,
  countVoiceRanked: async () => 1,
};
const deps = { findConfig: async (body) => (body.slug === 'petto-hq' || body.guildId === guild.id ? config : null), users, lookupMembers: async () => ({ u1: { displayName: 'Liam', avatar: 'https://cdn.example/a.png' } }), noCache: true };

(async () => {
  assert.deepEqual(await buildLeaderboard(client, { slug: 'nope' }, deps), { status: 404, error: 'not_found' }, 'a server that is not public does not answer');
  let answer = await buildLeaderboard(client, { slug: 'petto-hq' }, deps);
  assert.equal(answer.ok, true);
  assert.deepEqual([answer.guild.name, answer.guild.joinUrl, answer.guild.slug, answer.total, answer.page, answer.pageSize], ['Petto HQ', 'https://discord.gg/abc', 'petto-hq', 2, 1, PAGE_SIZE]);
  assert.deepEqual(answer.rows.map((row) => [row.rank, row.name, row.level, row.xp, row.inServer]), [[1, 'Liam', 12, 5000, true], [2, null, 3, 400, false]], 'a member who left has no name');
  assert.equal(answer.rows[0].messages, 90);
  answer = await buildLeaderboard(client, { guildId: guild.id, source: 'voice', page: 3 }, deps);
  assert.deepEqual(asked.at(-1), ['voice', 2 * PAGE_SIZE, PAGE_SIZE], 'the page decides where it starts');
  assert.deepEqual([answer.rows[0].xp, answer.rows[0].level, answer.rows[0].voiceMinutes, answer.source], [800, 4, 120, 'voice']);
  await buildLeaderboard(client, { slug: 'petto-hq', page: 9999 }, deps);
  assert.equal(asked.at(-1)[1], (MAX_PAGE - 1) * PAGE_SIZE, 'the pages stop at the top 500');
  // A join link that is not https is left out; a server the bot left does not answer.
  config.leaderboard_join_url = 'javascript:alert(1)';
  assert.equal((await buildLeaderboard(client, { slug: 'petto-hq' }, deps)).guild.joinUrl, null);
  assert.deepEqual(await buildLeaderboard({ guilds: { cache: new Map() } }, { slug: 'petto-hq' }, deps), { status: 404, error: 'not_found' });
  // The name of the server in the address: only letters, numbers and dashes.
  assert.equal(await findConfig({ slug: '../etc' }, { from: () => { throw new Error('must not query'); } }), null);
  clearCache();
  console.log('Checked the public leaderboard: who answers, pages, kinds, names and the join link.');
})().catch((error) => { console.error(error); process.exit(1); });
