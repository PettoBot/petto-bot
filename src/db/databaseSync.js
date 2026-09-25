const config = require('../config');
const logger = require('../utils/logger');
const { getPrimaryPool, getMirrorPool } = require('./postgres');

const PUBLIC_SCHEMA = 'public';
const BATCH_SIZE = 250;

function quoteIdentifier(value, label = 'identifier') {
  const text = String(value);
  if (!/^[a-z_][a-z0-9_]*$/i.test(text)) throw new Error(`Invalid PostgreSQL ${label}.`);
  return `"${text.replaceAll('"', '""')}"`;
}

function qualifiedTable(table) {
  return `${quoteIdentifier(PUBLIC_SCHEMA, 'schema')}.${quoteIdentifier(table, 'table')}`;
}

async function listTables(pool) {
  const { rows } = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [PUBLIC_SCHEMA],
  );
  return rows.map((row) => row.table_name);
}

async function listDependencies(pool) {
  const { rows } = await pool.query(
    `SELECT tc.table_name, ctu.table_name AS foreign_table_name
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = rc.constraint_schema
        AND tc.constraint_name = rc.constraint_name
       JOIN information_schema.constraint_table_usage ctu
         ON ctu.constraint_schema = rc.unique_constraint_schema
        AND ctu.constraint_name = rc.unique_constraint_name
      WHERE tc.constraint_schema = $1
        AND tc.table_schema = $1`,
    [PUBLIC_SCHEMA],
  );
  return rows;
}

function orderTables(tables, dependencies) {
  const available = new Set(tables);
  const parentByChild = new Map(tables.map((table) => [table, new Set()]));
  for (const dependency of dependencies) {
    if (available.has(dependency.table_name) && available.has(dependency.foreign_table_name) && dependency.table_name !== dependency.foreign_table_name) {
      parentByChild.get(dependency.table_name).add(dependency.foreign_table_name);
    }
  }

  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((table) => [...parentByChild.get(table)].every((parent) => !remaining.has(parent)));
    const next = ready.length ? ready : [remaining.values().next().value];
    for (const table of next) {
      remaining.delete(table);
      ordered.push(table);
    }
  }
  return ordered;
}

async function getTableMeta(pool, table) {
  const { rows: columns } = await pool.query(
    `SELECT column_name, ordinal_position, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [PUBLIC_SCHEMA, table],
  );
  const { rows: primaryKey } = await pool.query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_name = tc.table_name
      WHERE tc.constraint_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position`,
    [PUBLIC_SCHEMA, table],
  );
  return {
    columns: columns.map((column) => column.column_name),
    serialColumns: columns.filter((column) => String(column.column_default || '').startsWith('nextval(')).map((column) => column.column_name),
    primaryKey: primaryKey.map((column) => column.column_name),
  };
}

function buildInsert(table, meta, rows, { preserveTarget = false } = {}) {
  const values = [];
  const columns = meta.columns;
  const placeholders = rows.map((row) => `(${columns.map((column) => {
    values.push(row[column] === undefined ? null : row[column]);
    return `$${values.length}`;
  }).join(', ')})`).join(', ');
  const quotedColumns = columns.map((column) => quoteIdentifier(column, 'column')).join(', ');
  let text = `INSERT INTO ${qualifiedTable(table)} (${quotedColumns}) VALUES ${placeholders}`;
  if (meta.primaryKey.length) {
    const key = meta.primaryKey.map((column) => quoteIdentifier(column, 'primary-key column')).join(', ');
    const updates = columns.filter((column) => !meta.primaryKey.includes(column));
    text += preserveTarget || !updates.length
      ? ` ON CONFLICT (${key}) DO NOTHING`
      : ` ON CONFLICT (${key}) DO UPDATE SET ${updates.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`;
  } else {
    text += ' ON CONFLICT DO NOTHING';
  }
  return { text, values };
}

async function resetSequences(pool, table, meta) {
  for (const column of meta.serialColumns) {
    await pool.query(
      `SELECT setval(
        pg_get_serial_sequence($1, $2),
        COALESCE(MAX(${quoteIdentifier(column)}), 1),
        COUNT(*) > 0
      ) FROM ${qualifiedTable(table)}`,
      [`${PUBLIC_SCHEMA}.${table}`, column],
    );
  }
}

async function copyTable(source, target, table, options = {}) {
  const meta = await getTableMeta(source, table);
  if (!meta.columns.length) return 0;

  let offset = 0;
  let copied = 0;
  while (true) {
    const { rows } = await source.query(
      `SELECT ${meta.columns.map((column) => quoteIdentifier(column, 'column')).join(', ')}
         FROM ${qualifiedTable(table)}
        ORDER BY ${meta.primaryKey.length ? meta.primaryKey.map((column) => quoteIdentifier(column, 'primary-key column')).join(', ') : '1'}
        LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );
    if (!rows.length) break;
    const insert = buildInsert(table, meta, rows, options);
    await target.query(insert.text, insert.values);
    copied += rows.length;
    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  if (copied) await resetSequences(target, table, meta);
  return copied;
}

async function copyDatabase(source, target, direction, sourceTables, targetTables, options = {}) {
  const tables = orderTables(sourceTables.filter((table) => targetTables.has(table)), await listDependencies(source));
  let totalRows = 0;
  let copiedTables = 0;
  for (const table of tables) {
    const copied = await copyTable(source, target, table, options);
    if (copied) copiedTables += 1;
    totalRows += copied;
    logger.info(`Database sync ${direction}: ${table} (${copied} rows).`);
  }
  return { copiedTables, totalRows, tables: tables.length };
}

/**
 * Discloud is the runtime source of truth after the migration. The first pass
 * merges every row from Supabase into Discloud without overwriting an existing
 * Discloud primary-key row. The second pass mirrors the resulting Discloud
 * state back to Supabase. Comparing only row counts is not sufficient: two
 * databases can have the same number of rows while containing different guilds
 * or configuration records.
 */
async function syncDatabasesOnBoot() {
  if (!config.primaryDatabaseUrl || !config.supabaseDatabaseUrl || !config.databaseSyncOnBoot) return;

  const primary = getPrimaryPool();
  const mirror = getMirrorPool();
  const [primaryTables, mirrorTables] = await Promise.all([listTables(primary), listTables(mirror)]);
  const primaryTableSet = new Set(primaryTables);
  const mirrorTableSet = new Set(mirrorTables);

  try {
    const imported = await copyDatabase(
      mirror,
      primary,
      'Supabase -> Discloud (missing rows only)',
      mirrorTables,
      primaryTableSet,
      { preserveTarget: true },
    );
    logger.info(`Database sync complete: reconciled ${imported.totalRows} Supabase row(s) across ${imported.tables} shared table(s).`);

    const mirrored = await copyDatabase(primary, mirror, 'Discloud -> Supabase', primaryTables, mirrorTableSet);
    logger.info(`Database sync complete: mirrored ${mirrored.totalRows} rows from Discloud to Supabase.`);
  } catch (error) {
    logger.error('Database mirror sync failed:', error);
    if (config.databaseSyncRequired) throw error;
    logger.warn('Database sync is optional for this boot; continuing with Discloud as the primary database.');
  }
}

module.exports = { syncDatabasesOnBoot };
