// The scheduled backups and the cleanup of old ones when the shards are split between instances (jobs/backupVaultJob.js): every instance only works on its own servers, and a server on
// another shard is never taken for one Petto left. A fake Vault and a fake database: nothing real.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const config = { dashboard: {}, web: {}, jobConcurrency: 2, shards: [0, 5], shardCount: 6 };
const advanced = []; const deleted = [];
const DAY = 24 * 60 * 60_000;
let saved = ['mine', 'theirs']; // the servers the saved copies of every instance name
let savedFails = false;
stub('src/config.js', config);
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/postgres.js', { getPrimaryPool: () => ({ query: async () => { if (savedFails) throw new Error('database down'); return { rows: saved.map((id) => ({ id })) }; } }) });
stub('src/db/backups.js', {
  createBackup: async () => { throw new Error('a backup was made'); }, recordAudit: async () => {}, purgeLegacyBackups: async () => 0,
  vault: {
    isConfigured: () => true,
    listDueSchedules: async () => [{ guild_id: 'mine', interval_hours: 24 }, { guild_id: 'theirs', interval_hours: 24 }, { guild_id: 'gone', interval_hours: 24 }],
    advanceSchedule: async (id) => { advanced.push(id); },
    listBackupGuilds: async () => [{ guild_id: 'mine', last_at: new Date(Date.now() - 60 * DAY) }, { guild_id: 'theirs', last_at: new Date(Date.now() - 60 * DAY) }, { guild_id: 'gone', last_at: new Date(Date.now() - 60 * DAY) }],
    deleteAllBackups: async (id) => { deleted.push(id); return 1; },
    pruneScheduledBackups: async () => 0,
  },
});
stub('src/commands/config/backup.js', { buildFullSnapshot: async () => ({}) });
stub('src/utils/backupAccess.js', { backupsAllowed: async () => false }); // without Premium the schedule is only moved on, which is enough to see which ones were looked at
stub('src/i18n/index.js', { t: () => '', guildLanguage: async () => 'en' });
stub('src/utils/maintenance.js', { backupsPaused: () => false, backupsUnderMaintenance: () => false });

const { processDueBackups, purgeOrphanedBackups } = require('../src/jobs/backupVaultJob');
const client = { guilds: { cache: new Map([['mine', { id: 'mine' }]]) }, user: { id: 'bot' } };
const reset = () => { advanced.length = 0; deleted.length = 0; };

(async () => {
  // ---- The scheduled backups --------------------------------------------------------------------------------------------------------
  reset();
  await processDueBackups(client);
  assert.deepEqual(advanced, ['mine'], 'split between instances: only the server of this process is looked at; the ones of other shards keep their schedule for their own instance');
  reset(); config.shards = [0, 1, 2, 3, 4, 5];
  await processDueBackups(client);
  assert.deepEqual(advanced.sort(), ['gone', 'mine', 'theirs'], 'one instance with every shard: a server that is not in the cache is one Petto left, its schedule moves on as it always did');

  // ---- The cleanup of the backups of servers Petto left ---------------------------------------------------------------------------------------
  reset(); config.shards = [0, 5];
  await purgeOrphanedBackups(client);
  assert.deepEqual(deleted, ['gone'], 'split: the old backups of a server of another shard are kept; only the ones of a server nobody has are deleted');
  reset(); savedFails = true;
  await purgeOrphanedBackups(client);
  assert.deepEqual(deleted, [], 'with the saved list of servers unreadable, nothing is deleted');
  reset(); savedFails = false; saved = [];
  await purgeOrphanedBackups(client);
  assert.deepEqual(deleted, [], 'with it empty, nothing is deleted either');
  reset(); config.shards = [0, 1, 2, 3, 4, 5];
  await purgeOrphanedBackups(client);
  assert.deepEqual(deleted.sort(), ['gone', 'theirs'], 'one instance with every shard: the cache is the whole bot, as it always was');
  console.log('backup split: ok');
})().catch((error) => { console.error(error); process.exit(1); });
