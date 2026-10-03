// The data that custom commands written in code remember: a key and a value for the whole server, or for one member.
// It can live in its own PostgreSQL database (PETTO_CODE_DATABASE_URL), so what people store never shares a database with the
// settings of Petto, and falls back to the main one when there is none.
const { Pool } = require('pg');
const config = require('../config');
const { getPrimaryPool } = require('./postgres');

const MAX_ENTRIES_PER_GUILD = 500;

const SCHEMA = `
  create table if not exists custom_command_data (
    guild_id   text not null,
    user_id    text not null default '',
    key        text not null,
    value      jsonb not null,
    expires_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (guild_id, user_id, key)
  );
  create index if not exists idx_custom_command_data_top on custom_command_data(guild_id, key);
  create index if not exists idx_custom_command_data_expires on custom_command_data(expires_at) where expires_at is not null;
`;

let dedicatedPool;
let schemaReady;

function getPool() {
  if (!config.codeDatabaseUrl) return getPrimaryPool();
  if (!dedicatedPool) {
    const url = new URL(config.codeDatabaseUrl);
    url.searchParams.delete('sslmode'); // pg would override the ssl option below with it
    dedicatedPool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30_000 });
    dedicatedPool.on('error', () => {});
  }
  return dedicatedPool;
}

async function db() {
  const pool = getPool();
  if (!schemaReady) schemaReady = pool.query(SCHEMA).catch((error) => { schemaReady = null; throw error; });
  await schemaReady;
  return pool;
}

const alive = '(expires_at is null or expires_at > now())';

/** The data of one server, as the object the language sees: `get`, `set`, `del`, `incr`, `top` and `keys`. */
function forGuild(guildId) {
  const guild = String(guildId);
  return {
    async get(key, user) {
      const { rows } = await (await db()).query(`select value from custom_command_data where guild_id = $1 and user_id = $2 and key = $3 and ${alive}`, [guild, user, key]);
      return rows[0] ? rows[0].value : null;
    },
    async set(key, value, user, ttlSeconds) {
      const pool = await db();
      const exists = await pool.query(`select 1 from custom_command_data where guild_id = $1 and user_id = $2 and key = $3 and ${alive}`, [guild, user, key]);
      if (!exists.rowCount) {
        const { rows } = await pool.query(`select count(*)::int as total from custom_command_data where guild_id = $1 and ${alive}`, [guild]);
        if (rows[0].total >= MAX_ENTRIES_PER_GUILD) throw new Error(`This server already stores ${MAX_ENTRIES_PER_GUILD} values, the most it can`);
      }
      await pool.query(
        `insert into custom_command_data (guild_id, user_id, key, value, expires_at) values ($1, $2, $3, $4::jsonb, case when $5::int is null then null else now() + ($5::int * interval '1 second') end)
         on conflict (guild_id, user_id, key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = now()`,
        [guild, user, key, JSON.stringify(value), ttlSeconds],
      );
    },
    async del(key, user) {
      await (await db()).query('delete from custom_command_data where guild_id = $1 and user_id = $2 and key = $3', [guild, user, key]);
    },
    async incr(key, amount, user) {
      const pool = await db();
      await pool.query('delete from custom_command_data where guild_id = $1 and user_id = $2 and key = $3 and expires_at <= now()', [guild, user, key]);
      const exists = await pool.query('select value from custom_command_data where guild_id = $1 and user_id = $2 and key = $3', [guild, user, key]);
      if (exists.rowCount && typeof exists.rows[0].value !== 'number') throw new Error('That key does not hold a number');
      if (!exists.rowCount) {
        const { rows } = await pool.query(`select count(*)::int as total from custom_command_data where guild_id = $1 and ${alive}`, [guild]);
        if (rows[0].total >= MAX_ENTRIES_PER_GUILD) throw new Error(`This server already stores ${MAX_ENTRIES_PER_GUILD} values, the most it can`);
      }
      const { rows } = await pool.query(
        `insert into custom_command_data as t (guild_id, user_id, key, value) values ($1, $2, $3, to_jsonb($4::numeric))
         on conflict (guild_id, user_id, key) do update set value = to_jsonb((t.value #>> '{}')::numeric + $4::numeric), updated_at = now()
         returning value`,
        [guild, user, key, amount],
      );
      return rows[0].value;
    },
    async top(key, limit) {
      const { rows } = await (await db()).query(
        `select user_id, value from custom_command_data where guild_id = $1 and key = $2 and user_id <> '' and jsonb_typeof(value) = 'number' and ${alive}
         order by (value #>> '{}')::numeric desc limit $3`,
        [guild, key, limit],
      );
      return rows.map((row) => ({ UserID: row.user_id, Value: row.value }));
    },
    async keys(prefix, user) {
      const { rows } = await (await db()).query(
        `select key from custom_command_data where guild_id = $1 and user_id = $2 and key like $3 and ${alive} order by key limit 100`,
        [guild, user, `${prefix.replace(/[\\%_]/g, '\\$&')}%`],
      );
      return rows.map((row) => row.key);
    },
  };
}

/** Removes what expired. */
async function purgeExpired() {
  const { rowCount } = await (await db()).query('delete from custom_command_data where expires_at <= now()');
  return rowCount;
}

/** Removes everything a server stored (when Petto leaves it, or when the server asks). */
async function deleteGuildData(guildId) {
  const { rowCount } = await (await db()).query('delete from custom_command_data where guild_id = $1', [String(guildId)]);
  return rowCount;
}

module.exports = { forGuild, purgeExpired, deleteGuildData, MAX_ENTRIES_PER_GUILD, SCHEMA };
