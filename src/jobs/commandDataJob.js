// Removes the stored data of custom commands that has expired.
const commandData = require('../db/commandData');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60 * 60_000;

function startCommandDataJob() {
  const run = exclusiveTask(async () => {
    const removed = await commandData.purgeExpired();
    if (removed) logger.info(`Removed ${removed} expired value(s) stored by custom commands.`);
  });
  const tick = () => run().catch((error) => logger.error('Custom command data job failed:', error));
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startCommandDataJob };
