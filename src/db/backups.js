// The backups of a server live ONLY in the Petto Vault: its own database (PETTO_VAULT_DATABASE_URL), never in the main one. Without the Vault there are no backups
// (`vault.isConfigured()` is false and the commands and the dashboard say so). Premium is checked before a backup is made (utils/backupAccess.js), not here.
const vault = require('./vault');

const needVault = () => {
  if (!vault.isConfigured()) throw new Error('The Petto Vault database is not configured (PETTO_VAULT_DATABASE_URL).'); // i18n-ignore: an error for the operator, never shown to a member
};

async function createBackup(guildId, createdBy, label, snapshot, source = 'manual') {
  needVault();
  return vault.createBackup(guildId, createdBy, label, snapshot, source);
}

async function listBackups(guildId, limit = 10) {
  needVault();
  return vault.listBackups(guildId, limit);
}

async function getBackup(guildId, backupNumber = null) {
  needVault();
  return vault.getBackup(guildId, backupNumber);
}

/** Deletes one backup of a server. True when there was one. */
async function deleteBackup(guildId, backupNumber) {
  needVault();
  return vault.deleteBackup(guildId, backupNumber);
}

/** Deletes every backup of a server and turns its automatic backups off. Returns how many backups there were. */
async function deleteAllBackups(guildId) {
  needVault();
  return vault.deleteAllBackups(guildId);
}

async function recordAudit(guildId, actorId, action, backupNumber = null, metadata = {}) {
  needVault();
  await vault.recordAudit(guildId, actorId, action, backupNumber, metadata);
  return true;
}

async function listAudit(guildId, limit = 10) {
  needVault();
  return vault.listAudit(guildId, limit);
}

module.exports = { createBackup, listBackups, getBackup, deleteBackup, deleteAllBackups, recordAudit, listAudit, vault };

/**
 * The backups that were kept in the main database before the Vault were deleted for good (the maintainer asked for it: the main database holds no backups). It runs once after the Vault is
 * connected (never before, so a server is never left with no place for its backups), and it does nothing when there is nothing left. Returns how many backups it deleted.
 */
async function purgeLegacyBackups() {
  if (!vault.isConfigured()) return 0;
  const { getPrimaryPool } = require('./postgres');
  const pool = getPrimaryPool();
  const table = await pool.query("select to_regclass('public.guild_backups') as backups, to_regclass('public.guild_backup_audit') as audit");
  let removed = 0;
  if (table.rows[0]?.backups) removed = (await pool.query('delete from guild_backups')).rowCount ?? 0;
  if (table.rows[0]?.audit) await pool.query('delete from guild_backup_audit');
  return removed;
}
module.exports.purgeLegacyBackups = purgeLegacyBackups;
