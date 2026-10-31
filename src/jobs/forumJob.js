// Forum support: once a minute, the posts that are due to be locked or closed (quiet for days, solved for hours, still without a tag). The
// database answers from an index with a few rows at most, so the minute costs one small query per kind.
const { runForumJob } = require('../utils/forumAutomation');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

function startForumJob(client) {
  const run = exclusiveTask(async () => {
    const done = await runForumJob(client);
    const total = done.quiet + done.solved + done.tag;
    if (total) logger.info(`Forums: ${done.quiet} quiet, ${done.solved} solved and ${done.tag} untagged post(s) were locked or closed.`);
  });
  setTimeout(() => run().catch((error) => logger.error('Forum job error:', error)), 90_000).unref?.();
  setInterval(() => run().catch((error) => logger.error('Forum job error:', error)), POLL_INTERVAL_MS).unref?.();
  logger.info('Forum job started (checking every minute).');
}

module.exports = { startForumJob };
