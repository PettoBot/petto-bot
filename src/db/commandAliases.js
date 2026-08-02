const supabase = require('./supabase');

function normalizeName(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, '');
}

async function get(guildId, name) {
  const { data, error } = await supabase
    .from('command_aliases')
    .select('*')
    .eq('guild_id', guildId)
    .eq('name', normalizeName(name))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await supabase.from('command_aliases').select('*').eq('guild_id', guildId).order('name');
  if (error) throw error;
  return data;
}

async function add(guildId, name, command) {
  const { data, error } = await supabase
    .from('command_aliases')
    .upsert({ guild_id: guildId, name: normalizeName(name), command: command.trim() }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function remove(guildId, name) {
  const { data, error } = await supabase.from('command_aliases').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { normalizeName, get, list, add, remove };
