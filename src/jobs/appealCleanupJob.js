// Deletes the resolved appeals that were kept longer than each server asked.
const { cleanup } = require('../utils/appeals');
const { exclusiveTask } = require('../utils/concurrency');
const logger = require('../utils/logger');

function startAppealCleanupJob() {
  const run = exclusiveTask(async () => {
    const removed = await cleanup();
    if (removed) logger.info(`Appeals: removed ${removed} old resolved submission(s).`);
  });
  setInterval(() => run().catch((err) => logger.error('Appeal cleanup error:', err)), 6 * 60 * 60 * 1000).unref?.();
}

module.exports = { startAppealCleanupJob };
