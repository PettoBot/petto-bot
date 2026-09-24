const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { TRANSIENT_STATUS_CODES, sleep, retryDelayMs } = require('../utils/transientDb');
const { createPostgresClient, getPrimaryPool } = require('./postgres');

const READ_ATTEMPTS = 3;

function requestMethod(input, init) {
  return String(init?.method ?? input?.method ?? 'GET').toUpperCase();
}

function retryAfterMs(response, attempt) {
  const header = response?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 100), 5_000);

    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 100), 5_000);
  }
  return retryDelayMs(attempt);
}

/**
 * Supabase/PostgREST occasionally answers reads with a transient 429/502/503/504.
 * Retrying GET/HEAD requests is safe because they cannot duplicate writes.
 * Writes are deliberately NOT retried here: a gateway timeout can happen after
 * PostgreSQL committed the write, so blindly replaying a POST/RPC could double XP,
 * duplicate cases, etc.
 */
async function resilientFetch(input, init = {}) {
  const method = requestMethod(input, init);
  const retryableMethod = method === 'GET' || method === 'HEAD';
  if (!retryableMethod) return fetch(input, init);

  let lastError = null;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt === READ_ATTEMPTS - 1) return response;
      await sleep(retryAfterMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === READ_ATTEMPTS - 1) throw error;
      await sleep(retryDelayMs(attempt));
    }
  }

  throw lastError;
}

const supabaseRest = config.supabaseUrl && config.supabaseServiceRoleKey
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: resilientFetch,
    },
  })
  : null;

// Keep the existing module contract so the many feature-specific DB modules do
// not need to change their query code. In migration mode, all runtime reads and
// writes go directly to Discloud PostgreSQL; the Supabase REST client remains
// available only for the legacy single-Supabase mode.
const supabase = config.primaryDatabaseUrl
  ? createPostgresClient(getPrimaryPool())
  : supabaseRest;

if (!supabase) throw new Error('No database client is configured. Set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or DISCLOUD_DATABASE_URL.');

module.exports = supabase;
