const database = require('./database');

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

async function add({ guildId, channelId, intervalMs, message, deletePrevious = false }) {
  const { data, error } = await database.from('auto_messages').insert({ guild_id: guildId, channel_id: channelId, interval_ms: intervalMs, message, delete_previous: deletePrevious, next_run_at: new Date(Date.now() + intervalMs).toISOString() }).select('*').single();
  if (error) throw error;
  return data;
}

async function remove(guildId, id) {
  const { data, error } = await database.from('auto_messages').delete().eq('guild_id', guildId).eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function scheduleNext(id, _expectedRunAt, intervalMs) {
  const next = new Date(Date.now() + intervalMs).toISOString();
  const { error } = await database.from('auto_messages').update({ next_run_at: next }).eq('id', id);
  if (error) throw error;
}

/** Turns "delete the message of the time before" on or off for a timer. Returns the timer, or null when it does not exist. */
async function setDeletePrevious(guildId, id, enabled) {
  const { data, error } = await database.from('auto_messages').update({ delete_previous: enabled }).eq('guild_id', guildId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/** Remembers the message a timer just sent, so the next run can delete it. */
async function setLastMessage(id, messageId) {
  const { error } = await database.from('auto_messages').update({ last_message_id: messageId }).eq('id', id);
  if (error) throw error;
}

module.exports = { get, list, listDue, add, remove, scheduleNext, setDeletePrevious, setLastMessage };
