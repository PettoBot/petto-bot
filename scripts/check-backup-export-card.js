// The export of a backup is a message made of components: the JSON file only shows (and can only be tapped and saved) when a file
// component points at it. Checks the reply the command sends, with the database and the language stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel));
const stub = (rel, exports) => { require.cache[resolve(rel)] = { id: resolve(rel), filename: resolve(rel), loaded: true, exports }; };

stub('src/config.js', { verifyTokenSecret: 'a-secret-for-the-check-of-the-export-card' });
stub('src/utils/logger.js', { warn() {}, info() {}, error() {} });
stub('src/db/backups.js', {
  createBackup: async () => null, listBackups: async () => [], deleteBackup: async () => null, deleteAllBackups: async () => null,
  recordAudit: async () => null, listAudit: async () => [], vault: {},
  getBackup: async () => ({ snapshot: { roles: [] }, source: 'manual', backup_number: 7 }),
});

const backup = require('../src/commands/config/backup.js');

(async () => {
  const sent = [];
  const interaction = {
    guild: { id: '123456789012345678' },
    user: { id: '223456789012345678' },
    options: { getInteger: () => 7 },
    deferred: false, replied: false,
    reply: async (p) => { sent.push(p); }, deferReply: async () => {}, editReply: async (p) => { sent.push(p); },
  };
  await backup.exportBackupForInteraction(interaction, 7);
  const last = sent[sent.length - 1];
  assert.ok(last, 'the command answered');
  assert.equal(last.files?.length, 1, 'the JSON file is attached');
  const name = last.files[0].name;
  assert.match(name, /^petto-backup-\d+-\d+\.json$/);
  const json = JSON.stringify(last.components.map((c) => c.toJSON()));
  assert.ok(json.includes(`attachment://${name}`), 'a file component points at the attachment');
  assert.ok(json.includes('"type":13'), 'the card holds a file component (type 13)');
  console.log('Backup export card checks passed (the file is attached and shown by a file component).');
})().catch((error) => { console.error(error); process.exit(1); });
