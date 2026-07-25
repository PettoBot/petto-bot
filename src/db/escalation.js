const supabase = require('./supabase');

async function getRules(guildId) {
  const { data, error } = await supabase.from('warn_escalation_rules').select('*').eq('guild_id', guildId).order('warn_count', { ascending: true });
  if (error) throw error;
  return data;
}

async function addRule(guildId, warnCount, action, durationMs = null) {
  const { error } = await supabase.from('warn_escalation_rules').upsert({ guild_id: guildId, warn_count: warnCount, action, duration_ms: durationMs }, { onConflict: 'guild_id,warn_count' });
  if (error) throw error;
}

async function removeRule(guildId, warnCount) {
  const { data, error } = await supabase.from('warn_escalation_rules').delete().eq('guild_id', guildId).eq('warn_count', warnCount).select('warn_count');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { getRules, addRule, removeRule };
