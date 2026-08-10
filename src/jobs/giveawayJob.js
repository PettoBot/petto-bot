const giveawaysDb = require('../db/giveaways');
const { endGiveaway, handleForfeit, refreshGiveawayMessage } = require('../utils/giveawayEngine');
const logger = require('../utils/logger');

// Giveaway timing matters more to users than most background jobs (an "ends in 5s" giveaway
// shouldn't actually end 55s late), so this polls tighter than Petto's other 60s jobs — matching
// bli's own 15s giveaway poll interval.
const POLL_INTERVAL_MS = 15_000;

async function processDueGiveaways(client) {
  const due = await giveawaysDb.listDueGiveaways();
  for (const giveaway of due) {
    try {
      await endGiveaway(client, giveaway);
    } catch (err) {
      logger.error(`Failed to end giveaway #${giveaway.id}:`, err);
    }
  }
}

async function processExpiredClaims(client) {
  const expired = await giveawaysDb.listExpiredClaims();
  for (const winnerRow of expired) {
    try {
      await handleForfeit(client, winnerRow, 'expired');
    } catch (err) {
      logger.error(`Failed to expire giveaway claim #${winnerRow.id}:`, err);
    }
  }
}

/** Repairs active giveaway panels once after startup, including counters from entries made before a restart. */
async function refreshActiveGiveaways(client) {
  for (const guild of client.guilds.cache.values()) {
    const active = await giveawaysDb.listActiveForGuild(guild.id).catch((err) => {
      logger.error(`Failed to load active giveaways for ${guild.id}:`, err);
      return [];
    });

    for (const giveaway of active) {
      const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
      if (!channel) continue;
      await refreshGiveawayMessage(channel, giveaway).catch((err) => logger.error(`Failed to refresh giveaway #${giveaway.id}:`, err));
    }
  }
}

function startGiveawayJob(client) {
  refreshActiveGiveaways(client).catch((err) => logger.error('Giveaway panel repair error:', err));
  setInterval(() => {
    processDueGiveaways(client).catch((err) => logger.error('Giveaway end job error:', err));
    processExpiredClaims(client).catch((err) => logger.error('Giveaway claim expiry job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Giveaway job started (checking every 15s).');
}

module.exports = { startGiveawayJob, processDueGiveaways, processExpiredClaims, refreshActiveGiveaways };
