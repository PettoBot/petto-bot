// i18n-ignore-file: SQL for the disabled-command rules; nothing here is shown to a member.
// Disabled commands (!disablecommand, and the dashboard's Automation → Disabled commands): one row per command and place.
//   disabled_commands (guild_id, command, channel_id)   channel_id null = the whole server
// `command` is always the real name of the command in lower case (never an alias), the same for the bot and the website, and
// a rule exists once (unique on guild, command and channel; see schema.sql).
const { getPrimaryPool } = require('./postgres');

const query = (sql, params) => getPrimaryPool().query(sql, params);

/** A server-wide rule, or the rule of `channelId`, for the command. Without `channelId` only a server-wide rule counts. */
async function find(guildId, command, channelId) {
  const { rows } = await query(
    'select * from disabled_commands where guild_id = $1 and command = $2 and (channel_id is null or channel_id = $3) order by channel_id nulls first limit 1',
    [String(guildId), command, channelId ? String(channelId) : null],
  );
  return rows[0] ?? null;
}

async function listForGuild(guildId) {
  const { rows } = await query('select id, guild_id, command, channel_id from disabled_commands where guild_id = $1 order by command, channel_id nulls first', [String(guildId)]);
  return rows;
}

/** One rule. Returns the row, or null when it was there already. */
async function disable(guildId, command, channelId) {
  const [row] = await disableMany(guildId, [command], [channelId ?? null]);
  return row ?? null;
}

/**
 * Every command in every place given (null = the whole server) in one query. Returns the rules that are new; the ones that
 * existed already are left as they were.
 */
async function disableMany(guildId, commands, channelIds = [null]) {
  const pairs = [];
  for (const command of commands) for (const channelId of channelIds) pairs.push([command, channelId ? String(channelId) : null]);
  if (!pairs.length) return [];
  const { rows } = await query(
    `insert into disabled_commands (guild_id, command, channel_id)
     select $1, c, nullif(ch, '') from unnest($2::text[], $3::text[]) as p(c, ch)
     on conflict (guild_id, command, (coalesce(channel_id, ''))) do nothing
     returning id, command, channel_id`,
    [String(guildId), pairs.map((p) => p[0]), pairs.map((p) => p[1] ?? '')],
  );
  invalidateCache(guildId);
  return rows;
}

/**
 * Removes the rule of the command in `channelId`, or, with `channelId` null, its server-wide rule. `everywhere: true` removes every
 * rule of the command (server-wide and every channel). Returns how many rules went.
 */
async function enable(guildId, command, channelId, { everywhere = false } = {}) {
  const removed = await enableMany(guildId, [command], everywhere ? null : [channelId ?? null]);
  return removed.length;
}

/** Removes the rules of these commands in these places (null entries = the server-wide rule), or in every place when `channelIds` is null. */
async function enableMany(guildId, commands, channelIds = null) {
  if (!commands.length) return [];
  const params = [String(guildId), commands];
  let where = '';
  if (channelIds) {
    const ids = channelIds.filter(Boolean).map(String);
    const server = channelIds.some((id) => !id);
    params.push(ids);
    where = ` and (channel_id = any($3::text[])${server ? ' or channel_id is null' : ''})`;
  }
  const { rows } = await query(`delete from disabled_commands where guild_id = $1 and command = any($2::text[])${where} returning id, command, channel_id`, params);
  invalidateCache(guildId);
  return rows;
}

/** Removes every rule of a server, or only the ones of `channelId`. Returns how many there were. */
async function clear(guildId, channelId = null) {
  const { rowCount } = channelId
    ? await query('delete from disabled_commands where guild_id = $1 and channel_id = $2', [String(guildId), String(channelId)])
    : await query('delete from disabled_commands where guild_id = $1', [String(guildId)]);
  invalidateCache(guildId);
  return rowCount;
}

/**
 * Rewrites rules saved with an alias or an odd spelling (`SUG`, `!sug`) to the real name of the command, as the check only
 * looks for real names. `resolve(name)` gives the real name, or null to leave the row as it is. Safe to run again: a rule
 * that would repeat one already there is dropped instead. Returns how many rows changed.
 */
async function canonicalizeStored(resolve) {
  const { rows } = await query('select id, guild_id, command, channel_id from disabled_commands order by id');
  const key = (row, command) => `${row.guild_id}|${command}|${row.channel_id ?? ''}`;
  const taken = new Set(rows.map((row) => key(row, row.command)));
  const drop = [];
  const rename = [];
  for (const row of rows) {
    const real = resolve(row.command);
    if (!real || real === row.command) continue;
    if (taken.has(key(row, real))) drop.push(row.id);
    else { taken.add(key(row, real)); rename.push([row.id, real]); }
  }
  if (drop.length) await query('delete from disabled_commands where id = any($1::bigint[])', [drop]);
  for (const [id, real] of rename) await query('update disabled_commands set command = $2 where id = $1', [id, real]);
  if (drop.length || rename.length) cache.clear();
  return drop.length + rename.length;
}

// Read on every command, and almost no server has rules (they change rarely), so the rules of a server stay in memory a while.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // guildId -> { rows, expiresAt }

async function listForGuildCached(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > Date.now()) return hit.rows;
  const rows = await listForGuild(guildId);
  cache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

function invalidateCache(guildId) {
  cache.delete(String(guildId));
  cache.delete(guildId);
}

/** Same result as `find()`, from the server's cached rules. A server-wide rule wins over a channel rule. */
async function findCached(guildId, command, channelId) {
  const rows = await listForGuildCached(guildId);
  return rows.find((r) => r.command === command && r.channel_id === null)
    ?? rows.find((r) => r.command === command && channelId && r.channel_id === String(channelId))
    ?? null;
}

module.exports = { find, listForGuild, disable, disableMany, enable, enableMany, clear, canonicalizeStored, findCached, invalidateCache };
