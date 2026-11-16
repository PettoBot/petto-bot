// The data that custom commands written in code remember: a key and a value for the whole server, or for one member.
// It can live in its own PostgreSQL database (PETTO_CODE_DATABASE_URL), so what people store never shares a database with the
// settings of Petto, and falls back to the main one when there is none.
const { Pool } = require('pg');
const config = require('../config');
const { getPrimaryPool } = require('./postgres');
// Errors a member sees through their Petto Code (`dbIncr: …`), in the language of the server.
const { CodeProblem } = require('../scripting/errors');

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
  create table if not exists custom_command_schedule (
    guild_id   text not null,
    name       text not null,
    id         text not null,
    run_at     timestamptz not null,
    user_id    text not null,
    channel_id text not null default '',
    data       jsonb not null default 'null'::jsonb,
    created_at timestamptz not null default now(),
    primary key (guild_id, name, id)
  );
  alter table custom_command_schedule add column if not exists origin text not null default 'command';
  alter table custom_command_schedule add column if not exists repeat_kind text;
  alter table custom_command_schedule add column if not exists repeat_every_ms bigint;
  alter table custom_command_schedule add column if not exists at_time text;
  alter table custom_command_schedule add column if not exists timezone text;
  alter table custom_command_schedule add column if not exists weekday integer;
  create table if not exists custom_command_settings (
    guild_id   text primary key,
    timezone   text,
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_custom_command_schedule_due on custom_command_schedule(run_at);
`;

let dedicatedPool;
let schemaReady;

function getPool() {
  if (!config.codeDatabaseUrl) return getPrimaryPool();
  if (!dedicatedPool) {
    const url = new URL(config.codeDatabaseUrl);
    url.searchParams.delete('sslmode'); // pg would override the ssl option below with it
    dedicatedPool = new Pool({ connectionString: url.toString(), ssl: config.codeDatabaseSsl ? { rejectUnauthorized: false } : false, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30_000 });
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

const alive = '(expires_at is null or expires_at > now())'; // i18n-ignore: SQL

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
        if (rows[0].total >= MAX_ENTRIES_PER_GUILD) throw new CodeProblem('scripting.store.full', { max: MAX_ENTRIES_PER_GUILD });
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
      if (exists.rowCount && typeof exists.rows[0].value !== 'number') throw new CodeProblem('scripting.store.notNumber');
      if (!exists.rowCount) {
        const { rows } = await pool.query(`select count(*)::int as total from custom_command_data where guild_id = $1 and ${alive}`, [guild]);
        if (rows[0].total >= MAX_ENTRIES_PER_GUILD) throw new CodeProblem('scripting.store.full', { max: MAX_ENTRIES_PER_GUILD });
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
    async bottom(key, limit) {
      const { rows } = await (await db()).query(
        `select user_id, value from custom_command_data where guild_id = $1 and key = $2 and user_id <> '' and jsonb_typeof(value) = 'number' and ${alive}
         order by (value #>> '{}')::numeric asc limit $3`,
        [guild, key, limit],
      );
      return rows.map((row) => ({ UserID: row.user_id, Value: row.value }));
    },
    /** The place of a member in the ranking of a key (1 is the highest), or null when they have no number there. */
    async rank(key, user) {
      const { rows } = await (await db()).query(
        `select (select count(*)::int from custom_command_data o where o.guild_id = t.guild_id and o.key = t.key and o.user_id <> '' and jsonb_typeof(o.value) = 'number'
                   and (o.expires_at is null or o.expires_at > now()) and (o.value #>> '{}')::numeric > (t.value #>> '{}')::numeric) + 1 as rank
         from custom_command_data t where t.guild_id = $1 and t.key = $2 and t.user_id = $3 and jsonb_typeof(t.value) = 'number' and (t.expires_at is null or t.expires_at > now())`,
        [guild, key, user],
      );
      return rows[0] ? rows[0].rank : null;
    },
    /** How many keys the server (or one member, with a user) has, of those that start with the prefix. */
    async count(prefix, user) {
      const { rows } = await (await db()).query(
        `select count(*)::int as total from custom_command_data where guild_id = $1 and user_id = $2 and key like $3 and key not like 'rx:%' and ${alive}`,
        [guild, user, `${prefix.replace(/[\\%_]/g, '\\$&')}%`],
      );
      return rows[0].total;
    },
    // The messages whose reactions run a command. They are kept apart from the values of the code and do not count towards its limit.
    async watch(messageId, record, ttlSeconds) {
      await (await db()).query(
        `insert into custom_command_data (guild_id, user_id, key, value, expires_at) values ($1, '', $2, $3::jsonb, now() + ($4::int * interval '1 second'))
         on conflict (guild_id, user_id, key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = now()`,
        [guild, `rx:${messageId}`, JSON.stringify(record), ttlSeconds],
      );
    },
    async watched(messageId) {
      const { rows } = await (await db()).query(`select value from custom_command_data where guild_id = $1 and user_id = '' and key = $2 and ${alive}`, [guild, `rx:${messageId}`]);
      return rows[0] ? rows[0].value : null;
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

/** Removes everything a server stored (when Petto leaves it, or when the server asks), the commands it scheduled too. */
async function deleteGuildData(guildId) {
  const pool = await db();
  const { rowCount } = await pool.query('delete from custom_command_data where guild_id = $1', [String(guildId)]);
  await pool.query('delete from custom_command_schedule where guild_id = $1', [String(guildId)]);
  await pool.query('delete from custom_command_settings where guild_id = $1', [String(guildId)]);
  return rowCount;
}

/**
 * The commands that code asked to run later (scheduleUniqueCC). They are kept here, so a restart does not lose them. A command and an id are one
 * schedule: setting it again replaces the first. `claimDue` takes the ones that are due and removes them in one step, so two processes never run one twice.
 */
const { nextScheduledRun } = require('../utils/timerSchedule');

/**
 * When a repeating command runs next after a run, counted from now (a bot that was off does not run all the runs it missed): `repeat_kind` is 'interval' (every
 * `repeat_every_ms`), 'daily' or 'weekly' (at `at_time` of `timezone`, on `weekday` for weekly). Null when it cannot be worked out.
 */
function nextRepeat(row, now = Date.now()) {
  if (row.repeat_kind === 'interval') return Number(row.repeat_every_ms) > 0 ? now + Number(row.repeat_every_ms) : null;
  if (row.repeat_kind === 'daily' || row.repeat_kind === 'weekly') return nextScheduledRun({ schedule: row.repeat_kind, at_time: row.at_time, timezone: row.timezone, weekday: row.weekday }, now)?.getTime() ?? null;
  return null;
}

const scheduleFrom = (row) => ({
  guildId: row.guild_id, name: row.name, id: row.id, userId: row.user_id, channelId: row.channel_id, data: row.data, origin: row.origin,
  runAt: row.run_at instanceof Date ? row.run_at.getTime() : Number(new Date(row.run_at)),
  repeat: row.repeat_kind ? { kind: row.repeat_kind, everyMs: row.repeat_every_ms === null ? null : Number(row.repeat_every_ms), atTime: row.at_time, timezone: row.timezone, weekday: row.weekday } : null,
});

const schedule = {
  async set({ guildId, name, id, runAt, userId, channelId, data, origin = 'command', repeat = null }) {
    await (await db()).query(
      `insert into custom_command_schedule (guild_id, name, id, run_at, user_id, channel_id, data, origin, repeat_kind, repeat_every_ms, at_time, timezone, weekday)
       values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
       on conflict (guild_id, name, id) do update set run_at = excluded.run_at, user_id = excluded.user_id, channel_id = excluded.channel_id, data = excluded.data, origin = excluded.origin,
         repeat_kind = excluded.repeat_kind, repeat_every_ms = excluded.repeat_every_ms, at_time = excluded.at_time, timezone = excluded.timezone, weekday = excluded.weekday`,
      [String(guildId), name, id, runAt, String(userId), String(channelId ?? ''), JSON.stringify(data ?? null), origin, repeat?.kind ?? null, repeat?.everyMs ?? null, repeat?.atTime ?? null, repeat?.timezone ?? null, repeat?.weekday ?? null],
    );
  },
  async cancel(guildId, name, id) {
    const { rowCount } = await (await db()).query('delete from custom_command_schedule where guild_id = $1 and name = $2 and id = $3', [String(guildId), name, id]);
    return rowCount > 0;
  },
  async count(guildId) {
    const { rows } = await (await db()).query('select count(*)::int as total from custom_command_schedule where guild_id = $1', [String(guildId)]);
    return rows[0].total;
  },
  /** What a server has waiting, the soonest first (for the dashboard). */
  async list(guildId) {
    const { rows } = await (await db()).query('select * from custom_command_schedule where guild_id = $1 order by run_at, name, id limit 100', [String(guildId)]);
    return rows.map(scheduleFrom);
  },
  /**
   * Takes the commands that are due. One that runs once is removed; one that repeats is moved to its next time, in the same step, so it is never lost and two processes
   * never run it twice. The rows come back as they were when they were due.
   */
  async claimDue(limit = 20) {
    const pool = await db();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query('select * from custom_command_schedule where run_at <= now() order by run_at limit $1 for update skip locked', [limit]);
      for (const row of rows) {
        const next = nextRepeat(row);
        if (next) await client.query('update custom_command_schedule set run_at = to_timestamp($4 / 1000.0) where guild_id = $1 and name = $2 and id = $3', [row.guild_id, row.name, row.id, next]);
        else await client.query('delete from custom_command_schedule where guild_id = $1 and name = $2 and id = $3', [row.guild_id, row.name, row.id]);
      }
      await client.query('commit');
      return rows.map(scheduleFrom);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
};

/** The settings of the code of a server: for now its time zone. */
const settings = {
  async get(guildId) {
    const { rows } = await (await db()).query('select timezone from custom_command_settings where guild_id = $1', [String(guildId)]);
    return rows[0] ?? null;
  },
  async setTimeZone(guildId, timezone) {
    await (await db()).query(
      'insert into custom_command_settings (guild_id, timezone) values ($1, $2) on conflict (guild_id) do update set timezone = excluded.timezone, updated_at = now()',
      [String(guildId), timezone],
    );
  },
};

module.exports = { forGuild, purgeExpired, deleteGuildData, schedule, settings, nextRepeat, MAX_ENTRIES_PER_GUILD, SCHEMA };
