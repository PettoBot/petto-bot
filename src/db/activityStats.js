const supabase = require('./supabase');
const { ensureGuild } = require('./guilds');

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function incrementActivity(guildId, channelId, { messages = 0, reactions = 0, voiceSeconds = 0 } = {}) {
  const params = {
    p_guild_id: guildId,
    p_channel_id: channelId,
    p_day: today(),
    p_messages_inc: messages,
    p_reactions_inc: reactions,
    p_voice_seconds_inc: voiceSeconds,
  };

  const { error } = await supabase.rpc('increment_activity_stat', params);
  if (!error) return;

  // Brand new guild: this can fire before anything else has created its guilds row yet
  // (activity tracking has no other reason to touch that table). Create it and retry once.
  if (error.code === '23503') {
    await ensureGuild(guildId);
    const { error: retryError } = await supabase.rpc('increment_activity_stat', params);
    if (retryError) throw retryError;
    return;
  }

  throw error;
}

module.exports = { incrementActivity };
