const supabase = require('./supabase');

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function incrementActivity(guildId, channelId, { messages = 0, reactions = 0, voiceSeconds = 0 } = {}) {
  const { error } = await supabase.rpc('increment_activity_stat', {
    p_guild_id: guildId,
    p_channel_id: channelId,
    p_day: today(),
    p_messages_inc: messages,
    p_reactions_inc: reactions,
    p_voice_seconds_inc: voiceSeconds,
  });
  if (error) throw error;
}

module.exports = { incrementActivity };
