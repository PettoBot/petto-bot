const supabase = require('./supabase');

const EVENTS = ['messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod'];

/**
 * Loads everything sendLog() needs for a guild in one shot: which channels
 * have which events routed to them (with color overrides), the webhook to
 * post through for each of those channels, and the ignore list. Mirrors the
 * shape of the old bot's single embedded LogConfig Mongo document.
 */
async function getLogConfig(guildId) {
  const [{ data: entries, error: entriesError }, { data: webhooks, error: webhooksError }, { data: ignored, error: ignoredError }] =
    await Promise.all([
      supabase.from('log_entries').select('*').eq('guild_id', guildId),
      supabase.from('log_webhooks').select('*').eq('guild_id', guildId),
      supabase.from('log_ignored').select('target_id').eq('guild_id', guildId),
    ]);

  if (entriesError) throw entriesError;
  if (webhooksError) throw webhooksError;
  if (ignoredError) throw ignoredError;

  return {
    entries: entries ?? [],
    webhooks: webhooks ?? [],
    ignored: (ignored ?? []).map((row) => row.target_id),
  };
}

async function addEntry(guildId, channelId, event) {
  const { error } = await supabase.from('log_entries').insert({ guild_id: guildId, channel_id: channelId, event });
  if (error) throw error;
}

async function removeEntries(guildId, channelId, event = null) {
  let query = supabase.from('log_entries').delete().eq('guild_id', guildId).eq('channel_id', channelId);
  if (event) query = query.eq('event', event);
  const { error } = await query;
  if (error) throw error;
}

async function setEntryColor(guildId, channelId, event, color) {
  const { data, error } = await supabase
    .from('log_entries')
    .update({ color })
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .eq('event', event)
    .select('*');

  if (error) throw error;
  return data.length > 0;
}

async function upsertWebhook(guildId, channelId, webhookId, webhookToken) {
  const { error } = await supabase
    .from('log_webhooks')
    .upsert({ guild_id: guildId, channel_id: channelId, webhook_id: webhookId, webhook_token: webhookToken });
  if (error) throw error;
}

async function deleteWebhookByChannel(guildId, channelId) {
  const { error } = await supabase.from('log_webhooks').delete().eq('guild_id', guildId).eq('channel_id', channelId);
  if (error) throw error;
}

async function deleteWebhookById(guildId, webhookId) {
  const { error } = await supabase.from('log_webhooks').delete().eq('guild_id', guildId).eq('webhook_id', webhookId);
  if (error) throw error;
}

async function toggleIgnored(guildId, targetId) {
  const { data: existing, error: selectError } = await supabase
    .from('log_ignored')
    .select('target_id')
    .eq('guild_id', guildId)
    .eq('target_id', targetId)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    const { error } = await supabase.from('log_ignored').delete().eq('guild_id', guildId).eq('target_id', targetId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from('log_ignored').insert({ guild_id: guildId, target_id: targetId });
  if (error) throw error;
  return true;
}

module.exports = {
  EVENTS,
  getLogConfig,
  addEntry,
  removeEntries,
  setEntryColor,
  upsertWebhook,
  deleteWebhookByChannel,
  deleteWebhookById,
  toggleIgnored,
};
