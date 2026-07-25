const supabase = require('./supabase');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function getStatus(guildId, userId) {
  const { data, error } = await supabase.from('afk_status').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setStatus(guildId, userId, reason) {
  const { data, error } = await supabase.from('afk_status').upsert({ guild_id: guildId, user_id: userId, reason, set_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' }).select('*').single();
  if (error) throw error;
  return data;
}

/** Deletes and returns the status in one step — used on the author's own next message to clear + report on it. */
async function clearStatus(guildId, userId) {
  const { data, error } = await supabase.from('afk_status').delete().eq('guild_id', guildId).eq('user_id', userId).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function recordMention(guildId, afkUserId, { mentionedBy, channelId, messageLink, content }) {
  const { error } = await supabase.from('afk_mentions').insert({ guild_id: guildId, afk_user_id: afkUserId, mentioned_by: mentionedBy, channel_id: channelId, message_link: messageLink, content });
  if (error) throw error;
}

async function listRecentMentions(guildId, afkUserId, { limit = 15 } = {}) {
  const since = new Date(Date.now() - THREE_DAYS_MS).toISOString();
  const { data, error } = await supabase.from('afk_mentions').select('*').eq('guild_id', guildId).eq('afk_user_id', afkUserId).gte('created_at', since).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function countRecentMentions(guildId, afkUserId) {
  const since = new Date(Date.now() - THREE_DAYS_MS).toISOString();
  const { count, error } = await supabase.from('afk_mentions').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('afk_user_id', afkUserId).gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

module.exports = { getStatus, setStatus, clearStatus, recordMention, listRecentMentions, countRecentMentions };
