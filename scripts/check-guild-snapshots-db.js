// Saves a server through the real PostgreSQL client into a real test database: the in-memory check cannot catch how the
// driver turns a JavaScript array into SQL (a PostgreSQL array, which jsonb refuses). Skipped without a test database.
const assert = require('node:assert/strict');
const path = require('node:path');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the saved servers database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const { Pool } = require('pg');
stub('src/config.js', { shards: undefined, databasePoolMax: 2, databaseConnectTimeoutMs: 3000 });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const pool = new Pool({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
const { createPostgresClient } = require('../src/db/postgres');
stub('src/db/database.js', createPostgresClient(pool));
const { saveGuildSnapshot, removeGuildSnapshot } = require('../src/utils/guildSnapshots');

const ID = '900000000000000001';
const channel = (id, name, type) => ({ id, name, type, rawPosition: 1, parentId: null, topic: null, nsfw: false, isThread: () => false });
const guild = {
  id: ID, name: 'Check server', icon: 'hash', ownerId: '9', memberCount: 5, banner: null, premiumTier: 1, premiumSubscriptionCount: 2,
  emojis: { cache: new Map([['e', {}]]) }, members: { me: { nickname: 'Pet', avatar: null } },
  channels: { cache: new Map([['1', channel('1', 'general', 0)], ['2', channel('2', 'voice', 2)]]) },
  roles: { cache: new Map([['10', { id: '10', name: '@everyone', color: 0, rawPosition: 0, managed: false, permissions: { bitfield: 1024n }, icon: null, hoist: false, mentionable: false }]]) },
};

(async () => {
  try {
    assert.equal(await saveGuildSnapshot(guild), true);
    const stored = (await pool.query('select jsonb_typeof(channels) as kind, jsonb_array_length(channels) as channels, jsonb_array_length(roles) as roles, channels->0->>\'name\' as first, roles->0->>\'permissions\' as permissions from discord_guild_snapshots where guild_id = $1', [ID])).rows[0];
    assert.deepEqual(stored, { kind: 'array', channels: 2, roles: 1, first: 'general', permissions: '1024' }, 'the lists are stored as JSON arrays');
    guild.name = 'Renamed';
    assert.equal(await saveGuildSnapshot(guild), true);
    assert.equal((await pool.query('select name from discord_guild_snapshots where guild_id = $1', [ID])).rows[0].name, 'Renamed');
    console.log('saved servers database check ok');
  } finally {
    await removeGuildSnapshot(ID).catch(() => {});
    await pool.end();
  }
})().catch((error) => { console.error(error); process.exit(1); });
