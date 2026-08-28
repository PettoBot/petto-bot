const { checkBumpReminders } = require('../utils/bumpHandler');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

function startBumpReminderJob(client) {
  const run = exclusiveTask(() => checkBumpReminders(client));
  setInterval(() => run().catch((err) => logger.error('Bump reminder job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Bump reminder job started (checking every 60s).');
}

module.exports = { startBumpReminderJob };
