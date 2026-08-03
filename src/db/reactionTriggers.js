const supabase = require('./supabase');

const MAX_TRIGGER_LENGTH = 80;
const MAX_EMOJIS_PER_CHANNEL = 3;
const CACHE_TTL_MS = 30_000;
const triggerCache = new Map();
const messageConfigCache = new Map();

// Broad, one-word triggers would make every message hit the database and are
// intentionally rejected, matching Bleed's load-safety rule while allowing
// useful phrases such as "good morning" or "gg".
const COMMON_TRIGGERS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from',
  'get', 'go', 'have', 'he', 'hey', 'hi', 'i', 'if', 'in', 'is', 'it', 'me', 'my',
  'no', 'of', 'on', 'or', 'our', 'so', 'that', 'the', 'this', 'to', 'was', 'we',
  'what', 'when', 'where', 'who', 'why', 'will', 'with', 'you', 'your',
]);

function normalizeTrigger(trigger) {
  return String(trigger ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_TRIGGER_LENGTH);
}

function validateTrigger(trigger) {
  const normalized = normalizeTrigger(trigger);
  if (!normalized) throw new Error('Provide a trigger phrase.');
  if (normalized.length < 2) throw new Error('A trigger must contain at least two characters.');
  if (COMMON_TRIGGERS.has(normalized)) throw new Error('That trigger is too common. Use a more specific word or phrase.');
  return normalized;
}

function normalizeEmoji(emoji) {
  return String(emoji ?? '').trim().slice(0, 100);
}

async function addTrigger({ guildId, emoji, trigger, ownerId, matchMode = 'contains', channelIds = [], roleIds = [], caseSensitive = false, cooldownSeconds = 0 }) {
  const normalizedTrigger = validateTrigger(trigger);
  const normalizedEmoji = normalizeEmoji(emoji);
  if (!normalizedEmoji) throw new Error('Provide an emoji.');

  const { data, error } = await supabase
    .from('reaction_triggers')
    .insert({ guild_id: guildId, emoji: normalizedEmoji, trigger: normalizedTrigger, owner_id: ownerId, match_mode: matchMode, channel_ids: channelIds, role_ids: roleIds, case_sensitive: caseSensitive, cooldown_seconds: cooldownSeconds })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That emoji and trigger are already configured.');
    throw error;
  }
  triggerCache.delete(guildId);
  return data;
}

async function updateTrigger(guildId, id, patch) {
  const { data, error } = await supabase.from('reaction_triggers').update(patch).eq('guild_id', guildId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  triggerCache.delete(guildId);
  return data;
}

async function getTrigger(guildId, emoji, trigger) {
  const { data, error } = await supabase
    .from('reaction_triggers')
    .select('*')
    .eq('guild_id', guildId)
    .eq('emoji', normalizeEmoji(emoji))
    .eq('trigger', normalizeTrigger(trigger))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOwner(guildId, trigger) {
  const { data, error } = await supabase
    .from('reaction_triggers')
    .select('owner_id')
    .eq('guild_id', guildId)
    .eq('trigger', normalizeTrigger(trigger))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listTriggers(guildId) {
  const { data, error } = await supabase.from('reaction_triggers').select('*').eq('guild_id', guildId).order('trigger').order('emoji');
  if (error) throw error;
  return data ?? [];
}

async function listTriggersCached(guildId) {
  const cached = triggerCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await listTriggers(guildId);
  triggerCache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

async function listMatchingTriggers(guildId, { content, channelId, roleIds = [], userId } = {}) {
  const rows = await listTriggersCached(guildId);
  const rawText = String(content ?? '');
  return rows.filter((row) => {
    if (row.enabled === false) return false;
    if (row.channel_ids?.length && !row.channel_ids.includes(channelId)) return false;
    if (row.role_ids?.length && !row.role_ids.some((id) => roleIds.includes(id))) return false;
    const text = row.case_sensitive ? rawText : rawText.toLowerCase();
    const trigger = row.case_sensitive ? row.trigger : row.trigger.toLowerCase();
    switch (row.match_mode ?? 'contains') {
      case 'startsWith': return text.startsWith(trigger);
      case 'endsWith': return text.endsWith(trigger);
      case 'exact': return text === trigger;
      default: return text.includes(trigger);
    }
  });
}

async function removeTrigger(guildId, emoji, trigger) {
  const { data, error } = await supabase
    .from('reaction_triggers')
    .delete()
    .eq('guild_id', guildId)
    .eq('emoji', normalizeEmoji(emoji))
    .eq('trigger', normalizeTrigger(trigger))
    .select('id');
  if (error) throw error;
  triggerCache.delete(guildId);
  return (data ?? []).length > 0;
}

async function removeAllForTrigger(guildId, trigger) {
  const { data, error } = await supabase.from('reaction_triggers').delete().eq('guild_id', guildId).eq('trigger', normalizeTrigger(trigger)).select('id');
  if (error) throw error;
  triggerCache.delete(guildId);
  return (data ?? []).length;
}

async function resetTriggers(guildId) {
  const { data, error } = await supabase.from('reaction_triggers').delete().eq('guild_id', guildId).select('id');
  if (error) throw error;
  triggerCache.delete(guildId);
  return (data ?? []).length;
}

async function listForMessage(message) {
  const configs = await listMessageConfigsCached(message.guildId);
  return configs.find((row) => row.channel_id === message.channelId)?.emojis ?? [];
}

async function listMessageConfigs(guildId) {
  const { data, error } = await supabase.from('reaction_message_configs').select('*').eq('guild_id', guildId).order('channel_id');
  if (error) throw error;
  return data ?? [];
}

async function listMessageConfigsCached(guildId) {
  const cached = messageConfigCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await listMessageConfigs(guildId);
  messageConfigCache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

async function setMessageConfig({ guildId, channelId, emojis }) {
  const normalized = [...new Set((emojis ?? []).map(normalizeEmoji).filter(Boolean))].slice(0, MAX_EMOJIS_PER_CHANNEL);
  if (!normalized.length) {
    const { data, error } = await supabase.from('reaction_message_configs').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('id');
    if (error) throw error;
    messageConfigCache.delete(guildId);
    return { removed: (data ?? []).length > 0 };
  }

  const { data, error } = await supabase
    .from('reaction_message_configs')
    .upsert({ guild_id: guildId, channel_id: channelId, emojis: normalized }, { onConflict: 'guild_id,channel_id' })
    .select('*')
    .single();
  if (error) throw error;
  messageConfigCache.delete(guildId);
  return data;
}

async function removeMessageConfig(guildId, channelId) {
  return setMessageConfig({ guildId, channelId, emojis: [] });
}

module.exports = {
  MAX_EMOJIS_PER_CHANNEL,
  normalizeTrigger,
  validateTrigger,
  normalizeEmoji,
  addTrigger,
  updateTrigger,
  getTrigger,
  getOwner,
  listTriggers,
  listTriggersCached,
  listMatchingTriggers,
  removeTrigger,
  removeAllForTrigger,
  resetTriggers,
  listForMessage,
  listMessageConfigs,
  listMessageConfigsCached,
  setMessageConfig,
  removeMessageConfig,
};
