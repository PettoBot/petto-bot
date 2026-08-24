const supabase = require('./supabase');

const PUNISHMENTS = ['ban', 'softban', 'kick'];

async function getHoneypot(guildId, channelId) {
  const { data, error } = await supabase
    .from('honeypots')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function listHoneypots(guildId) {
  const { data, error } = await supabase
    .from('honeypots')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at');

  if (error) throw error;
  return data ?? [];
}

async function upsertHoneypot(guildId, channelId, punishment = 'softban') {
  if (!PUNISHMENTS.includes(punishment)) throw new Error(`Unsupported honeypot punishment: ${punishment}`);

  const { data, error } = await supabase
    .from('honeypots')
    .upsert({ guild_id: guildId, channel_id: channelId, punishment, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,channel_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function setPanelMessage(guildId, channelId, panelMessageId) {
  const { data, error } = await supabase
    .from('honeypots')
    .update({ panel_message_id: panelMessageId, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function incrementTrigger(guildId, channelId) {
  const { data, error } = await supabase.rpc('increment_honeypot_trigger', {
    p_guild_id: guildId,
    p_channel_id: channelId,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function removeHoneypot(guildId, channelId) {
  const { data, error } = await supabase
    .from('honeypots')
    .delete()
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .select('*');

  if (error) throw error;
  return data?.[0] ?? null;
}

module.exports = {
  PUNISHMENTS,
  getHoneypot,
  listHoneypots,
  upsertHoneypot,
  setPanelMessage,
  incrementTrigger,
  removeHoneypot,
};
