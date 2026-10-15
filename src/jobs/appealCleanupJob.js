// Deletes the resolved appeals that were kept longer than each server asked, and frees the link names nobody uses.
const { cleanup, releaseIdleNames } = require('../utils/appeals');
const { exclusiveTask } = require('../utils/concurrency');
const logger = require('../utils/logger');

function startAppealCleanupJob(client) {
  const run = exclusiveTask(async () => {
    const removed = await cleanup();
    if (removed) logger.info(`Appeals: removed ${removed} old resolved submission(s).`);
    const freed = await releaseIdleNames(client);
    if (freed.length) logger.info(`Appeals: released ${freed.length} unused link name(s): ${freed.map((n) => `${n.slug} (${n.reason})`).join(', ')}.`);
  });
  setInterval(() => run().catch((err) => logger.error('Appeal cleanup error:', err)), 6 * 60 * 60 * 1000).unref?.();
}

module.exports = { startAppealCleanupJob };
