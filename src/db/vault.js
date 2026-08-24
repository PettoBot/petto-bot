const { Pool } = require('pg');
const config = require('../config');

let pool;
let schemaPromise;

function getPool() {
  if (!config.vaultDatabaseUrl) return null;
  if (!pool) {
    // Aiven requires TLS for managed PostgreSQL. Keep the Vault connection
    // aligned with the primary migration client so pg accepts its certificate
    // chain in the Discloud runtime.
    const connectionUrl = new URL(config.vaultDatabaseUrl);
    // pg's connection-string parser can override the explicit ssl object when
    // sslmode is present in the URI. Remove only that option and configure the
    // TLS behavior below so Aiven works consistently across host runtimes.
    connectionUrl.searchParams.delete('sslmode');
    pool = new Pool({
      connectionString: connectionUrl.toString(),
      ssl: { rejectUnauthorized: false },
      max: 4,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', () => {});
  }
  return pool;
}

function isConfigured() {
  return Boolean(getPool());
}

async function ensureSchema() {
  const db = getPool();
  if (!db) return false;
  if (!schemaPromise) {
    schemaPromise = db.query(`
      create table if not exists petto_vault_backups (
        id bigserial primary key,
        guild_id text not null,
        backup_number bigint,
        created_by text not null,
        label text not null default 'Manual backup',
        source text not null default 'manual' check (source in ('manual', 'scheduled')),
        snapshot jsonb not null,
        created_at timestamptz not null default now()
      );
      alter table petto_vault_backups add column if not exists backup_number bigint;
      alter table petto_vault_backups add column if not exists source text not null default 'manual';
      alter table petto_vault_backups drop constraint if exists petto_vault_backups_source_check;
      alter table petto_vault_backups add constraint petto_vault_backups_source_check check (source in ('manual', 'scheduled'));
      with numbered as (
        select backups.id,
          coalesce(existing.max_number, 0)
            + row_number() over (partition by backups.guild_id order by backups.created_at asc, backups.id asc) as number
        from petto_vault_backups as backups
        left join (
          select guild_id, max(backup_number) as max_number
          from petto_vault_backups
          group by guild_id
        ) as existing on existing.guild_id = backups.guild_id
        where backups.backup_number is null
      )
      update petto_vault_backups as backups
      set backup_number = numbered.number
      from numbered
      where backups.id = numbered.id;
      alter table petto_vault_backups alter column backup_number set not null;
      create unique index if not exists idx_petto_vault_backups_guild_number on petto_vault_backups(guild_id, backup_number);
      create index if not exists idx_petto_vault_backups_guild_created on petto_vault_backups(guild_id, created_at desc);
      create table if not exists petto_vault_schedules (
        guild_id text primary key,
        interval_hours integer not null check (interval_hours between 1 and 168),
        retention_count integer not null check (retention_count between 1 and 30),
        next_run_at timestamptz not null,
        updated_by text not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists petto_vault_audit (
        id bigserial primary key,
        guild_id text not null,
        actor_id text not null,
        action text not null,
        backup_id bigint,
        backup_number bigint,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      alter table petto_vault_audit add column if not exists backup_number bigint;
      update petto_vault_audit as audit
      set backup_number = backups.backup_number
      from petto_vault_backups as backups
      where audit.backup_number is null
        and audit.guild_id = backups.guild_id
        and audit.backup_id = backups.id;
      create index if not exists idx_petto_vault_audit_guild_created on petto_vault_audit(guild_id, created_at desc);
    `).then(() => true).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function createBackup(guildId, createdBy, label, snapshot, source = 'manual') {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [guildId]);
    const { rows } = await client.query(
      `insert into petto_vault_backups (guild_id, backup_number, created_by, label, source, snapshot)
       values ($1, coalesce((select max(backup_number) + 1 from petto_vault_backups where guild_id = $1), 1), $2, $3, $4, $5::jsonb)
       returning id, backup_number, label, source, created_at`,
      [guildId, createdBy, label || (source === 'scheduled' ? 'Scheduled backup' : 'Manual backup'), source, JSON.stringify(snapshot)],
    );
    await client.query('commit');
    return rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listBackups(guildId, limit = 10) {
  await ensureSchema();
  const { rows } = await pool.query('select backup_number, id, label, source, created_by, created_at from petto_vault_backups where guild_id = $1 order by created_at desc limit $2', [guildId, limit]);
  return rows;
}

async function getBackup(guildId, backupNumber = null) {
  await ensureSchema();
  const { rows } = backupNumber
    ? await pool.query('select * from petto_vault_backups where guild_id = $1 and backup_number = $2 limit 1', [guildId, backupNumber])
    : await pool.query('select * from petto_vault_backups where guild_id = $1 order by created_at desc limit 1', [guildId]);
  return rows[0] ?? null;
}

async function recordAudit(guildId, actorId, action, backupNumber = null, metadata = {}) {
  await ensureSchema();
  await pool.query('insert into petto_vault_audit (guild_id, actor_id, action, backup_number, metadata) values ($1, $2, $3, $4, $5::jsonb)', [guildId, actorId, action, backupNumber, JSON.stringify(metadata)]);
}

async function listAudit(guildId, limit = 10) {
  await ensureSchema();
  const { rows } = await pool.query('select id, actor_id, action, coalesce(backup_number, (select b.backup_number from petto_vault_backups b where b.guild_id = petto_vault_audit.guild_id and b.id = petto_vault_audit.backup_id)) as backup_number, metadata, created_at from petto_vault_audit where guild_id = $1 order by created_at desc limit $2', [guildId, limit]);
  return rows;
}

async function getSchedule(guildId) {
  await ensureSchema();
  const { rows } = await pool.query('select * from petto_vault_schedules where guild_id = $1 limit 1', [guildId]);
  return rows[0] ?? null;
}

async function upsertSchedule(guildId, intervalHours, retentionCount, updatedBy) {
  await ensureSchema();
  const { rows } = await pool.query(
    `insert into petto_vault_schedules (guild_id, interval_hours, retention_count, next_run_at, updated_by)
     values ($1, $2, $3, now() + ($2::int * interval '1 hour'), $4)
     on conflict (guild_id) do update set interval_hours = excluded.interval_hours,
       retention_count = excluded.retention_count,
       next_run_at = now() + (excluded.interval_hours * interval '1 hour'),
       updated_by = excluded.updated_by, updated_at = now() returning *`,
    [guildId, intervalHours, retentionCount, updatedBy],
  );
  return rows[0];
}

async function removeSchedule(guildId) {
  await ensureSchema();
  const result = await pool.query('delete from petto_vault_schedules where guild_id = $1', [guildId]);
  return result.rowCount > 0;
}

async function listDueSchedules() {
  await ensureSchema();
  const { rows } = await pool.query('select * from petto_vault_schedules where next_run_at <= now() order by next_run_at asc limit 50');
  return rows;
}

async function advanceSchedule(guildId, intervalHours) {
  await ensureSchema();
  await pool.query("update petto_vault_schedules set next_run_at = now() + ($2::int * interval '1 hour'), updated_at = now() where guild_id = $1", [guildId, intervalHours]);
}

async function pruneScheduledBackups(guildId, retentionCount) {
  await ensureSchema();
  const result = await pool.query(`delete from petto_vault_backups where id in (
    select id from petto_vault_backups where guild_id = $1 and source = 'scheduled' order by created_at desc offset $2
  )`, [guildId, retentionCount]);
  return result.rowCount;
}

module.exports = { isConfigured, ensureSchema, createBackup, listBackups, getBackup, recordAudit, listAudit, getSchedule, upsertSchedule, removeSchedule, listDueSchedules, advanceSchedule, pruneScheduledBackups };
