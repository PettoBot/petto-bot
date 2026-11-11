// Closes the periods of the role quotas that are over (utils/roleQuotas.js `runDueRules`): judges the members, takes the role from who reached the strikes and tells them.
const { runDueRules, flush } = require('../utils/roleQuotas');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 5 * 60_000;

function startRoleQuotaJob(client) {
  const run = exclusiveTask(async () => {
    await flush(); // what was counted a moment ago is in the database before a period is closed
    await runDueRules(client);
  });
  setTimeout(() => run().catch((err) => logger.error('Role quota job error:', err)), 90_000).unref?.();
  setInterval(() => run().catch((err) => logger.error('Role quota job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Role quota job started (looking every 5 minutes for periods that are over).');
}

module.exports = { startRoleQuotaJob };
