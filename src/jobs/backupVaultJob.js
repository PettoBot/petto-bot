const { createBackup, recordAudit, vault } = require('../db/backups');
const { buildSnapshot } = require('../commands/config/backup');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 60_000;

async function processDueBackups(client) {
  if (!vault.isConfigured()) return;
  const schedules = await vault.listDueSchedules();
  for (const schedule of schedules) {
    try {
      const guild = client.guilds.cache.get(schedule.guild_id);
      if (!guild) {
        await vault.advanceSchedule(schedule.guild_id, schedule.interval_hours);
        continue;
      }
      const snapshot = buildSnapshot(guild);
      const saved = await createBackup(guild.id, client.user.id, 'Scheduled backup', snapshot, 'scheduled');
      await recordAudit(guild.id, client.user.id, 'backup_created', saved.id, { source: 'scheduled', label: saved.label });
      await vault.pruneScheduledBackups(guild.id, schedule.retention_count);
      await vault.advanceSchedule(guild.id, schedule.interval_hours);
      logger.info(`Scheduled Vault backup #${saved.id} created for guild ${guild.id}.`);
    } catch (err) {
      await vault.advanceSchedule(schedule.guild_id, schedule.interval_hours).catch(() => {});
      logger.error(`Scheduled Vault backup failed for guild ${schedule.guild_id}:`, err);
    }
  }
}

function startBackupVaultJob(client) {
  if (!vault.isConfigured()) {
    logger.info('Petto Vault is disabled; scheduled backups are not running.');
    return;
  }
  processDueBackups(client).catch((err) => logger.error('Vault backup job error:', err));
  setInterval(() => processDueBackups(client).catch((err) => logger.error('Vault backup job error:', err)), POLL_INTERVAL_MS);
  logger.info('Petto Vault scheduled backup job started.');
}

module.exports = { startBackupVaultJob, processDueBackups };
