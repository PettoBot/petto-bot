const { serverTagsAvailable } = require('../utils/identity/service');
const { recheckServerTag } = require('../utils/identity/serverTagWatch');
const logger = require('../utils/logger');

const FIRST_LOOK_MS = 90_000; // after the start, once the cache is full
const EVERY_MS = 6 * 60 * 60_000; // and now and then, for a change the event did not bring (a restart in the middle, a missed event)
const GAP_MS = 2_000; // between servers: a check reads the members of the server

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks again the servers that cannot have a Server Tag right now and have a rule about their own tag: the roles of those rules must not stay. */
async function lookOnce(client) {
  let checked = 0;
  for (const guild of client.guilds.cache.values()) {
    if (serverTagsAvailable(guild)) continue;
    if (await recheckServerTag(guild, 'periodic look')) { checked += 1; await sleep(GAP_MS); }
  }
  if (checked) logger.info(`Server Tag look: ${checked} server(s) without the improvement checked.`); // i18n-ignore: a log line for the operator
}

function startServerTagCheckJob(client) {
  const run = () => lookOnce(client).catch((error) => logger.warn(`Server Tag look failed: ${error.message}`)); // i18n-ignore: a log line for the operator
  setTimeout(run, FIRST_LOOK_MS).unref?.();
  setInterval(run, EVERY_MS).unref?.();
}

module.exports = { startServerTagCheckJob, lookOnce };
