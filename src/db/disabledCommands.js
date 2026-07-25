const supabase = require('./supabase');

/** Finds a matching rule: a server-wide (channel_id null) rule, or one for `channelId` specifically. `channelId` may be omitted (checks only for a server-wide rule). */
async function find(guildId, command, channelId) {
  const filter = channelId ? `channel_id.is.null,channel_id.eq.${channelId}` : 'channel_id.is.null';
  const { data, error } = await supabase.from('disabled_commands').select('*').eq('guild_id', guildId).eq('command', command).or(filter);
  if (error) throw error;
  return data[0] ?? null;
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('disabled_commands').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function disable(guildId, command, channelId) {
  const { data, error } = await supabase.from('disabled_commands').insert({ guild_id: guildId, command, channel_id: channelId ?? null }).select('*').single();
  if (error) throw error;
  return data;
}

async function enable(guildId, command, channelId) {
  let query = supabase.from('disabled_commands').delete().eq('guild_id', guildId).eq('command', command);
  query = channelId ? query.eq('channel_id', channelId) : query.is('channel_id', null);
  const { data, error } = await query.select('id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { find, listForGuild, disable, enable };
