const supabase = require('./supabase');

async function createBackup(guildId, createdBy, label, snapshot) {
  const { data, error } = await supabase
    .from('guild_backups')
    .insert({ guild_id: guildId, created_by: createdBy, label: label || 'Manual backup', snapshot })
    .select('id, label, created_at')
    .single();
  if (error) throw error;
  return data;
}

async function listBackups(guildId, limit = 10) {
  const { data, error } = await supabase
    .from('guild_backups')
    .select('id, label, created_by, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getBackup(guildId, id = null) {
  let query = supabase.from('guild_backups').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1);
  if (id) query = supabase.from('guild_backups').select('*').eq('guild_id', guildId).eq('id', id).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { createBackup, listBackups, getBackup };
