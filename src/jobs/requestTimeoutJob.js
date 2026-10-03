const { unclaimLate } = require('../utils/requestTimeouts');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 90_000;

function startRequestTimeoutJob(client) {
  const run = exclusiveTask(() => unclaimLate(client));
  const tick = () => run().catch((error) => logger.warn(`Request timeout job: ${error.message}`));
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Request timeout job started (every 10 minutes).');
}

module.exports = { startRequestTimeoutJob };
