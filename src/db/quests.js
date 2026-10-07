const database = require('./database');

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  role_id: null,
  style: 'card',
  embed_template: null,
  reward_kinds: [],
  task_kinds: [],
  hide_sections: [],
  accent_color: null,
  expiring_hours: 0,
  auto_thread: false,
  thread_name: null,
  thread_ping: false,
  thread_archive: 1440,
  method_enabled: false,
  method_template: null,
  method_text: null,
  method_target: 'thread',
  method_channel_id: null,
  method_ping: false,
  type_templates: {},
  method_type_templates: {},
};

async function getConfig(guildId) {
  const { data, error } = await database.from('quest_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : null;
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database
    .from('quest_config')
    .upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

async function listEnabledConfigs() {
  const { data, error } = await database.from('quest_config').select('*').eq('enabled', true).not('channel_id', 'is', null);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...DEFAULTS, ...row }));
}

async function listSeenIds() {
  const { data, error } = await database.from('quest_seen').select('quest_id');
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.quest_id));
}

async function markSeen(quests) {
  if (!quests.length) return;
  const rows = quests.map((quest) => ({ quest_id: quest.id, expires_at: quest.expiresAt.toISOString() }));
  const { error } = await database.from('quest_seen').upsert(rows, { onConflict: 'quest_id' });
  if (error) throw error;
}

async function hasPost(guildId, questId, kind) {
  const { data, error } = await database.from('quest_posts').select('quest_id').eq('guild_id', String(guildId)).eq('quest_id', questId).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function savePost(guildId, questId, kind, messageId) {
  const { error } = await database
    .from('quest_posts')
    .upsert({ guild_id: String(guildId), quest_id: questId, kind, message_id: messageId ?? null }, { onConflict: 'guild_id,quest_id,kind' });
  if (error) throw error;
}

/** The row of a posted alert (its message id), or null. */
async function getPost(guildId, questId, kind) {
  const { data, error } = await database.from('quest_posts').select('*').eq('guild_id', String(guildId)).eq('quest_id', questId).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

module.exports = { DEFAULTS, getPost, getConfig, upsertConfig, listEnabledConfigs, listSeenIds, markSeen, hasPost, savePost };
