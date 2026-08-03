const supabase = require('./supabase');

async function listBlacklist(guildId) {
  const { data, error } = await supabase.from('ticket_blacklist').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function addBlacklist({ guildId, targetType, targetId, reason }) {
  const { data, error } = await supabase.from('ticket_blacklist').upsert({ guild_id: guildId, target_type: targetType, target_id: targetId, reason: reason || null }, { onConflict: 'guild_id,target_type,target_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function removeBlacklist(guildId, targetType, targetId) {
  const { data, error } = await supabase.from('ticket_blacklist').delete().eq('guild_id', guildId).eq('target_type', targetType).eq('target_id', targetId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function isBlacklisted(guildId, userId, roleIds = []) {
  const ids = [userId, ...roleIds].filter(Boolean);
  if (!ids.length) return null;
  const { data, error } = await supabase.from('ticket_blacklist').select('*').eq('guild_id', guildId).in('target_id', ids);
  if (error) throw error;
  return (data ?? []).find((entry) => (entry.target_type === 'user' && entry.target_id === userId) || (entry.target_type === 'role' && roleIds.includes(entry.target_id))) ?? null;
}

module.exports = { listBlacklist, addBlacklist, removeBlacklist, isBlacklisted };
