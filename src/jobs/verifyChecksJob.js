// i18n-ignore-file: a background job and its logs
// Keeps what the verification checks need: the list of Tor exit nodes (read when the bot starts and every hour) and the signals of the alt check (the ones older
// than 90 days are deleted).
const torList = require('../utils/torList');
const signals = require('../db/verificationSignals');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60 * 60_000;

/** One pass. `deps` (tests): `refresh`, `purge`. */
async function pass(deps = {}) {
  const refresh = deps.refresh ?? torList.refresh;
  const purge = deps.purge ?? (() => signals.purgeOlderThan());
  const addresses = await refresh();
  const purged = await Promise.resolve(purge()).catch((error) => { logger.warn(`Verification signals could not be cleaned: ${error.message}`); return 0; });
  return { addresses, purged };
}

function startVerifyChecksJob() {
  const run = exclusiveTask(async () => {
    const { addresses, purged } = await pass();
    if (addresses) logger.info(`Verification: ${addresses} Tor exit addresses read.`);
    if (purged) logger.info(`Verification: ${purged} old signal(s) deleted.`);
  });
  const tick = () => run().catch((error) => logger.error('Verification checks job failed:', error));
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startVerifyChecksJob, pass };
