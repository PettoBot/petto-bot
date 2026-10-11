const { checkRollouts, drainQueue } = require('../utils/rolloutAlerts');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

// The list is a community file on GitHub: it is asked every 10 minutes, with an ETag so most answers are empty. What it finds goes in a queue
// that a second job empties a little at a time (one message per server every 6 seconds), so a big day never sends a burst.
const POLL_INTERVAL_MS = 10 * 60_000;
const DRAIN_INTERVAL_MS = 6_000;
const FIRST_RUN_DELAY_MS = 90_000;

function startRolloutAlertsJob(client) {
  const check = exclusiveTask(() => checkRollouts(client));
  const drain = exclusiveTask(() => drainQueue(client));
  const tickCheck = () => check().catch((error) => logger.warn(`Rollout alerts job: ${error.message}`));
  const tickDrain = () => drain().catch((error) => logger.warn(`Rollout queue: ${error.message}`));
  setTimeout(tickCheck, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(tickCheck, POLL_INTERVAL_MS).unref?.();
  setInterval(tickDrain, DRAIN_INTERVAL_MS).unref?.();
  logger.info('Rollout alerts job started (reads every 10 minutes, sends from the queue every 6 seconds).');
}

module.exports = { startRolloutAlertsJob };
