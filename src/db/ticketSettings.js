const supabase = require('./supabase');
const { createExpiringCache } = require('../utils/expiringCache');

const settingsCache = createExpiringCache(15_000);

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
  return settingsCache.get(guildId, async () => {
    const { data, error } = await supabase.from('ticket_settings').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return { ...DEFAULTS, ...data, guild_id: guildId };
  });
}

async function upsertSettings(guildId, patch) {
  const { data, error } = await supabase
    .from('ticket_settings')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  settingsCache.set(guildId, { ...DEFAULTS, ...data, guild_id: guildId });
  return data;
}

async function listAutocloseEnabled() {
  const pageSize = 1_000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('ticket_settings')
      .select('guild_id,autoclose_inactivity_hours')
      .eq('autoclose_inactivity_enabled', true)
      .order('guild_id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

module.exports = { DEFAULTS, getSettings, upsertSettings, listAutocloseEnabled };
