const { checkQuests } = require('../utils/questAlerts');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

// The quest sources are public community services, so they are asked gently: every 5 minutes, with an ETag so most answers are empty.
const POLL_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

function startQuestAlertsJob(client) {
  const run = exclusiveTask(() => checkQuests(client));
  const tick = () => run().catch((error) => logger.warn(`Quest alerts job: ${error.message}`));
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Quest alerts job started (every 5 minutes).');
}

module.exports = { startQuestAlertsJob };
