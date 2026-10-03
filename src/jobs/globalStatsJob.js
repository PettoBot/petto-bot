// Keeps the numbers of the public stats page fresh: the totals of every server and the ranking of the servers that
// chose to be in it. The page reads one row, so a visit never sums the activity of every server.
const globalStatsDb = require('../db/globalStats');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60_000;

async function refreshGlobalStats(client) {
  const [totals, ranked] = await Promise.all([globalStatsDb.readTotals(), globalStatsDb.readRankedServers()]);
  const describe = (id) => {
    const guild = client.guilds.cache.get(id);
    return guild ? { name: guild.name, icon: guild.iconURL({ extension: 'png', size: 64 }) } : null;
  };
  await globalStatsDb.saveSnapshot({
    totals,
    rates: globalStatsDb.buildRates(totals.today),
    ranking: globalStatsDb.buildRanking(ranked, describe),
    servers: client.guilds.cache.size,
  });
}

function startGlobalStatsJob(client) {
  const run = exclusiveTask(() => refreshGlobalStats(client));
  const tick = () => run().catch((error) => logger.error('Global stats job failed:', error));
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
  logger.info('Global stats job started (every 60s).');
}

module.exports = { startGlobalStatsJob, refreshGlobalStats };
