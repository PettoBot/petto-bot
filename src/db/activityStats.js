const supabase = require('./supabase');
const { ensureGuild } = require('./guilds');
const logger = require('../utils/logger');
const { forEachWithConcurrency } = require('../utils/concurrency');

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_CONCURRENCY = 8;
const MAX_PENDING_KEYS = 200_000;
const pending = new Map();
let flushTimer = null;
let flushInFlight = null;
let overflowWarningAt = 0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function incrementActivity(guildId, channelId, { messages = 0, reactions = 0, voiceSeconds = 0, day = today() } = {}) {
  return incrementActivityNow(guildId, channelId, { messages, reactions, voiceSeconds, day });
}

async function incrementActivityNow(guildId, channelId, { messages = 0, reactions = 0, voiceSeconds = 0, day = today() } = {}) {
  const params = {
    p_guild_id: guildId,
    p_channel_id: channelId,
    p_day: day,
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

function mergePending(key, guildId, channelId, values) {
  const current = pending.get(key) ?? { guildId, channelId, day: values.day ?? today(), messages: 0, reactions: 0, voiceSeconds: 0 };
  current.messages += values.messages;
  current.reactions += values.reactions;
  current.voiceSeconds += values.voiceSeconds;
  pending.set(key, current);
}

function scheduleFlush() {
  if (flushTimer || flushInFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushActivity().catch((error) => logger.error('[Activity stats] Batch flush failed:', error));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/**
 * Queues high-volume activity counters and flushes them through the same
 * atomic Postgres function used by the immediate API. This keeps the visible
 * counters unchanged while avoiding one network round-trip per message.
 */
function queueActivity(guildId, channelId, { messages = 0, reactions = 0, voiceSeconds = 0 } = {}) {
  const values = {
    day: today(),
    messages: Number(messages) || 0,
    reactions: Number(reactions) || 0,
    voiceSeconds: Number(voiceSeconds) || 0,
  };
  if (!values.messages && !values.reactions && !values.voiceSeconds) return true;

  const key = `${guildId}:${channelId}:${values.day}`;
  if (!pending.has(key) && pending.size >= MAX_PENDING_KEYS) {
    const now = Date.now();
    if (now - overflowWarningAt >= 60_000) {
      overflowWarningAt = now;
      logger.warn(`[Activity stats] Pending buffer reached ${MAX_PENDING_KEYS} keys; new activity counters are being deferred until the database recovers.`);
    }
    return false;
  }

  mergePending(key, guildId, channelId, values);
  scheduleFlush();
  return true;
}

async function flushActivity() {
  if (flushInFlight) return flushInFlight;
  if (!pending.size) return;

  const batch = new Map(pending);
  pending.clear();
  flushInFlight = (async () => {
    let failedRows = 0;
    let firstError = null;
    await forEachWithConcurrency(batch.values(), async (row) => {
      try {
        await incrementActivityNow(row.guildId, row.channelId, row);
      } catch (error) {
        mergePending(`${row.guildId}:${row.channelId}:${row.day}`, row.guildId, row.channelId, row);
        failedRows += 1;
        firstError ??= error;
      }
    }, FLUSH_CONCURRENCY);
    if (failedRows) {
      logger.error(`[Activity stats] Failed to flush ${failedRows}/${batch.size} buckets; counters were kept for retry:`, firstError);
    }
  })().finally(() => {
    flushInFlight = null;
    if (pending.size) scheduleFlush();
  });
  return flushInFlight;
}

async function getActivitySummary(guildId, days = 7) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  const { data, error } = await supabase
    .from('activity_stats')
    .select('channel_id, day, messages, reactions, voice_seconds')
    .eq('guild_id', guildId)
    .gte('day', start.toISOString().slice(0, 10))
    .order('day', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

module.exports = { incrementActivity, queueActivity, flushActivity, getActivitySummary };
