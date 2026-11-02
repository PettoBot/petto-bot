const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const { processBulkRoleJob } = require('../utils/bulkRoleEngine');
const { ERROR_CODES } = require('../utils/bulkRolePlan');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 10_000;

// A job can take minutes for a large server (member-by-member, paced by Discord's own rate limit), so this tracks which guilds are already
// mid-run in memory to avoid the next poll tick picking the same pending row up a second time before it's marked 'running'.
const runningGuildIds = new Set();

/** Starts a job in this process, unless that guild already has one running here. Returns true when it was started. */
function runJob(client, job) {
  if (runningGuildIds.has(job.guild_id)) return false;
  runningGuildIds.add(job.guild_id);
  processBulkRoleJob(client, job)
    .catch(async (err) => {
      logger.error(`Bulk role job #${job.id} crashed:`, err);
      // A job that stops this way must not stay `running` for ever: it would keep the server from starting another one.
      await bulkRoleJobsDb.updateJob(job.id, { status: 'failed', error_code: 'crashed', error_message: ERROR_CODES.crashed, finished_at: new Date().toISOString() }).catch(() => {});
    })
    .finally(() => runningGuildIds.delete(job.guild_id));
  return true;
}

async function pickUpPendingJobs(client) {
  const pending = await bulkRoleJobsDb.listPending();
  for (const job of pending) runJob(client, job);
}

function startBulkRoleJob(client) {
  const run = exclusiveTask(() => pickUpPendingJobs(client));
  // A job that was running when the bot stopped goes back to the queue and goes on from the member where it was.
  bulkRoleJobsDb.requeueRunning()
    .then((count) => { if (count) logger.info(`Bulk role jobs: ${count} job(s) cut by the restart go on where they were.`); })
    .catch((err) => logger.warn(`Bulk role jobs: the interrupted ones could not be requeued: ${err.message}`))
    .finally(() => run().catch((err) => logger.error('Bulk role job poll error:', err)));
  setInterval(() => run().catch((err) => logger.error('Bulk role job poll error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Bulk role job started (checking every 10s).');
}

module.exports = { startBulkRoleJob, runJob };
