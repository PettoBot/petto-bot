const supabase = require('./supabase');

async function getSticky(guildId, channelId) {
  const { data, error } = await supabase.from('sticky_messages').select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('sticky_messages').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function setSticky(guildId, channelId, content) {
  const { data, error } = await supabase.from('sticky_messages').upsert({ guild_id: guildId, channel_id: channelId, content, message_id: null }, { onConflict: 'guild_id,channel_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function setMessageId(guildId, channelId, messageId) {
  const { error } = await supabase.from('sticky_messages').update({ message_id: messageId }).eq('guild_id', guildId).eq('channel_id', channelId);
  if (error) throw error;
}

async function removeSticky(guildId, channelId) {
  const { data, error } = await supabase.from('sticky_messages').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { getSticky, listForGuild, setSticky, setMessageId, removeSticky };
