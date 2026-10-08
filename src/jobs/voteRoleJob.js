const config = require('../config');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const { removeExpiredVoteRoles } = require('../utils/voteRole');

const INTERVAL_MS = 5 * 60 * 1000;

function startVoteRoleJob(client) {
  if (!config.voteRoleId) return;
  const run = exclusiveTask(() => removeExpiredVoteRoles(client));
  const runLogged = () => run().catch((err) => logger.error('Voter role job failed:', err));
  setTimeout(runLogged, 15_000).unref?.();
  setInterval(runLogged, INTERVAL_MS).unref?.();
}

module.exports = { startVoteRoleJob };
