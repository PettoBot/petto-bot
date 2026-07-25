const supabase = require('./supabase');

async function addReactionRole(row) {
  const { data, error } = await supabase.from('reaction_roles').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getReactionRole(messageId, emoji) {
  const { data, error } = await supabase.from('reaction_roles').select('*').eq('message_id', messageId).eq('emoji', emoji).maybeSingle();
  if (error) throw error;
  return data;
}

async function removeReactionRole(messageId, emoji) {
  const { data, error } = await supabase.from('reaction_roles').delete().eq('message_id', messageId).eq('emoji', emoji).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listForMessage(messageId) {
  const { data, error } = await supabase.from('reaction_roles').select('*').eq('message_id', messageId);
  if (error) throw error;
  return data;
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('reaction_roles').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function clearForMessage(messageId) {
  const { data, error } = await supabase.from('reaction_roles').delete().eq('message_id', messageId).select('id');
  if (error) throw error;
  return data.length;
}

module.exports = { addReactionRole, getReactionRole, removeReactionRole, listForMessage, listForGuild, clearForMessage };
