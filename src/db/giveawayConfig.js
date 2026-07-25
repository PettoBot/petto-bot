const supabase = require('./supabase');

const DEFAULTS = { reaction: '🎉', entry_mode: 'button' };

/** Single-row-per-guild config for the giveaway module's default embed/messages, same shape as bump_reminders. */
async function ensureConfig(guildId) {
  const { data: existing, error: selectError } = await supabase.from('giveaway_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase.from('giveaway_config').insert({ guild_id: guildId, ...DEFAULTS }).select('*').single();
  if (insertError) throw insertError;
  return created;
}

async function updateConfig(guildId, patch) {
  await ensureConfig(guildId);
  const { data, error } = await supabase.from('giveaway_config').update(patch).eq('guild_id', guildId).select('*').single();
  if (error) throw error;
  return data;
}

module.exports = { ensureConfig, updateConfig };
