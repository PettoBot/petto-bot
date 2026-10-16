// Backups are paused: the command and its panel answer that they are under maintenance and the scheduled backups are not taken, except for the
// owner and the developers, until BACKUPS_MAINTENANCE=off brings them back.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let listed = 0;
stub('src/config.js', { dashboard: {}, web: {}, ownerId: 'owner1', developerIds: ['dev1'] });
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/postgres.js', { createPostgresClient() {}, getPrimaryPool() {} });
stub('src/db/guilds.js', { findGuildLanguage: async () => null, listGuildLanguages: async () => [] });
stub('src/db/backups.js', {
  createBackup: async () => { throw new Error('a backup was made'); },
  listBackups: async () => [], getBackup: async () => null, recordAudit: async () => {}, listAudit: async () => [],
  vault: { isConfigured: () => true, listDueSchedules: async () => { listed += 1; return []; } },
});
stub('src/utils/backupRestore.js', { restoreBackup: async () => { throw new Error('a restore was made'); } });

const { backupsUnderMaintenance, backupsPaused } = require('../src/utils/maintenance');
const backup = require('../src/commands/config/backup');
const interactions = require('../src/interactions/backup');
const { processDueBackups } = require('../src/jobs/backupVaultJob');

const reply = () => { const replies = []; return { replies, reply: async (payload) => { replies.push(payload); }, user: { id: 'u1' }, guildId: '1', customId: 'backup_menu:1:u1', values: ['create'], options: { getSubcommand: () => 'create' }, locale: 'en-US' }; };

(async () => {
  delete process.env.BACKUPS_MAINTENANCE;
  assert.equal(backupsPaused(), true, 'backups are paused unless switched back on');
  assert.equal(backupsUnderMaintenance('u1'), true, 'a member cannot use them');
  assert.equal(backupsUnderMaintenance('owner1'), false, 'the owner can');
  assert.equal(backupsUnderMaintenance('dev1'), false, 'a developer can');
  assert.equal(backupsUnderMaintenance(undefined), true, 'nobody unknown can');

  const command = reply();
  await backup.execute(command);
  assert.equal(command.replies.length, 1);
  assert.ok(String(command.replies[0].content).includes('maintenance'), 'the command says it is under maintenance');
  for (const handler of [interactions.handleSelect, interactions.handleScheduleModal, interactions.handleRestoreModal]) {
    const interaction = reply();
    await handler(interaction);
    assert.ok(String(interaction.replies[0]?.content).includes('maintenance'), 'the panel and its forms say so too');
  }

  await processDueBackups({ guilds: { cache: new Map() }, user: { id: 'bot' } });
  assert.equal(listed, 0, 'no scheduled backup is looked for while paused');

  process.env.BACKUPS_MAINTENANCE = 'off';
  assert.equal(backupsUnderMaintenance('u1'), false, 'BACKUPS_MAINTENANCE=off brings them back for everyone');
  await processDueBackups({ guilds: { cache: new Map() }, user: { id: 'bot' } });
  assert.equal(listed, 1, 'the scheduled backups run again');
  console.log('Checked that backups are under maintenance: the command, its panel, the scheduled backups and the switch back on.');
})().catch((error) => { console.error(error); process.exit(1); });
