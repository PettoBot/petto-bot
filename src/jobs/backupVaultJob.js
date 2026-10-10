const { createBackup, recordAudit, vault } = require('../db/backups');
const { buildSnapshot } = require('../commands/config/backup');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

async function processDueBackups(client) {
  if (!vault.isConfigured()) return;
  const schedules = await vault.listDueSchedules();
  await forEachWithConcurrency(schedules, async (schedule) => {
    try {
      const guild = client.guilds.cache.get(schedule.guild_id);
      if (!guild) {
        await vault.advanceSchedule(schedule.guild_id, schedule.interval_hours);
        return;
      }
      const snapshot = buildSnapshot(guild);
      const saved = await createBackup(guild.id, client.user.id, 'Scheduled backup', snapshot, 'scheduled');
      await recordAudit(guild.id, client.user.id, 'backup_created', saved.backup_number, { source: 'scheduled', label: saved.label });
      const pruned = await vault.pruneScheduledBackups(guild.id, schedule.retention_count);
      if (pruned) {
        await recordAudit(guild.id, client.user.id, 'backups_pruned', null, {
          count: pruned,
          retentionCount: schedule.retention_count,
        });
      }
      await vault.advanceSchedule(guild.id, schedule.interval_hours);
      logger.info(`Scheduled Vault backup #${saved.backup_number} created for guild ${guild.id}.`);
    } catch (err) {
      await vault.advanceSchedule(schedule.guild_id, schedule.interval_hours).catch(() => {});
      logger.error(`Scheduled Vault backup failed for guild ${schedule.guild_id}:`, err);
    }
  }, config.jobConcurrency);
}

function startBackupVaultJob(client) {
  if (!vault.isConfigured()) {
    logger.info('Petto Vault is disabled; scheduled backups are not running.');
    return;
  }
  const run = exclusiveTask(() => processDueBackups(client));
  // The job polls every minute. A database connection that times out for a moment is normal and comes back by itself, so it is
  // only reported when it lasts (three ticks in a row); anything else is reported at the first failure. Either way only the first
  // report of an outage is sent, and the recovery.
  const TRANSIENT = /connection (terminated|timeout)|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/i;
  const REPORT_AFTER = 3;
  let failures = 0;
  let reported = false;
  const tick = () => run().then(() => {
    if (reported) logger.info('Vault backup job recovered.');
    failures = 0;
    reported = false;
  }).catch((err) => {
    failures += 1;
    const transient = TRANSIENT.test(String(err?.message ?? err));
    if (reported) return;
    if (transient && failures < REPORT_AFTER) {
      logger.info(`Vault backup job: ${err.message}; trying again in a minute (${failures}/${REPORT_AFTER}).`);
      return;
    }
    reported = true;
    logger.error(`Vault backup job error: ${err?.message ?? err}`, err);
  });
  tick();
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Petto Vault scheduled backup job started.');
}

module.exports = { startBackupVaultJob, processDueBackups };
