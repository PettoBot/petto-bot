const { checkQuests } = require('../utils/questAlerts');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

// The quests API is a community service, so it is asked rarely: every 10 minutes, and with an ETag so most answers are empty.
const POLL_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

function startQuestAlertsJob(client) {
  const run = exclusiveTask(() => checkQuests(client));
  const tick = () => run().catch((error) => logger.warn(`Quest alerts job: ${error.message}`));
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Quest alerts job started (every 10 minutes).');
}

module.exports = { startQuestAlertsJob };
