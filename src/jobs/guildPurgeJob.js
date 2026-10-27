// What Petto stored for a server it is no longer in is deleted a few days after it left: the date it left is kept in guild_departures,
// and a server that adds Petto again before that keeps everything. See db/guildDepartures.js for what stays (Premium in use, backups).
const departures = require('../db/guildDepartures');
const config = require('../config');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 6 * 60 * 60_000;
const PER_RUN = 25; // servers deleted in one pass, so a big backlog does not keep the database busy
const LOADED_SHARE = 0.9; // the list of servers of the bot must have at least this share of the servers Discord says the bot is in, or it is not trusted (an outage, not people leaving)

/** One pass. Returns { noted, erased, held }. */
async function purgeLeftGuilds(client) {
  const result = { noted: 0, erased: 0, held: 0 };
  // Nothing is decided while the bot is not ready or the list of its servers is empty: that looks like a bot that has not loaded them yet.
  if (!config.guildPurge || !client.isReady?.() || !client.guilds.cache.size) return result;

  // Discord says how many servers the bot is in: when the list the bot has is clearly shorter, some servers have not loaded and nobody left.
  const expected = Number((await client.application?.fetch?.().catch(() => null))?.approximateGuildCount) || 0;
  if (expected && client.guilds.cache.size < expected * LOADED_SHARE) {
    logger.warn(`Servers cleanup skipped: the bot has ${client.guilds.cache.size} servers loaded and Discord says it is in about ${expected}.`);
    return result;
  }
  const known = await departures.knownGuilds();
  const present = known.filter((id) => client.guilds.cache.has(id));
  const missing = known.filter((id) => !client.guilds.cache.has(id));
  await departures.sync(missing, present);
  result.noted = missing.length;

  for (const guildId of await departures.due(config.guildPurgeDays, PER_RUN)) {
    if (client.guilds.cache.has(guildId)) { await departures.clear(guildId); continue; } // it came back in the meantime
    const reason = await departures.holdReason(guildId);
    if (reason) { result.held += 1; continue; }
    if (config.guildPurgeDryRun) { logger.info(`Servers cleanup (dry run): would delete what is stored for server ${guildId}.`); continue; }
    try {
      await departures.erase(guildId);
      result.erased += 1;
    } catch (error) {
      logger.warn(`Servers cleanup: could not delete the data of server ${guildId}: ${error.message}`);
    }
  }
  if (result.erased || result.held) logger.info(`Servers cleanup: deleted what was stored for ${result.erased} server(s) Petto left more than ${config.guildPurgeDays} days ago${result.held ? `; ${result.held} kept for now (Premium in use or backups)` : ''}.`);
  return result;
}

function startGuildPurgeJob(client) {
  const run = exclusiveTask(() => purgeLeftGuilds(client));
  const tick = () => run().catch((error) => logger.warn(`Servers cleanup failed: ${error.message}`));
  setTimeout(tick, 10 * 60_000).unref?.(); // not at start: the list of servers is surely loaded by then
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startGuildPurgeJob, purgeLeftGuilds };
