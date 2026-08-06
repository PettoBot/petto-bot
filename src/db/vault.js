const { Pool } = require('pg');
const config = require('../config');

let pool;
let schemaPromise;

function getPool() {
  if (!config.vaultDatabaseUrl) return null;
  if (!pool) {
    pool = new Pool({ connectionString: config.vaultDatabaseUrl, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30_000 });
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
        created_by text not null,
        label text not null default 'Manual backup',
        source text not null default 'manual' check (source in ('manual', 'scheduled')),
        snapshot jsonb not null,
        created_at timestamptz not null default now()
      );
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
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
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
  const { rows } = await pool.query(
    `insert into petto_vault_backups (guild_id, created_by, label, source, snapshot)
     values ($1, $2, $3, $4, $5::jsonb) returning id, label, source, created_at`,
    [guildId, createdBy, label || (source === 'scheduled' ? 'Scheduled backup' : 'Manual backup'), source, JSON.stringify(snapshot)],
  );
  return rows[0];
}

async function listBackups(guildId, limit = 10) {
  await ensureSchema();
  const { rows } = await pool.query('select id, label, source, created_by, created_at from petto_vault_backups where guild_id = $1 order by created_at desc limit $2', [guildId, limit]);
  return rows;
}

async function getBackup(guildId, id = null) {
  await ensureSchema();
  const { rows } = id
    ? await pool.query('select * from petto_vault_backups where guild_id = $1 and id = $2 limit 1', [guildId, id])
    : await pool.query('select * from petto_vault_backups where guild_id = $1 order by created_at desc limit 1', [guildId]);
  return rows[0] ?? null;
}

async function recordAudit(guildId, actorId, action, backupId = null, metadata = {}) {
  await ensureSchema();
  await pool.query('insert into petto_vault_audit (guild_id, actor_id, action, backup_id, metadata) values ($1, $2, $3, $4, $5::jsonb)', [guildId, actorId, action, backupId, JSON.stringify(metadata)]);
}

async function listAudit(guildId, limit = 10) {
  await ensureSchema();
  const { rows } = await pool.query('select id, actor_id, action, backup_id, metadata, created_at from petto_vault_audit where guild_id = $1 order by created_at desc limit $2', [guildId, limit]);
  return rows;
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
  await pool.query(`delete from petto_vault_backups where id in (
    select id from petto_vault_backups where guild_id = $1 and source = 'scheduled' order by created_at desc offset $2
  )`, [guildId, retentionCount]);
}

module.exports = { isConfigured, ensureSchema, createBackup, listBackups, getBackup, recordAudit, listAudit, upsertSchedule, removeSchedule, listDueSchedules, advanceSchedule, pruneScheduledBackups };
