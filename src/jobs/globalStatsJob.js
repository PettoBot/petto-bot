// Keeps the numbers of the public stats page fresh: the totals of every server and the ranking of the servers that
// chose to be in it. The page reads one row, so a visit never sums the activity of every server.
const globalStatsDb = require('../db/globalStats');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60_000;
const USERS_EVERY_MS = 10 * 60_000; // adding up every member is heavier than the rest, so it is not done every minute
const HISTORY_EVERY_MS = 10 * 60_000; // the daily history is added up from the activity of the last 120 days, so it is not done every minute either
let usersAt = 0;
let historyAt = -Infinity;
let usersCache = [];

async function refreshGlobalStats(client, now = new Date()) {
  const [totals, ranked] = await Promise.all([globalStatsDb.readTotals(), globalStatsDb.readRankedServers()]);
  if (Date.now() - usersAt >= USERS_EVERY_MS) { usersCache = await globalStatsDb.readRankedUsers(); usersAt = Date.now(); }
  const rankedUsers = usersCache;
  const describe = (id) => {
    const guild = client.guilds.cache.get(id);
    return guild ? { name: guild.name, icon: guild.iconURL({ extension: 'png', size: 64 }), members: guild.memberCount ?? null } : null;
  };
  // Only the people who would show are looked up, and the ones the bot has seen come from its cache.
  const top = new Set(['messages', 'voiceSeconds'].flatMap((metric) => [...rankedUsers].sort((a, b) => b[metric] - a[metric]).slice(0, globalStatsDb.USER_RANK_SIZE + 5).map((user) => user.id)));
  const people = new Map();
  for (const id of top) {
    const user = client.users.cache.get(id) ?? await client.users.fetch(id).catch(() => null);
    if (user) people.set(id, { name: user.globalName || user.username, avatar: user.displayAvatarURL({ extension: 'png', size: 64 }) });
  }
  const servers = client.guilds.cache.size;
  // The members of every server the bot is in, for the link preview of the website ("servers and members"). Counted from the cache, so it costs nothing.
  const members = [...client.guilds.cache.values()].reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0);
  await globalStatsDb.saveSnapshot({
    totals,
    rates: globalStatsDb.buildRates(totals.today),
    ranking: globalStatsDb.buildRanking(ranked, describe),
    users: globalStatsDb.buildUserRanking(rankedUsers, (id) => people.get(id) ?? null),
    servers,
    members,
  });
  // The daily history (row `history`) goes after `main`, at most every 10 minutes, and a failure of it never leaves `main` unsaved. It runs inside
  // this same tick, so the load guard that pauses the tick pauses it too.
  if (now.getTime() - historyAt >= HISTORY_EVERY_MS) {
    try {
      const saved = await globalStatsDb.refreshHistory({ now, totalsToday: totals.today, servers, members, cache: client.guilds.cache });
      if (saved) historyAt = now.getTime();
    } catch (error) {
      logger.warn(`Global stats history failed (it is tried again on the next run): ${error.message}`);
    }
  }
}

function startGlobalStatsJob(client) {
  const run = exclusiveTask(() => refreshGlobalStats(client));
  const tick = () => run().catch((error) => logger.error('Global stats job failed:', error));
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
  logger.info('Global stats job started (every 60s).');
}

/** Forgets the saved member ranking and the time of the last history so the next run reads them again (used by the checks). */
function resetUsersCache() { usersAt = 0; usersCache = []; historyAt = -Infinity; }

module.exports = { startGlobalStatsJob, refreshGlobalStats, resetUsersCache };
