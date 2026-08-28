const supabase = require('./supabase');

const MAX_PER_USER = 25;

async function countActive(guildId, userId) {
  const { count, error } = await supabase.from('reminders').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('user_id', userId).eq('sent', false);
  if (error) throw error;
  return count ?? 0;
}

async function createReminder({ guildId, channelId, userId, message, remindAt }) {
  const active = await countActive(guildId, userId);
  if (active >= MAX_PER_USER) throw Object.assign(new Error(`You already have ${MAX_PER_USER} active reminders — cancel one first.`), { userFacing: true });

  const { data, error } = await supabase.from('reminders').insert({ guild_id: guildId, channel_id: channelId, user_id: userId, message, remind_at: remindAt.toISOString() }).select('*').single();
  if (error) throw error;
  return data;
}

async function listActive(guildId, userId) {
  const { data, error } = await supabase.from('reminders').select('*').eq('guild_id', guildId).eq('user_id', userId).eq('sent', false).order('remind_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function cancelReminder(guildId, userId, id) {
  const { data, error } = await supabase.from('reminders').delete().eq('guild_id', guildId).eq('user_id', userId).eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listDue() {
  const { data, error } = await supabase.from('reminders').select('*').eq('sent', false).lte('remind_at', new Date().toISOString()).order('remind_at', { ascending: true }).limit(100);
  if (error) throw error;
  return data ?? [];
}

async function markSent(id) {
  const { error } = await supabase.from('reminders').update({ sent: true }).eq('id', id);
  if (error) throw error;
}

module.exports = { createReminder, listActive, cancelReminder, listDue, markSent, MAX_PER_USER };
