// The finer counters behind the Statistics page and `/summary`: messages and voice time by hour of the day, by member, and
// the members who joined or left each day. Like the channel counters they are queued and written in small batches.
const database = require('./database');
const { ensureGuild } = require('./guilds');
const logger = require('../utils/logger');
const { forEachWithConcurrency } = require('../utils/concurrency');

const FLUSH_INTERVAL_MS = 2_000;
const MAX_PENDING_KEYS = 100_000;
const pending = new Map(); // key -> { rpc, params, add(values) }
let timer = null;
let flushing = false;

const dayOf = (date) => date.toISOString().slice(0, 10);

function queue(key, rpc, params, counters) {
  const current = pending.get(key);
  if (current) {
    for (const [name, value] of Object.entries(counters)) current.counters[name] += value;
  } else {
    if (pending.size >= MAX_PENDING_KEYS) return false;
    pending.set(key, { rpc, params, counters: { ...counters } });
  }
  schedule();
  return true;
}

function schedule() {
  if (timer || flushing) return;
  timer = setTimeout(() => { timer = null; flush().catch((error) => logger.error('[Activity detail] Flush failed:', error)); }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

async function run(entry) {
  const params = { ...entry.params, ...entry.counters };
  let { error } = await database.rpc(entry.rpc, params);
  if (error?.code === '23503') {
    await ensureGuild(entry.params.p_guild_id);
    ({ error } = await database.rpc(entry.rpc, params));
  }
  if (error) throw error;
}

async function flush() {
  if (flushing || !pending.size) return;
  flushing = true;
  const batch = new Map(pending);
  pending.clear();
  try {
    await forEachWithConcurrency(batch.entries(), async ([key, entry]) => {
      try {
        await run(entry);
      } catch (error) {
        logger.warn(`[Activity detail] ${entry.rpc} failed, kept for retry: ${error.message}`);
        const again = pending.get(key);
        if (again) for (const [name, value] of Object.entries(entry.counters)) again.counters[name] += value;
        else pending.set(key, entry);
      }
    }, 6);
  } finally {
    flushing = false;
    if (pending.size) schedule();
  }
}

/** A message by a member (hour of the day and member counters). */
function queueMessage(guildId, userId, now = new Date()) {
  const day = dayOf(now);
  queue(`h:${guildId}:${day}:${now.getUTCHours()}`, 'increment_activity_hourly', { p_guild_id: guildId, p_day: day, p_hour: now.getUTCHours() }, { p_messages: 1, p_voice_seconds: 0 });
  queue(`m:${guildId}:${day}:${userId}`, 'increment_activity_member', { p_guild_id: guildId, p_day: day, p_user_id: userId }, { p_messages: 1, p_voice_seconds: 0 });
}

/** Voice time of one member in this minute. */
function queueVoice(guildId, userId, seconds, now = new Date()) {
  const day = dayOf(now);
  queue(`h:${guildId}:${day}:${now.getUTCHours()}`, 'increment_activity_hourly', { p_guild_id: guildId, p_day: day, p_hour: now.getUTCHours() }, { p_messages: 0, p_voice_seconds: seconds });
  queue(`m:${guildId}:${day}:${userId}`, 'increment_activity_member', { p_guild_id: guildId, p_day: day, p_user_id: userId }, { p_messages: 0, p_voice_seconds: seconds });
}

/** A member joined (`invited` when a tracked invite brought them) or left. */
function queueFlow(guildId, { joins = 0, leaves = 0, invited = 0 }, now = new Date()) {
  const day = dayOf(now);
  queue(`f:${guildId}:${day}`, 'increment_member_flow', { p_guild_id: guildId, p_day: day }, { p_joins: joins, p_leaves: leaves, p_invited: invited });
}

function startOf(days) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return dayOf(start);
}

async function select(table, columns, guildId, days) {
  const { data, error } = await database.from(table).select(columns).eq('guild_id', guildId).gte('day', startOf(days)).order('day', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

const getHourly = (guildId, days) => select('activity_hourly', 'day, hour, messages, voice_seconds', guildId, days);
const getFlow = (guildId, days) => select('member_flow', 'day, joins, leaves, invited', guildId, days);
const getMembers = (guildId, days) => select('activity_members', 'day, user_id, messages, voice_seconds', guildId, days);

module.exports = { queueMessage, queueVoice, queueFlow, flush, getHourly, getFlow, getMembers };
