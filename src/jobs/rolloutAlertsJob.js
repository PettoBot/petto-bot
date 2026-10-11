const { checkRollouts } = require('../utils/rolloutAlerts');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

// The list is a community file on GitHub: it is asked every 10 minutes, with an ETag so most answers are empty.
const POLL_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 90_000;

function startRolloutAlertsJob(client) {
  const run = exclusiveTask(() => checkRollouts(client));
  const tick = () => run().catch((error) => logger.warn(`Rollout alerts job: ${error.message}`));
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Rollout alerts job started (every 10 minutes).');
}

module.exports = { startRolloutAlertsJob };
