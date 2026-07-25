const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('bump_reminders').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Fetches (creating with defaults if needed) — most callers need the row to exist so its default message/thankyou text is available. */
async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;

  const { data, error } = await supabase.from('bump_reminders').insert({ guild_id: guildId }).select('*').single();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('bump_reminders')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** All guilds with a due (or never-set) reminder and a configured channel — polled by the bump reminder job. */
async function getDueReminders() {
  const { data, error } = await supabase.from('bump_reminders').select('*').not('channel_id', 'is', null).lte('next_bump_at', new Date().toISOString());
  if (error) throw error;
  return data;
}

async function getConfigByChannel(guildId, channelId) {
  const { data, error } = await supabase.from('bump_reminders').select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { getConfig, ensureConfig, upsertConfig, getDueReminders, getConfigByChannel };
