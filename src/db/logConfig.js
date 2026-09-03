const supabase = require('./supabase');
const logger = require('../utils/logger');

const EVENTS = ['messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod'];
const CONFIG_CACHE_TTL_MS = 5_000;
const configCache = new Map();
const configRequests = new Map();
const configVersions = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invalidateLogConfig(guildId) {
  const key = String(guildId);
  configVersions.set(key, (configVersions.get(key) ?? 0) + 1);
  configCache.delete(key);
  configRequests.delete(key);
}

async function readRows(queryFactory, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await queryFactory();
    if (!error) return data ?? [];
    lastError = error;
    if (attempt === 0) await sleep(150);
  }
  throw new Error(`${label}: ${lastError?.message ?? lastError}`);
}

/**
 * Loads everything sendLog() needs for a guild in one shot: which channels
 * have which events routed to them (with color overrides), the webhook to
 * post through for each of those channels, and the ignore list. Mirrors the
 * shape of the old bot's single embedded LogConfig Mongo document.
 */
async function getLogConfig(guildId, { force = false } = {}) {
  const key = String(guildId);
  const cached = configCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = configRequests.get(key);
  if (pending) return pending;
  const version = configVersions.get(key) ?? 0;

  const request = (async () => {
    const [entriesResult, webhooksResult, ignoredResult] = await Promise.allSettled([
      readRows(() => supabase.from('log_entries').select('*').eq('guild_id', guildId), 'log entries'),
      readRows(() => supabase.from('log_webhooks').select('*').eq('guild_id', guildId), 'log webhooks'),
      readRows(() => supabase.from('log_ignored').select('target_id').eq('guild_id', guildId), 'ignored log targets'),
    ]);

    if (entriesResult.status === 'rejected' || webhooksResult.status === 'rejected') {
      if (cached?.value) {
        logger.warn(`[logConfig] Using cached configuration for guild ${guildId}: ${entriesResult.reason?.message ?? webhooksResult.reason?.message ?? 'database read failed'}`);
        cached.expiresAt = Date.now() + 1_000;
        return cached.value;
      }

      throw entriesResult.reason ?? webhooksResult.reason;
    }

    const config = {
      entries: entriesResult.value,
      webhooks: webhooksResult.value,
      // An ignored target is optional. A temporary failure here must not stop all
      // configured event logs from being delivered.
      ignored: ignoredResult.status === 'fulfilled' ? ignoredResult.value.map((row) => row.target_id) : [],
    };

    if (ignoredResult.status === 'rejected') {
      logger.warn(`[logConfig] Could not read ignored targets for guild ${guildId}: ${ignoredResult.reason?.message ?? ignoredResult.reason}`);
    }

    if ((configVersions.get(key) ?? 0) === version) {
      configCache.set(key, { value: config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    }
    return config;
  })();

  configRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (configRequests.get(key) === request) configRequests.delete(key);
  }
}

async function addEntry(guildId, channelId, event) {
  const { error } = await supabase.from('log_entries').insert({ guild_id: guildId, channel_id: channelId, event });
  if (error) throw error;
  invalidateLogConfig(guildId);
}

async function removeEntries(guildId, channelId, event = null) {
  let query = supabase.from('log_entries').delete().eq('guild_id', guildId).eq('channel_id', channelId);
  if (event) query = query.eq('event', event);
  const { error } = await query;
  if (error) throw error;
  invalidateLogConfig(guildId);
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
  invalidateLogConfig(guildId);
  return data.length > 0;
}

async function upsertWebhook(guildId, channelId, webhookId, webhookToken) {
  const { error } = await supabase
    .from('log_webhooks')
    .upsert({ guild_id: guildId, channel_id: channelId, webhook_id: webhookId, webhook_token: webhookToken });
  if (error) throw error;
  invalidateLogConfig(guildId);
}

async function deleteWebhookByChannel(guildId, channelId) {
  const { error } = await supabase.from('log_webhooks').delete().eq('guild_id', guildId).eq('channel_id', channelId);
  if (error) throw error;
  invalidateLogConfig(guildId);
}

async function deleteWebhookById(guildId, webhookId) {
  const { error } = await supabase.from('log_webhooks').delete().eq('guild_id', guildId).eq('webhook_id', webhookId);
  if (error) throw error;
  invalidateLogConfig(guildId);
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
    invalidateLogConfig(guildId);
    return false;
  }

  const { error } = await supabase.from('log_ignored').insert({ guild_id: guildId, target_id: targetId });
  if (error) throw error;
  invalidateLogConfig(guildId);
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
  invalidateLogConfig,
};
