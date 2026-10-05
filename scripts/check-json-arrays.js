// A JavaScript array sent into a json/jsonb column used to fail (22P02), because the PostgreSQL driver sends it as a
// PostgreSQL array. The client now sends it as JSON for json columns only. Checked with a recording pool, and with a real
// test database when PETTO_TEST_DATABASE_URL is set.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { databasePoolMax: 2, databaseConnectTimeoutMs: 3000 });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const { createPostgresClient } = require('../src/db/postgres');

(async () => {
  // 1. A recording pool: which values reach the driver.
  const sent = [];
  let typeQueries = 0;
  const pool = {
    query: async (text, values) => {
      if (/information_schema\.columns/.test(text)) { typeQueries += 1; return { rows: values[1] === 'polls' ? [{ column_name: 'options' }] : [] }; }
      sent.push({ text, values });
      return { rows: [{ id: 1 }] };
    },
  };
  const db = createPostgresClient(pool);
  await db.from('polls').insert({ guild_id: 'g', options: ['a', 'b'], multi: false }).select('*');
  assert.equal(sent[0].values.includes('["a","b"]'), true, 'a list for a json column goes as JSON text');
  assert.equal(sent[0].values.some((value) => Array.isArray(value)), false);

  await db.from('polls').update({ options: ['x'] }).eq('id', 1);
  assert.ok(sent[1].values.includes('["x"]'), 'updates too');
  await db.from('polls').insert([{ guild_id: 'g', options: ['p'] }, { guild_id: 'h', options: ['q'] }]);
  assert.deepEqual(sent[2].values.filter((value) => typeof value === 'string' && value.startsWith('[')), ['["p"]', '["q"]'], 'every row of a bulk insert');
  assert.equal(typeQueries, 1, 'the column types are read once per table');

  await db.from('other_table').insert({ channel_ids: ['1', '2'], settings: { a: 1 } });
  const other = sent[sent.length - 1].values;
  assert.ok(other.some((value) => Array.isArray(value)), 'a list for a column that is not json stays a list (text[])');
  assert.ok(other.some((value) => value && typeof value === 'object' && !Array.isArray(value)), 'objects are left to the driver');

  // A failing type lookup must not stop the write.
  const failing = createPostgresClient({ query: async (text, values) => { if (/information_schema/.test(text)) throw new Error('no access'); sent.push({ text, values }); return { rows: [] }; } });
  await failing.from('polls').insert({ guild_id: 'g', options: ['a'] });
  assert.ok(sent[sent.length - 1].values.some((value) => Array.isArray(value)), 'without the column types the value goes as before');

  // 2. A real database, if there is one.
  const url = process.env.PETTO_TEST_DATABASE_URL;
  if (!url) {
    console.log('json arrays ok (the database part was skipped: set PETTO_TEST_DATABASE_URL to a test database to run it)');
    return;
  }
  const { Pool } = require('pg');
  const real = new Pool({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
  const client = createPostgresClient(real);
  const GUILD = '900000000000000002';
  try {
    await real.query('INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [GUILD]);
    const { data, error } = await client.from('polls').insert({ guild_id: GUILD, channel_id: 'c', message_id: 'pending', creator_id: 'u', question: 'Check?', options: ['Yes', 'No', 'Maybe'] }).select('*');
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data[0].options, ['Yes', 'No', 'Maybe'], 'the options come back as a list');
    const kind = (await real.query('SELECT jsonb_typeof(options) AS kind, jsonb_array_length(options) AS n FROM polls WHERE id = $1', [data[0].id])).rows[0];
    assert.deepEqual(kind, { kind: 'array', n: 3 });
    const updated = await client.from('polls').update({ options: ['One', 'Two'] }).eq('id', data[0].id).select('*');
    assert.equal(updated.error, null, updated.error && updated.error.message);
    assert.deepEqual(updated.data[0].options, ['One', 'Two']);
    // a text[] column still takes a list
    await real.query('INSERT INTO partner_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [GUILD]);
    const arrayColumn = await client.from('partner_config').update({ channel_ids: ['1', '2'] }).eq('guild_id', GUILD).select('channel_ids');
    assert.equal(arrayColumn.error, null, arrayColumn.error && arrayColumn.error.message);
    assert.deepEqual(arrayColumn.data[0].channel_ids, ['1', '2']);
    console.log('json arrays ok (with the real database)');
  } finally {
    await real.query('DELETE FROM guilds WHERE guild_id = $1', [GUILD]).catch(() => {});
    await real.end();
  }
})().catch((error) => { console.error(error); process.exit(1); });
