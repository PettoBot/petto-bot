// What Petto stored for a server it is no longer in is deleted a few minutes after it left (5 at most): the date it left is kept in guild_departures,
// and a server that adds Petto again before that keeps everything. All of it goes, with no exceptions. See db/guildDepartures.js for the tables that are not the server's.
const departures = require('../db/guildDepartures');
const config = require('../config');
const logger = require('../utils/logger');
const botTotals = require('../utils/botTotals');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60_000; // every minute, so what is due goes at most a minute after its wait (config.guildPurgeMinutes), 5 minutes in all
const FIRST_MS = 2 * 60_000; // not at start: the list of servers must be loaded first
const PER_RUN = 25; // servers deleted before a short rest, so a big backlog does not keep the database busy
const PASS_MAX = 100; // servers deleted in one pass (the next pass is in a minute)
const REST_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOADED_SHARE = 0.9; // the list of servers of the bot must have at least this share of the servers Discord says the bot is in, or it is not trusted (an outage, not people leaving)

/** One pass. Returns { noted, erased, would } (`would`: the servers a dry run would have deleted). */
async function purgeLeftGuilds(client) {
  const result = { noted: 0, erased: 0, would: 0 };
  // Nothing is decided while the bot is not ready or the list of its servers is empty: that looks like a bot that has not loaded them yet.
  if (!config.guildPurge || !client.isReady?.() || !client.guilds.cache.size) return result;

  // With the shards split between instances this process only has the servers of its own shards in memory: the others are known from the copies that their instances save
  // (an instance removes the copy of a server it leaves). A server counts as present when it is in this process or in that list; and with the list unreadable nothing is decided.
  const split = botTotals.isSplit();
  let elsewhere = new Set();
  let savedCopies = null; // how many servers the saved copies name (only read when the bot is split), for the warning below
  if (split) {
    try { elsewhere = await botTotals.readAllGuildIds(); } catch (error) { logger.warn(`Servers cleanup skipped: the saved list of servers could not be read: ${error.message}`); return result; }
    savedCopies = elsewhere.size;
    for (const guild of client.guilds.cache.values()) elsewhere.add(String(guild.id)); // a server that just joined may not have its copy yet
  }
  const isHere = (id) => client.guilds.cache.has(id) || elsewhere.has(String(id));
  const loaded = split ? elsewhere.size : client.guilds.cache.size;

  // Discord says how many servers the bot is in: when the list the bot has is clearly shorter, some servers have not loaded and nobody left.
  const expected = Number((await client.application?.fetch?.().catch(() => null))?.approximateGuildCount) || 0;
  // Split between instances the loaded list is the whole of the bot, so without Discord's number there is nothing to check it against: nothing is decided.
  if (split && !expected) {
    logger.warn('Servers cleanup skipped: Discord did not say how many servers the bot is in, so the list of the whole bot cannot be checked.');
    return result;
  }
  if (expected && loaded < expected * LOADED_SHARE) {
    logger.warn(`Servers cleanup skipped: the bot has ${loaded} servers loaded and Discord says it is in about ${expected}. (${split ? `split between instances; this process holds ${client.guilds.cache.size} and the saved copies name ${savedCopies}` : `not split; this process holds ${client.guilds.cache.size}`}.)`);
    return result;
  }
  const known = await departures.knownGuilds();
  const present = known.filter((id) => isHere(id));
  const missing = known.filter((id) => !isHere(id));
  await departures.sync(missing, present);
  result.noted = missing.length;

  const state = await departures.counts(config.guildPurgeMinutes);
  let done = 0;
  for (const guildId of await departures.due(config.guildPurgeMinutes, PASS_MAX)) {
    if (isHere(guildId)) { await departures.clear(guildId); continue; } // it came back in the meantime
    if (config.guildPurgeDryRun) { result.would += 1; logger.info(`Servers cleanup (dry run): would delete what is stored for server ${guildId}.`); continue; }
    try {
      await departures.erase(guildId);
      result.erased += 1;
    } catch (error) {
      logger.warn(`Servers cleanup: could not delete the data of server ${guildId}: ${error.message}`);
    }
    done += 1;
    if (done % PER_RUN === 0) await sleep(REST_MS);
  }
  // Quiet when nothing happened, since it runs every minute.
  if (state.waiting || state.due || result.erased || result.would) {
    logger.info(`Servers cleanup: ${state.waiting} left less than ${config.guildPurgeMinutes} minutes ago and wait, ${state.due} were due, ${config.guildPurgeDryRun ? `${result.would} would be deleted (dry run)` : `${result.erased} deleted`}.`); // i18n-ignore: text of the operator log, not shown to members
  }
  return result;
}

function startGuildPurgeJob(client) {
  const run = exclusiveTask(() => purgeLeftGuilds(client));
  const tick = () => run().catch((error) => logger.warn(`Servers cleanup failed: ${error.message}`));
  setTimeout(tick, FIRST_MS).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startGuildPurgeJob, purgeLeftGuilds };
