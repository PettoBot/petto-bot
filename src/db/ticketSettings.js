const supabase = require('./supabase');

const DEFAULTS = {
  claim_mode: 'shared',
  ping_on_claim: false,
  roles_to_add_on_claim: [],
  close_requires_support_role: false,
  close_requires_reason: false,
  hide_closing_user: false,
  dm_user_on_close: true,
  default_close_reason: null,
  log_staff_message_counts: false,
  autoclose_leave: false,
  autoclose_inactivity_enabled: false,
  autoclose_inactivity_hours: 168,
  rating_enabled: false,
  rating_mode: 'rating_only',
  rating_log_channel_id: null,
  opened_log_channel_id: null,
  closed_log_channel_id: null,
  blocked_role_ids: [],
};

async function getSettings(guildId) {
  const { data, error } = await supabase.from('ticket_settings').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...data, guild_id: guildId };
}

async function upsertSettings(guildId, patch) {
  const { data, error } = await supabase
    .from('ticket_settings')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = { DEFAULTS, getSettings, upsertSettings };
