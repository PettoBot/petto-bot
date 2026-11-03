const { checkBumpReminders, armUpcomingReminders } = require('../utils/bumpHandler');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

function startBumpReminderJob(client) {
  const run = exclusiveTask(() => checkBumpReminders(client));
  // Every reminder that is waiting gets an exact timer now (they go out at the minute they are due); what was due while the bot was off goes out at once.
  armUpcomingReminders(client).catch((err) => logger.error('Bump reminder timers could not be armed:', err));
  run().catch((err) => logger.error('Bump reminder job error:', err));
  // The safety net: a look at the table once in a while, for a timer that was lost.
  setInterval(() => run().catch((err) => logger.error('Bump reminder job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Bump reminder job started (exact timers, and a look every 60s as the safety net).');
}

module.exports = { startBumpReminderJob };
