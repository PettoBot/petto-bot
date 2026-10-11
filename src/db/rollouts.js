const database = require('./database');

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  role_id: null,
  style: 'card',
  embed_template: null,
  kinds: [],
  events: [],
  min_change: 0,
  include_unrolled: false,
  hide_sections: [],
  accent_color: null,
  type_templates: {},
};

async function getConfig(guildId) {
  const { data, error } = await database.from('rollout_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data, min_change: Number(data.min_change) || 0 } : null;
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database
    .from('rollout_config')
    .upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return { ...DEFAULTS, ...data, min_change: Number(data.min_change) || 0 };
}

async function listEnabledConfigs() {
  const { data, error } = await database.from('rollout_config').select('*').eq('enabled', true).not('channel_id', 'is', null);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...DEFAULTS, ...row, min_change: Number(row.min_change) || 0 }));
}

/** What was true of every experiment last time, by id. */
async function loadState() {
  const { data, error } = await database.from('rollout_state').select('rollout_id, snapshot');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.rollout_id, row.snapshot]));
}

async function saveState(entries) {
  if (!entries.length) return;
  const rows = entries.map(([id, snapshot]) => ({ rollout_id: id, snapshot, updated_at: new Date().toISOString() }));
  // In pieces, so a first read of hundreds of experiments is not one huge statement.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await database.from('rollout_state').upsert(rows.slice(i, i + 200), { onConflict: 'rollout_id' });
    if (error) throw error;
  }
}

/** Puts events in the queue of a server. The same news (same key) is kept once. */
async function enqueue(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await database.from('rollout_queue').upsert(rows.slice(i, i + 200), { onConflict: 'guild_id,event_key' });
    if (error) throw error;
  }
}

/** The servers that have something waiting. */
async function pendingGuilds() {
  const { data, error } = await database.from('rollout_queue').select('guild_id').order('id', { ascending: true }).limit(1000);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.guild_id))];
}

async function countPending(guildId) {
  const { data, error } = await database.from('rollout_queue').select('id').eq('guild_id', String(guildId)).limit(5000);
  if (error) throw error;
  return (data ?? []).length;
}

/** The oldest `limit` events waiting for a server. */
async function peek(guildId, limit) {
  const { data, error } = await database.from('rollout_queue').select('*').eq('guild_id', String(guildId)).order('id', { ascending: true }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function removeQueued(ids) {
  if (!ids.length) return;
  const { error } = await database.from('rollout_queue').delete().in('id', ids);
  if (error) throw error;
}

async function markFailed(ids, attempts) {
  for (const id of ids) {
    const { error } = await database.from('rollout_queue').update({ attempts }).eq('id', id);
    if (error) throw error;
  }
}

async function clearGuildQueue(guildId) {
  const { error } = await database.from('rollout_queue').delete().eq('guild_id', String(guildId));
  if (error) throw error;
}

/** Forgets what has waited longer than `hours`: news that old is not news. */
async function dropOlderThan(hours) {
  const { error } = await database.from('rollout_queue').delete().lt('created_at', new Date(Date.now() - hours * 3_600_000).toISOString());
  if (error) throw error;
}

module.exports = { DEFAULTS, getConfig, upsertConfig, listEnabledConfigs, loadState, saveState, enqueue, pendingGuilds, countPending, peek, removeQueued, markFailed, clearGuildQueue, dropOlderThan };
