const giveawaysDb = require('../db/giveaways');
const { endGiveaway, handleForfeit, refreshGiveawayMessage } = require('../utils/giveawayEngine');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

// Giveaway timing matters more to users than most background jobs (an "ends in 5s" giveaway
// shouldn't actually end 55s late), so this polls tighter than Petto's other 60s jobs — matching
// bli's own 15s giveaway poll interval.
const POLL_INTERVAL_MS = 15_000;

async function processDueGiveaways(client) {
  const due = await giveawaysDb.listDueGiveaways();
  await forEachWithConcurrency(due, async (giveaway) => {
    try {
      await endGiveaway(client, giveaway);
    } catch (err) {
      logger.error(`Failed to end giveaway #${giveaway.id}:`, err);
    }
  }, config.jobConcurrency);
}

async function processExpiredClaims(client) {
  const expired = await giveawaysDb.listExpiredClaims();
  await forEachWithConcurrency(expired, async (winnerRow) => {
    try {
      await handleForfeit(client, winnerRow, 'expired');
    } catch (err) {
      logger.error(`Failed to expire giveaway claim #${winnerRow.id}:`, err);
    }
  }, config.jobConcurrency);
}

/** Repairs active giveaway panels once after startup, including counters from entries made before a restart. */
async function refreshActiveGiveaways(client) {
  const active = await giveawaysDb.listActive();
  await forEachWithConcurrency(active, async (giveaway) => {
    const guild = client.guilds.cache.get(giveaway.guild_id);
    if (!guild) return;
    const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;
    await refreshGiveawayMessage(channel, giveaway).catch((err) => logger.error(`Failed to refresh giveaway #${giveaway.id}:`, err));
  }, config.jobConcurrency);
}

function startGiveawayJob(client) {
  refreshActiveGiveaways(client).catch((err) => logger.error('Giveaway panel repair error:', err));
  const run = exclusiveTask(async () => {
    await processDueGiveaways(client);
    await processExpiredClaims(client);
  });
  setInterval(() => run().catch((err) => logger.error('Giveaway job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Giveaway job started (checking every 15s).');
}

module.exports = { startGiveawayJob, processDueGiveaways, processExpiredClaims, refreshActiveGiveaways };
