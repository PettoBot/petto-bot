const database = require('./database');
const { t, currentLanguage } = require('../i18n');

const MAX_PER_USER = 25;

async function countActive(guildId, userId) {
  const { count, error } = await database.from('reminders').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('user_id', userId).eq('sent', false);
  if (error) throw error;
  return count ?? 0;
}

/** How many reminders a person can have waiting: the base number, plus the limits bonus of their plan (Bronze 25 %, Silver 50 %, Gold 100 %). A plan that cannot be read gives the base. */
async function limitFor(userId) {
  try {
    const row = await require('./userPlans').getPlan(userId);
    const tier = row && row.active ? row.plan : 'free';
    const bonus = require('../utils/userPlans').PLAN_PERKS[tier]?.limitsBonus ?? 0;
    return Math.floor(MAX_PER_USER * (1 + bonus / 100));
  } catch {
    return MAX_PER_USER;
  }
}

async function createReminder({ guildId, channelId, userId, message, remindAt }) {
  const active = await countActive(guildId, userId);
  const max = await limitFor(userId);
  if (active >= max) throw Object.assign(new Error(t(currentLanguage(), 'utility.db.reminderLimit', { max })), { userFacing: true });

  const { data, error } = await database.from('reminders').insert({ guild_id: guildId, channel_id: channelId, user_id: userId, message, remind_at: remindAt.toISOString() }).select('*').single();
  if (error) throw error;
  return data;
}

async function listActive(guildId, userId) {
  const { data, error } = await database.from('reminders').select('*').eq('guild_id', guildId).eq('user_id', userId).eq('sent', false).order('remind_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function cancelReminder(guildId, userId, id) {
  const { data, error } = await database.from('reminders').delete().eq('guild_id', guildId).eq('user_id', userId).eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listDue() {
  const { data, error } = await database.from('reminders').select('*').eq('sent', false).lte('remind_at', new Date().toISOString()).order('remind_at', { ascending: true }).limit(100);
  if (error) throw error;
  return data ?? [];
}

async function markSent(id) {
  const { error } = await database.from('reminders').update({ sent: true }).eq('id', id);
  if (error) throw error;
}

module.exports = { createReminder, listActive, cancelReminder, listDue, markSent, MAX_PER_USER, limitFor };
