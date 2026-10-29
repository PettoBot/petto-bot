const database = require('./database');
const { nextRunAt } = require('../utils/timerSchedule');

async function get(guildId, id) {
  const { data, error } = await database.from('auto_messages').select('*').eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await database.from('auto_messages').select('*').eq('guild_id', guildId).order('channel_id');
  if (error) throw error;
  return data;
}

async function listDue() {
  const { data, error } = await database.from('auto_messages').select('*').lte('next_run_at', new Date().toISOString()).order('next_run_at').limit(100);
  if (error) throw error;
  return data;
}

/**
 * Creates a timer. `schedule` is 'interval' (every `intervalMs`, the default), 'daily' or 'weekly' (at `atTime` in `timezone`, weekly on
 * `weekday`); the caller has already checked those (src/utils/timerSchedule.js).
 */
async function add({ guildId, channelId, intervalMs, message, deletePrevious = false, embedTemplate = null, schedule = 'interval', atTime = null, timezone = 'UTC', weekday = null }) {
  const scheduled = schedule === 'daily' || schedule === 'weekly';
  const fields = scheduled ? { schedule, at_time: atTime, timezone, weekday: schedule === 'weekly' ? weekday : null } : {};
  const nextRun = nextRunAt({ ...fields, interval_ms: intervalMs });
  const { data, error } = await database.from('auto_messages').insert({ guild_id: guildId, channel_id: channelId, interval_ms: intervalMs, message, delete_previous: deletePrevious, ...(embedTemplate ? { embed_template: embedTemplate } : {}), ...fields, next_run_at: nextRun.toISOString() }).select('*').single();
  if (error) throw error;
  return data;
}

async function remove(guildId, id) {
  const { data, error } = await database.from('auto_messages').delete().eq('guild_id', guildId).eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

/** Moves a timer to its next run: the next time of its schedule (daily/weekly), or now + its interval. `timer` is its row. */
async function scheduleNext(timer) {
  const next = nextRunAt(timer).toISOString();
  const { error } = await database.from('auto_messages').update({ next_run_at: next }).eq('id', timer.id);
  if (error) throw error;
}

/** Turns "delete the message of the time before" on or off for a timer. Returns the timer, or null when it does not exist. */
async function setDeletePrevious(guildId, id, enabled) {
  const { data, error } = await database.from('auto_messages').update({ delete_previous: enabled }).eq('guild_id', guildId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/** Chooses the saved embed a timer sends (null takes it off). Returns the timer, or null when it does not exist. */
async function setEmbedTemplate(guildId, id, embedTemplate) {
  const { data, error } = await database.from('auto_messages').update({ embed_template: embedTemplate }).eq('guild_id', guildId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/** Remembers the message a timer just sent, so the next run can delete it. */
async function setLastMessage(id, messageId) {
  const { error } = await database.from('auto_messages').update({ last_message_id: messageId }).eq('id', id);
  if (error) throw error;
}

module.exports = { get, list, listDue, add, remove, scheduleNext, setDeletePrevious, setEmbedTemplate, setLastMessage };
