const { Pool } = require('pg');
const config = require('../config');

const RPC_SIGNATURES = {
  add_level_xp: { args: ['p_guild_id', 'p_user_id', 'p_xp_gain', 'p_message_inc', 'p_vc_inc'] },
  add_voice_xp: { args: ['p_guild_id', 'p_user_id', 'p_voice_xp_gain', 'p_vc_inc'] },
  claim_honeypot_user: { args: ['p_guild_id', 'p_channel_id', 'p_user_id', 'p_message_id', 'p_punishment'] },
  create_guild_backup: { args: ['p_guild_id', 'p_created_by', 'p_label', 'p_source', 'p_snapshot'] },
  create_mod_case: { args: ['p_guild_id', 'p_user_id', 'p_moderator_id', 'p_type', 'p_reason', 'p_expires_at'] },
  create_ticket: { args: ['p_guild_id', 'p_category_id', 'p_opener_id'] },
  increment_activity_stat: { args: ['p_guild_id', 'p_channel_id', 'p_day', 'p_messages_inc', 'p_reactions_inc', 'p_voice_seconds_inc'], returnsVoid: true },
  increment_honeypot_trigger: { args: ['p_guild_id', 'p_channel_id'] },
  increment_invite_stat: { args: ['p_guild_id', 'p_inviter_id', 'p_joins_delta', 'p_leaves_delta'], returnsVoid: true },
  record_roleplay_response: { args: ['p_request_id', 'p_guild_id', 'p_message_id', 'p_channel_id', 'p_actor_id', 'p_target_id', 'p_action', 'p_response'] },
};

function quoteIdentifier(value, label = 'identifier') {
  const text = String(value);
  if (!/^[a-z_][a-z0-9_]*$/i.test(text)) throw new Error(`Invalid PostgreSQL ${label}.`);
  return `"${text.replaceAll('"', '""')}"`;
}

function quoteTable(value) {
  const parts = String(value).split('.');
  if (parts.length > 2 || parts.some((part) => !part)) throw new Error('Invalid PostgreSQL table.');
  return parts.map((part) => quoteIdentifier(part, 'table')).join('.');
}

function parseColumns(value) {
  const columns = String(value || '*').split(',').map((column) => column.trim()).filter(Boolean);
  if (columns.length === 1 && columns[0] === '*') return '*';
  return columns.map((column) => quoteIdentifier(column, 'column')).join(', ');
}

function createPool(connectionString, sslEnabled) {
  let normalizedConnectionString = connectionString;
  if (!sslEnabled) {
    try {
      const url = new URL(connectionString);
      url.searchParams.delete('sslmode');
      normalizedConnectionString = url.toString();
    } catch {
      // Let pg report malformed connection strings with its normal error.
    }
  }

  return new Pool({
    connectionString: normalizedConnectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    max: config.databasePoolMax,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
}

let primaryPool;
let mirrorPool;

function getPrimaryPool() {
  if (!config.primaryDatabaseUrl) throw new Error('DISCLOUD_DATABASE_URL is not configured.');
  if (!primaryPool) primaryPool = createPool(config.primaryDatabaseUrl, config.primaryDatabaseSsl);
  return primaryPool;
}

function getMirrorPool() {
  if (!config.supabaseDatabaseUrl) throw new Error('SUPABASE_DATABASE_URL is not configured.');
  if (!mirrorPool) mirrorPool = createPool(config.supabaseDatabaseUrl, config.supabaseDatabaseSsl);
  return mirrorPool;
}

function addValue(state, value) {
  state.values.push(value);
  return `$${state.values.length}`;
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function buildCondition(condition, state) {
  const column = quoteIdentifier(condition.column, 'column');
  const value = condition.value;

  if (condition.type === 'or') {
    const alternatives = String(condition.expression).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [rawColumn, operator, ...rawValue] = part.split('.');
      if (!rawColumn || !operator) throw new Error('Invalid PostgreSQL OR filter.');
      return buildCondition({
        type: 'filter',
        column: rawColumn,
        operator,
        value: rawValue.join('.'),
      }, state);
    });
    return alternatives.length ? `(${alternatives.join(' OR ')})` : 'FALSE';
  }

  const operator = condition.operator || condition.type;
  if (operator === 'is') {
    if (value === null || value === 'null') return `${column} IS NULL`;
    if (value === true || value === 'true') return `${column} IS TRUE`;
    if (value === false || value === 'false') return `${column} IS FALSE`;
    throw new Error('Unsupported PostgreSQL IS filter value.');
  }

  if (operator === 'in') {
    const values = Array.isArray(value) ? value : [];
    if (!values.length) return 'FALSE';
    return `${column} IN (${values.map((entry) => addValue(state, valueOrNull(entry))).join(', ')})`;
  }

  if (value === null || value === 'null') {
    if (operator === 'eq') return `${column} IS NULL`;
    if (operator === 'neq') return `${column} IS NOT NULL`;
  }

  const sqlOperator = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
  }[operator];
  if (!sqlOperator) throw new Error(`Unsupported PostgreSQL filter operator: ${operator}`);
  return `${column} ${sqlOperator} ${addValue(state, valueOrNull(value))}`;
}

class PostgresQuery {
  constructor(pool, table) {
    this.pool = pool;
    this.table = quoteTable(table);
    this.action = null;
    this.payload = null;
    this.returning = false;
    this.returningColumns = '*';
    this.filters = [];
    this.orders = [];
    this.limitValue = null;
    this.offsetValue = null;
    this.cardinality = null;
    this.countMode = null;
    this.head = false;
  }

  select(columns = '*', options = {}) {
    if (!this.action) this.action = 'select';
    this.returning = true;
    this.returningColumns = columns;
    if (options.count) this.countMode = options.count;
    if (options.head) this.head = true;
    return this;
  }

  insert(values) {
    this.action = 'insert';
    this.payload = values;
    return this;
  }

  update(values) {
    this.action = 'update';
    this.payload = values;
    return this;
  }

  upsert(values, options = {}) {
    this.action = 'upsert';
    this.payload = values;
    this.onConflict = String(options.onConflict || '').split(',').map((column) => column.trim()).filter(Boolean);
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column, value) { this.filters.push({ type: 'eq', column, value }); return this; }
  neq(column, value) { this.filters.push({ type: 'neq', column, value }); return this; }
  gt(column, value) { this.filters.push({ type: 'gt', column, value }); return this; }
  gte(column, value) { this.filters.push({ type: 'gte', column, value }); return this; }
  lt(column, value) { this.filters.push({ type: 'lt', column, value }); return this; }
  lte(column, value) { this.filters.push({ type: 'lte', column, value }); return this; }
  in(column, value) { this.filters.push({ type: 'in', column, value }); return this; }
  is(column, value) { this.filters.push({ type: 'is', column, value }); return this; }
  not(column, operator, value) { this.filters.push({ type: 'not', column, operator, value }); return this; }
  or(expression) { this.filters.push({ type: 'or', expression }); return this; }

  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(value) {
    this.limitValue = Math.max(0, Number(value) || 0);
    return this;
  }

  range(from, to) {
    this.offsetValue = Math.max(0, Number(from) || 0);
    this.limitValue = Math.max(0, (Number(to) || 0) - this.offsetValue + 1);
    return this;
  }

  single() { this.cardinality = 'single'; return this; }
  maybeSingle() { this.cardinality = 'maybeSingle'; return this; }

  buildWhere(state) {
    if (!this.filters.length) return '';
    return ` WHERE ${this.filters.map((filter) => {
      if (filter.type === 'not') return `NOT (${buildCondition({ type: 'filter', column: filter.column, operator: filter.operator, value: filter.value }, state)})`;
      return buildCondition(filter, state);
    }).join(' AND ')}`;
  }

  buildOrder() {
    if (!this.orders.length) return '';
    return ` ORDER BY ${this.orders.map(({ column, ascending }) => `${quoteIdentifier(column, 'order column')} ${ascending ? 'ASC' : 'DESC'}`).join(', ')}`;
  }

  buildReturning() {
    return this.returning ? ` RETURNING ${parseColumns(this.returningColumns)}` : '';
  }

  buildValues(state) {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('PostgreSQL mutations require object rows.');
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))];
    if (!columns.length) throw new Error('PostgreSQL mutations require at least one value.');
    const quotedColumns = columns.map((column) => quoteIdentifier(column, 'column')).join(', ');
    const values = rows.map((row) => `(${columns.map((column) => addValue(state, valueOrNull(row[column]))).join(', ')})`).join(', ');
    return { columns, quotedColumns, values };
  }

  build() {
    const state = { values: [] };
    const where = this.buildWhere(state);
    if (this.action === 'select') {
    }

    if (this.action === 'insert' || this.action === 'upsert') {
      const { columns, quotedColumns, values } = this.buildValues(state);
      let text = `INSERT INTO ${this.table} (${quotedColumns}) VALUES ${values}`;
      if (this.action === 'upsert') {
        const conflict = this.onConflict.length ? ` (${this.onConflict.map((column) => quoteIdentifier(column, 'conflict column')).join(', ')})` : '';
        const updates = columns.filter((column) => !this.onConflict.includes(column));
        text += conflict
          ? (updates.length ? ` ON CONFLICT${conflict} DO UPDATE SET ${updates.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}` : ` ON CONFLICT${conflict} DO NOTHING`)
          : ' ON CONFLICT DO NOTHING';
      }
      return { text: `${text}${this.buildReturning()}`, values: state.values };
    }

    if (this.action === 'update') {
      const payload = this.payload && typeof this.payload === 'object' ? this.payload : {};
      const assignments = Object.keys(payload).filter((key) => payload[key] !== undefined).map((key) => `${quoteIdentifier(key)} = ${addValue(state, valueOrNull(payload[key]))}`);
      if (!assignments.length) throw new Error('PostgreSQL updates require at least one value.');
      return { text: `UPDATE ${this.table} SET ${assignments.join(', ')}${where}${this.buildReturning()}`, values: state.values };
    }

    if (this.action === 'delete') return { text: `DELETE FROM ${this.table}${where}${this.buildReturning()}`, values: state.values };
    throw new Error('PostgreSQL query has no operation.');
  }

  async execute() {
    try {
      const built = this.build();
      const result = await this.pool.query(built.text, built.values);
      if (built.countOnly) return { data: built.head ? null : [{ count: Number(result.rows[0]?.count || 0) }], count: Number(result.rows[0]?.count || 0), error: null };

      let data = this.returning ? result.rows : null;
      if (this.cardinality) {
        if (result.rows.length > 1 || (this.cardinality === 'single' && result.rows.length === 0)) {
          return { data: null, count: null, error: Object.assign(new Error('Expected exactly one row.'), { code: 'PGRST116' }) };
        }
    } catch (error) {
      return { data: null, count: null, error };
    }
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
  finally(callback) { return this.execute().finally(callback); }
}

class PostgresRpc {
  constructor(pool, name, params) {
    this.pool = pool;
    this.name = quoteIdentifier(name, 'function');
    this.functionName = name;
    this.params = params || {};
  }

  async execute() {
    try {
      const signature = RPC_SIGNATURES[this.functionName];
      if (!signature) throw new Error(`Unsupported PostgreSQL RPC: ${this.functionName}`);
      const values = signature.args.map((key) => this.params[key] ?? null);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const text = signature.returnsVoid
        ? `SELECT ${this.name}(${placeholders})`
        : `SELECT * FROM ${this.name}(${placeholders})`;
      const result = await this.pool.query(text, values);
      const data = signature.returnsVoid ? null : (result.rows.length === 1 ? result.rows[0] : result.rows);
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
  finally(callback) { return this.execute().finally(callback); }
}

function createPostgresClient(pool) {
  return {
    from(table) { return new PostgresQuery(pool, table); },
    rpc(name, params) { return new PostgresRpc(pool, name, params); },
  };
}

function closePools() {
  return Promise.all([primaryPool?.end(), mirrorPool?.end()].filter(Boolean));
}

module.exports = {
  createPostgresClient,
  getPrimaryPool,
  getMirrorPool,
  closePools,
};
