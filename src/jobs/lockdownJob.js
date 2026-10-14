// Ends the lockdowns whose time is up.
const db = require('../db/lockdown');
const { endLockdown } = require('../utils/lockdown');
const { exclusiveTask } = require('../utils/concurrency');
const logger = require('../utils/logger');

async function checkLockdowns(client) {
  const due = await db.listDue(new Date().toISOString());
  for (const row of due) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    await endLockdown(guild).catch((err) => logger.warn(`Lockdown job: could not end the lockdown of ${row.guild_id}: ${err.message}`));
  }
}

function startLockdownJob(client) {
  const run = exclusiveTask(() => checkLockdowns(client));
  setInterval(() => run().catch((err) => logger.error('Lockdown job error:', err)), 60_000).unref?.();
}

module.exports = { startLockdownJob, checkLockdowns };
