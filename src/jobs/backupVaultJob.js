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
  run().catch((err) => logger.error('Vault backup job error:', err));
  setInterval(() => run().catch((err) => logger.error('Vault backup job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Petto Vault scheduled backup job started.');
}

module.exports = { startBackupVaultJob, processDueBackups };
