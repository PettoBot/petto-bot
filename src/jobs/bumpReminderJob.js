const { checkBumpReminders } = require('../utils/bumpHandler');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 60_000;

function startBumpReminderJob(client) {
  setInterval(() => {
    checkBumpReminders(client).catch((err) => logger.error('Bump reminder job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Bump reminder job started (checking every 60s).');
}

module.exports = { startBumpReminderJob };
