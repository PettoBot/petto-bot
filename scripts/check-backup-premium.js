// Backups: only the servers with Premium make or schedule them, a failure to know is a no, and the backups never fall back to the main database (without the Vault there are none).
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
delete process.env.PETTO_VAULT_DATABASE_URL;
delete process.env.PETTO_VAULT_DATABASE_HOST;
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
let premium = { active: true };
stub('premium', { getGuildPremium: async () => { if (premium instanceof Error) throw premium; return premium; } });
const access = require('../src/utils/backupAccess');
(async () => {
  assert.equal(await access.backupsAllowed('1'), true);
  premium = { active: false };
  assert.equal(await access.backupsAllowed('1'), false, 'a server without Premium cannot make backups');
  premium = new Error('database down');
  assert.equal(await access.backupsAllowed('1'), false, 'Premium is fail-closed');
  assert.match(access.premiumUrl(), /\/premium$/);

  // No Vault: nothing is saved in the main database.
  const backups = require('../src/db/backups');
  assert.equal(backups.vault.isConfigured(), false);
  for (const call of [() => backups.createBackup('1', '2', 'x', {}), () => backups.listBackups('1'), () => backups.getBackup('1'), () => backups.deleteBackup('1', 1), () => backups.deleteAllBackups('1'), () => backups.recordAudit('1', '2', 'a'), () => backups.listAudit('1')]) {
    await assert.rejects(call, /Vault database is not configured/);
  }
  assert.equal(await backups.purgeLegacyBackups(), 0, 'the old backups of the main database are only deleted once the Vault exists');

  // The places that make a backup ask for Premium.
  const fs = require('node:fs');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/commands/config/backup.js'), /backupsAllowed\(interaction\.guild\.id\)[\s\S]*backup\.premium\.required/);
  assert.equal((read('src/commands/config/backup.js').match(/backup\.premium\.required/g) || []).length, 2, 'the command and the schedule');
  assert.match(read('src/web/server.js'), /action === 'create' \|\| action === 'schedule'\) && !\(await backupsAllowed/);
  assert.match(read('src/jobs/backupVaultJob.js'), /backupsAllowed\(guild\.id\)/);
  for (const lang of ['en', 'es', 'pt-BR']) assert.match(read(`src/i18n/locales/${lang}/backup.js`), /'backup\.premium\.required'/);
  console.log('backup premium: ok');
})().catch((error) => { console.error(error); process.exit(1); });
