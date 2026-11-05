const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// Read by every member update that gives a role, so the rules of a server stay in memory for a short time and every write below forgets them.
const rulesCache = createExpiringCache(30_000);

function listRules(guildId) {
  return rulesCache.get(String(guildId), async () => {
    const { data, error } = await database.from('role_triggers').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  });
}

async function upsertRule(guildId, { roleId, action, durationMs = null, reason = null, on = 'role_added' }) {
  const { data, error } = await database
    .from('role_triggers')
    .upsert({ guild_id: guildId, role_id: roleId, action, duration_ms: durationMs, reason, on_event: on }, { onConflict: 'guild_id,role_id' })
    .select('*')
    .single();
  rulesCache.delete(String(guildId));
  if (error) throw error;
  return data;
}

async function removeRule(guildId, roleId) {
  const { data, error } = await database.from('role_triggers').delete().eq('guild_id', guildId).eq('role_id', roleId).select('role_id');
  rulesCache.delete(String(guildId));
  if (error) throw error;
  return data.length > 0;
}

const limitCache = createExpiringCache(30_000);

/** How many actions a minute the circuit breaker of the server allows, when the server chose one (null: the default for its size). */
function getLimit(guildId) {
  return limitCache.get(String(guildId), async () => {
    const { data, error } = await database.from('role_trigger_settings').select('max_actions').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    const value = Number(data?.max_actions);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
}

async function setLimit(guildId, maxActions) {
  const { error } = await database.from('role_trigger_settings').upsert({ guild_id: guildId, max_actions: maxActions, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  limitCache.delete(String(guildId));
  if (error) throw error;
}

async function clearLimit(guildId) {
  const { error } = await database.from('role_trigger_settings').delete().eq('guild_id', guildId);
  limitCache.delete(String(guildId));
  if (error) throw error;
}

/** The ids of the servers that have at least one rule (one query, for the start of the bot). */
async function guildIdsWithRules() {
  const { data, error } = await database.from('role_triggers').select('guild_id');
  if (error) throw error;
  return [...new Set(data.map((row) => row.guild_id))];
}

module.exports = { listRules, upsertRule, removeRule, guildIdsWithRules, getLimit, setLimit, clearLimit };
