// The prefixes people chose for themselves. They are all kept in memory (the table is small), so reading one for a message costs nothing.
const { getPrimaryPool } = require('./postgres');

const REFRESH_MS = 5 * 60_000;
let cache = null; // Map userId -> prefix
let loadedAt = 0;
let loading = null;

async function load() {
  const { rows } = await getPrimaryPool().query('select user_id, prefix from user_prefixes');
  cache = new Map(rows.map((row) => [row.user_id, row.prefix]));
  loadedAt = Date.now();
  return cache;
}

async function all() {
  if (cache && Date.now() - loadedAt < REFRESH_MS) return cache;
  loading ??= load().finally(() => { loading = null; });
  try { return await loading; } catch { return cache ?? new Map(); }
}

async function get(userId) {
  return (await all()).get(String(userId)) ?? null;
}

async function set(userId, prefix) {
  await getPrimaryPool().query(
    `insert into user_prefixes (user_id, prefix) values ($1, $2) on conflict (user_id) do update set prefix = excluded.prefix, updated_at = now()`,
    [String(userId), prefix],
  );
  (await all()).set(String(userId), prefix);
}

async function remove(userId) {
  const { rowCount } = await getPrimaryPool().query('delete from user_prefixes where user_id = $1', [String(userId)]);
  (await all()).delete(String(userId));
  return rowCount > 0;
}

module.exports = { get, set, remove };
