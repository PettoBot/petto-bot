// The settings of the message link embeds of a server (table message_link_settings): off unless the server turned it on.
//
// Every message that holds a message link asks whether the server has it on, so the answer is kept in memory: a small Map (at most
// MAX_GUILDS servers, the oldest goes first) where a server that has it off is only `false`, so a server that never uses it costs a
// few bytes and no database query per message. An entry lives FLAG_TTL_MS; a change made with the command forgets it at once and one
// made in the dashboard arrives on petto:invalidate (see cacheInvalidation.js), so the TTL is only the safety net.
const database = require('./database');
const { ensureGuild } = require('./guilds');
const { registerCache } = require('../utils/cacheInvalidation');

const MAX_IGNORED = 50;
const MAX_GUILDS = 5000;
const FLAG_TTL_MS = 5 * 60 * 1000;

const flags = new Map(); // guildId -> { value: false | { ignored_channels: string[] }, expiresAt }
const loading = new Map(); // guildId -> Promise (one query for the messages that arrive together)

function remember(guildId, value) {
  flags.delete(guildId);
  flags.set(guildId, { value, expiresAt: Date.now() + FLAG_TTL_MS });
  while (flags.size > MAX_GUILDS) flags.delete(flags.keys().next().value);
}

const forget = (guildId) => { flags.delete(String(guildId)); loading.delete(String(guildId)); };
registerCache({ delete: forget, deleteWhere: () => 0 }, ['message_link_settings']);

/**
 * `false` when the server has the embeds off (the default), or `{ ignored_channels }` when on. A failed read is not cached and throws,
 * so nothing is shown while the database is down.
 */
function getSettings(guildId) {
  const id = String(guildId);
  const hit = flags.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (loading.has(id)) return loading.get(id);
  const request = Promise.resolve(database.from('message_link_settings').select('enabled, ignored_channels').eq('guild_id', id).maybeSingle())
    .then(({ data, error }) => {
      if (error) throw error;
      const value = data?.enabled === true ? { ignored_channels: Array.isArray(data.ignored_channels) ? data.ignored_channels.map(String) : [] } : false;
      remember(id, value);
      return value;
    })
    .finally(() => { if (loading.get(id) === request) loading.delete(id); });
  loading.set(id, request);
  return request;
}

/** The ignored channels of a server whether it is on or off (for `!messagelinks status` and the list commands). Not cached. */
async function readAll(guildId) {
  const { data, error } = await database.from('message_link_settings').select('enabled, ignored_channels').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return { enabled: data?.enabled === true, ignored_channels: Array.isArray(data?.ignored_channels) ? data.ignored_channels.map(String) : [] };
}

async function save(guildId, patch) {
  await ensureGuild(guildId);
  const { error } = await database.from('message_link_settings').upsert({ guild_id: String(guildId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
  forget(guildId);
}

const setEnabled = (guildId, enabled) => save(guildId, { enabled: Boolean(enabled) });

/** Adds a channel to the ignored ones. Answers `{ ok, list }`; `ok` is false when it was already there or the list is full. */
async function ignoreChannel(guildId, channelId) {
  const current = (await readAll(guildId)).ignored_channels;
  if (current.includes(String(channelId))) return { ok: false, reason: 'already', list: current };
  if (current.length >= MAX_IGNORED) return { ok: false, reason: 'full', list: current };
  const list = [...current, String(channelId)];
  await save(guildId, { ignored_channels: list });
  return { ok: true, list };
}

/** Takes a channel off the ignored ones. `ok` is false when it was not there. */
async function unignoreChannel(guildId, channelId) {
  const current = (await readAll(guildId)).ignored_channels;
  if (!current.includes(String(channelId))) return { ok: false, reason: 'missing', list: current };
  const list = current.filter((id) => id !== String(channelId));
  await save(guildId, { ignored_channels: list });
  return { ok: true, list };
}

/** How many servers are remembered (for the memory check). */
const cachedGuilds = () => flags.size;

module.exports = { getSettings, readAll, setEnabled, ignoreChannel, unignoreChannel, cachedGuilds, MAX_IGNORED, MAX_GUILDS, FLAG_TTL_MS };
