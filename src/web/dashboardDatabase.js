const config = require('../config');
const { createPostgresClient, getPrimaryPool, getMirrorPool } = require('../db/postgres');
const logger = require('../utils/logger');

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const FILTER_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is']);
const RESERVED_QUERY_KEYS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const DASHBOARD_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DASHBOARD_RATE_LIMIT_MAX = 120;
const dashboardRateLimitBuckets = new Map();

function fallbackDashboardRateLimiter(req, res, next) {
  const now = Date.now();
  const key = String(req.ip || req.connection?.remoteAddress || 'unknown');
  const bucket = dashboardRateLimitBuckets.get(key);

  if (!bucket || now - bucket.startedAt >= DASHBOARD_RATE_LIMIT_WINDOW_MS) {
    dashboardRateLimitBuckets.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }

  if (bucket.count >= DASHBOARD_RATE_LIMIT_MAX) {
    res.status(429).json({ code: 'PGRST429', message: 'Too many requests.' });
    return;
  }

  bucket.count += 1;
  next();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function quoteIdentifier(value, label = 'identifier') {
  const text = String(value);
  if (!IDENTIFIER.test(text)) throw new Error(`Invalid PostgreSQL ${label}.`);
  return `"${text.replaceAll('"', '""')}"`;
}

function quoteTable(value) {
  return `"public".${quoteIdentifier(value, 'table')}`;
}

function splitOutsideParentheses(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) throw new Error('Invalid select expression.');
    if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error('Invalid select expression.');
  const finalPart = value.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function parseSelect(rawValue) {
  const raw = String(rawValue || '*').trim();
  const fields = [];
  const embeds = [];
  for (const part of splitOutsideParentheses(raw)) {
    const embed = /^([a-z_][a-z0-9_]*)\(([^()]*)\)$/i.exec(part);
    if (embed) {
      const embedFields = embed[2].split(',').map((field) => field.trim()).filter(Boolean);
      if (!embedFields.length || embedFields.some((field) => !IDENTIFIER.test(field))) {
        throw new Error('Invalid nested select expression.');
      }
      embeds.push({ name: embed[1], fields: embedFields });
      continue;
    }
    if (part !== '*' && !IDENTIFIER.test(part)) throw new Error('Invalid select column.');
    fields.push(part);
  }

  const all = fields.includes('*') || fields.length === 0;
  const databaseFields = all ? ['*'] : [...fields];
  // PostgREST includes the foreign-key source column internally when a nested
  // relation is requested. We need the same source value to build the response.
  if (embeds.some((embed) => embed.name === 'ticket_categories') && !all && !databaseFields.includes('category_id')) {
    databaseFields.push('category_id');
  }

  return {
    all,
    fields: fields.filter((field) => field !== '*'),
    embeds,
    databaseSelect: databaseFields.join(','),
  };
}

function parseFilter(value) {
  const text = String(value);
  const match = /^([a-z]+)\.(.*)$/i.exec(text);
  if (!match || !FILTER_OPERATORS.has(match[1].toLowerCase())) throw new Error('Invalid PostgreSQL filter.');
  const operator = match[1].toLowerCase();
  let operand = match[2];

  if (operator === 'in') {
    if (!operand.startsWith('(') || !operand.endsWith(')')) throw new Error('Invalid PostgreSQL IN filter.');
    operand = operand.slice(1, -1).split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.replace(/^"(.*)"$/, '$1'));
    return { operator, value: operand };
  }
  if (operator === 'is') {
    if (!['null', 'true', 'false'].includes(operand.toLowerCase())) throw new Error('Invalid PostgreSQL IS filter.');
    return { operator, value: operand.toLowerCase() };
  }
  return { operator, value: operand };
}

function applyFilters(query, queryParameters) {
  for (const [column, rawValue] of Object.entries(queryParameters)) {
    if (RESERVED_QUERY_KEYS.has(column) || column === 'or' || column === 'and' || column.startsWith('not.')) continue;
    if (Array.isArray(rawValue)) throw new Error('Duplicate query filters are not supported.');
    const parsed = parseFilter(rawValue);
    if (parsed.operator === 'in') query.in(column, parsed.value);
    else if (parsed.operator === 'is') query.is(column, parsed.value);
    else query[parsed.operator](column, parsed.value);
  }

  const orValue = first(queryParameters.or);
  if (orValue) {
    const expression = String(orValue).replace(/^\((.*)\)$/, '$1');
    query.or(expression);
  }

  for (const rawOrder of String(first(queryParameters.order) || '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const [column, direction = 'asc'] = rawOrder.split('.');
    if (!IDENTIFIER.test(column) || !['asc', 'desc'].includes(direction.toLowerCase())) throw new Error('Invalid PostgreSQL order.');
    query.order(column, { ascending: direction.toLowerCase() !== 'desc' });
  }
}

function requestedRange(req) {
  const header = req.get('range');
  const match = header && /^(\d+)-(\d+)$/.exec(header.trim());
  if (match) return { from: Number(match[1]), to: Number(match[2]) };

  const offset = Number(first(req.query.offset));
  const limit = Number(first(req.query.limit));
  if (Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0) {
    return { from: offset, to: offset + limit - 1 };
  }
  return null;
}

function preferences(req) {
  const value = req.get('prefer') || '';
  return new Set(value.split(',').map((part) => part.trim()).filter(Boolean));
}

function projectRows(rows, selection) {
  if (selection.all) return rows;
  return rows.map((row) => {
    const projected = {};
    for (const field of selection.fields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) projected[field] = row[field];
    }
    for (const embed of selection.embeds) {
      if (Object.prototype.hasOwnProperty.call(row, embed.name)) projected[embed.name] = row[embed.name];
    }
    return projected;
  });
}

async function attachTicketCategoryEmbed(pool, rows, selection) {
  const ticketEmbed = selection.embeds.find((embed) => embed.name === 'ticket_categories');
  if (!ticketEmbed) return;
  if (selection.embeds.length !== 1 || ticketEmbed.fields.some((field) => field !== 'label')) {
    throw new Error('Only ticket_categories(label) is supported by the dashboard API.');
  }

  const ids = [...new Set(rows.map((row) => Number(row.category_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const categories = new Map();
  if (ids.length) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const result = await pool.query(
      `SELECT "id", "label" FROM ${quoteTable('ticket_categories')} WHERE "id" IN (${placeholders})`,
      ids,
    );
    for (const category of result.rows) categories.set(String(category.id), { label: category.label });
  }
  for (const row of rows) row.ticket_categories = categories.get(String(row.category_id)) || null;
}

async function primaryKeyColumns(pool, table) {
  const result = await pool.query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_name = tc.table_name
      WHERE tc.constraint_schema = 'public'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function mirrorMutation({ method, table, body, queryParameters, onConflict, primaryRows }) {
  const mirror = getMirrorPool();
  const client = createPostgresClient(mirror);
  const query = client.from(table);

  if (method === 'POST') {
    if (!primaryRows.length) return;
    const conflict = onConflict.length ? onConflict : await primaryKeyColumns(mirror, table);
    if (!conflict.length) {
      logger.warn(`Dashboard write to ${table} was not mirrored because the table has no primary key.`);
      return;
    }
    query.upsert(primaryRows, { onConflict: conflict.join(',') });
  } else if (method === 'PATCH') {
    query.update(body);
  } else if (method === 'DELETE') {
    query.delete();
  } else {
    return;
  }

  applyFilters(query, queryParameters);
  const result = await query.select('*');
  if (result.error) throw result.error;
}

function responseError(res, error) {
  const status = error?.code === 'PGRST116' ? 406 : error?.code === '23505' ? 409 : 400;
  res.status(status).json({ code: error?.code || 'dashboard_database_error', message: 'Database request could not be completed.' });
}

function dashboardAuthorized(req) {
  const explicit = req.get('x-petto-dashboard-key');
  const apiKey = req.get('apikey');
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(config.dashboardApiSecret && [explicit, apiKey, bearer].some((candidate) => candidate === config.dashboardApiSecret));
}

async function handleDashboardRest(req, res) {
  if (!dashboardAuthorized(req)) {
    res.status(401).json({ code: 'PGRST301', message: 'Invalid dashboard credentials.' });
    return;
  }

  const table = String(req.params.table || '');
  if (!IDENTIFIER.test(table)) {
    res.status(400).json({ code: 'PGRST100', message: 'Invalid table name.' });
    return;
  }

  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    res.status(405).set('Allow', 'GET,HEAD,POST,PATCH,DELETE').json({ code: 'PGRST117', message: 'Method not allowed.' });
    return;
  }

  try {
    const primaryPool = getPrimaryPool();
    const client = createPostgresClient(primaryPool);
    const selection = parseSelect(first(req.query.select));
    const preference = preferences(req);
    const countExact = preference.has('count=exact');
    const range = requestedRange(req);
    const query = client.from(table);
    let mutation = false;
    const onConflict = String(first(req.query.on_conflict) || '').split(',').map((column) => column.trim()).filter(Boolean);

    if (method === 'GET' || method === 'HEAD') {
      query.select(selection.databaseSelect, { count: countExact ? 'exact' : undefined, head: method === 'HEAD' });
    } else {
      mutation = true;
      const body = req.body;
      if (method === 'POST') {
        const resolution = [...preference].some((item) => item === 'resolution=merge-duplicates');
        if (resolution) query.upsert(body, { onConflict: onConflict.join(',') });
        else query.insert(body);
      } else if (method === 'PATCH') {
        query.update(body);
      } else {
        query.delete();
      }
      // Always return full rows internally so generated IDs/defaults can be
      // mirrored exactly. The Prefer header still controls the public response.
      query.select('*');
    }

    applyFilters(query, req.query);
    if (range) query.range(range.from, range.to);
    else if (first(req.query.limit) !== undefined) query.limit(Math.min(1000, Math.max(0, Number(first(req.query.limit)) || 0)));

    const result = await query;
    if (result.error) {
      logger.error(`Dashboard database ${method} ${table} failed:`, result.error);
      responseError(res, result.error);
      return;
    }

    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (!mutation && selection.embeds.length) await attachTicketCategoryEmbed(primaryPool, rows, selection);

    if (mutation) {
      try {
        await mirrorMutation({ method, table, body: req.body, queryParameters: req.query, onConflict, primaryRows: rows });
      } catch (mirrorError) {
        // The primary write already succeeded. The next bot boot performs the
        // complete primary-to-mirror repair, so a transient mirror failure must
        // never make the dashboard repeat a committed write.
        logger.error(`Dashboard database mirror failed for ${method} ${table}:`, mirrorError);
      }
    }

    const total = result.count == null ? '*' : String(result.count);
    if (method === 'GET' || method === 'HEAD') {
      const start = range?.from ?? 0;
      const end = rows.length ? start + rows.length - 1 : start;
      res.set('Content-Range', `${start}-${end}/${total}`);
      if (method === 'HEAD') {
        res.status(range || countExact ? 206 : 200).end();
        return;
      }
      res.status(range || countExact ? 206 : 200).json(projectRows(rows, selection));
      return;
    }

    const returnRepresentation = [...preference].some((item) => item === 'return=representation');
    if (!returnRepresentation) {
      res.status(method === 'POST' ? 201 : 204).end();
      return;
    }
    res.status(method === 'POST' ? 201 : 200).json(projectRows(rows, parseSelect(first(req.query.select))));
  } catch (error) {
    logger.error(`Dashboard database request failed for ${req.method} ${req.params.table}:`, error);
    if (error?.message?.startsWith('Invalid ') || error?.message?.includes('not supported')) {
      responseError(res, error);
      return;
    }
    res.status(503).json({ code: 'PGRST000', message: 'Dashboard database is unavailable.' });
  }
}

function registerDashboardRestRoutes(app, rateLimiter) {
  const effectiveLimiter = typeof rateLimiter === 'function' ? rateLimiter : fallbackDashboardRateLimiter;
  app.all('/rest/v1/:table', effectiveLimiter, handleDashboardRest);
}

module.exports = { registerDashboardRestRoutes };
