// Forms: once a day the answers of reviewed submissions older than each server's retention (30 days by default) are removed, leaving
// a small row (form, member, state, reviewer, dates and the link to its card). Pending submissions are never touched.
const formsDb = require('../db/forms');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 24 * 60 * 60_000;

async function compactAll() {
  const own = await formsDb.listRetentionConfigs();
  let total = 0;
  for (const row of own) total += await formsDb.compactBefore(row.retention_days, { guildId: row.guild_id }).catch(() => 0);
  total += await formsDb.compactBefore(formsDb.RETENTION_DEFAULT, { except: own.map((row) => row.guild_id) });
  return total;
}

function startFormCleanupJob() {
  const run = exclusiveTask(async () => {
    const removed = await compactAll();
    if (removed) logger.info(`Forms: removed the answers of ${removed} reviewed submission(s) past their retention.`);
  });
  const tick = () => run().catch((error) => logger.error('Forms cleanup job failed:', error));
  setTimeout(tick, 5 * 60_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startFormCleanupJob, compactAll };
