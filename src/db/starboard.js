const supabase = require('./supabase');

const DEFAULTS = {
  threshold: 3,
  emoji: '⭐',
  selfstar: false,
  color: 0xffc107,
  timestamp: true,
  jumpurl: true,
  attachments: true,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  ignored_user_ids: [],
};

async function getConfig(guildId) {
  const { data, error } = await supabase.from('starboards').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : null;
}

async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;
  const { data, error } = await supabase.from('starboards').insert({ guild_id: guildId, ...DEFAULTS }).select('*').single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

async function updateConfig(guildId, changes) {
  const { data, error } = await supabase.from('starboards').upsert({ guild_id: guildId, ...changes }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

async function disable(guildId) {
  const { error: entriesError } = await supabase.from('starboard_entries').delete().eq('guild_id', guildId);
  if (entriesError) throw entriesError;
  const { error } = await supabase.from('starboards').delete().eq('guild_id', guildId);
  if (error) throw error;
}

async function getEntry(guildId, sourceMessageId) {
  const { data, error } = await supabase.from('starboard_entries').select('*').eq('guild_id', guildId).eq('source_message_id', sourceMessageId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveEntry({ guildId, sourceMessageId, starboardMessageId, count }) {
  const { data, error } = await supabase.from('starboard_entries').upsert({ guild_id: guildId, source_message_id: sourceMessageId, starboard_message_id: starboardMessageId, count, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,source_message_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function removeEntry(guildId, sourceMessageId) {
  const { error } = await supabase.from('starboard_entries').delete().eq('guild_id', guildId).eq('source_message_id', sourceMessageId);
  if (error) throw error;
}

module.exports = { DEFAULTS, getConfig, ensureConfig, updateConfig, disable, getEntry, saveEntry, removeEntry };
