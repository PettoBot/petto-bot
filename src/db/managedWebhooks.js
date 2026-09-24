const supabase = require('./supabase');

async function add(row) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .insert(row)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function update(guildId, localId, patch) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .update(patch)
    .eq('guild_id', guildId)
    .eq('local_id', localId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .select('id,local_id,guild_id,channel_id,webhook_id,name,created_by,created_at')
    .eq('guild_id', guildId)
    .order('local_id');

  if (error) throw error;
  return data ?? [];
}

async function listWithTokens(guildId) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .select('*')
    .eq('guild_id', guildId)
    .order('local_id');

  if (error) throw error;
  return data ?? [];
}

/**
 * Resolves a managed webhook inside one guild by:
 * 1. Per-guild local number
 * 2. Discord webhook ID
 * 3. Exact webhook name (case-insensitive)
 */
async function get(guildId, identifier) {
  const value = String(identifier ?? '').trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const localId = Number(value);

    if (Number.isSafeInteger(localId) && localId > 0) {
      const { data: byLocalId, error: localError } = await supabase
        .from('managed_webhooks')
        .select('*')
        .eq('guild_id', guildId)
        .eq('local_id', localId)
        .maybeSingle();

      if (localError) throw localError;
      if (byLocalId) return byLocalId;
    }

    const { data: byWebhookId, error: webhookError } = await supabase
      .from('managed_webhooks')
      .select('*')
      .eq('guild_id', guildId)
      .eq('webhook_id', value)
      .maybeSingle();

    if (webhookError) throw webhookError;
    if (byWebhookId) return byWebhookId;
  }

  const rows = await listWithTokens(guildId);
  const normalized = value.toLocaleLowerCase();

  const matches = rows.filter(
    (row) =>
      String(row.name ?? '')
        .trim()
        .toLocaleLowerCase() === normalized
  );

  if (matches.length > 1) {
    const error = new Error(
      `More than one managed webhook is named "${value}". Use its server number instead.`
    );

    error.code = 'AMBIGUOUS_WEBHOOK_NAME';
    error.matches = matches.map((row) => row.local_id);

    throw error;
  }

  return matches[0] ?? null;
}

async function getByChannel(guildId, channelId) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .order('local_id');

  if (error) throw error;
  return data ?? [];
}

async function remove(guildId, webhookId) {
  const { data, error } = await supabase
    .from('managed_webhooks')
    .delete()
    .eq('guild_id', guildId)
    .eq('webhook_id', webhookId)
    .select('id');

  if (error) throw error;

  return (data ?? []).length > 0;
}

module.exports = {
  add,
  update,
  list,
  listWithTokens,
  get,
  getByChannel,
  remove,
};