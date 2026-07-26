const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const { processBulkRoleJob } = require('../utils/bulkRoleEngine');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 10_000;

// A job can take minutes for a large server (member-by-member, paced by Discord's own rate
// limit), so this tracks which guilds are already mid-run in memory to avoid the next poll
// tick picking the same pending row up a second time before it's marked 'running'.
const runningGuildIds = new Set();

async function pickUpPendingJobs(client) {
  const pending = await bulkRoleJobsDb.listPending();
  for (const job of pending) {
    if (runningGuildIds.has(job.guild_id)) continue;
    runningGuildIds.add(job.guild_id);
    processBulkRoleJob(client, job)
      .catch((err) => logger.error(`Bulk role job #${job.id} crashed:`, err))
      .finally(() => runningGuildIds.delete(job.guild_id));
  }
}

function startBulkRoleJob(client) {
  setInterval(() => {
    pickUpPendingJobs(client).catch((err) => logger.error('Bulk role job poll error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Bulk role job started (checking every 10s).');
}

module.exports = { startBulkRoleJob };
