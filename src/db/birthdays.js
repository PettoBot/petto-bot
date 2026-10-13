const database = require('./database');
const { ensureGuild } = require('./guilds');

const MAX_UPCOMING = 25;

async function getBirthday(guildId, userId) {
  const { data, error } = await database.from('birthdays').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setBirthday(guildId, userId, { month, day, year = null }) {
  // The server keeps a row for the guild before any child table can point at it.
  await ensureGuild(guildId);
  const { data, error } = await database
    .from('birthdays')
    .upsert({ guild_id: guildId, user_id: userId, month, day, year }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeBirthday(guildId, userId) {
  const { data, error } = await database.from('birthdays').delete().eq('guild_id', guildId).eq('user_id', userId).select('user_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Every birthday of a server (it is small: one row per member who saved theirs). */
async function listBirthdays(guildId) {
  const { data, error } = await database.from('birthdays').select('user_id,month,day,year').eq('guild_id', guildId).limit(5000);
  if (error) throw error;
  return data ?? [];
}

/** The people of a server whose birthday is on `month`/`day`. */
async function onDay(guildId, month, day) {
  const { data, error } = await database.from('birthdays').select('user_id,month,day,year').eq('guild_id', guildId).eq('month', month).eq('day', day).limit(200);
  if (error) throw error;
  return data ?? [];
}

async function getConfig(guildId) {
  const { data, error } = await database.from('birthday_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  await ensureGuild(guildId);
  const { data, error } = await database
    .from('birthday_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listEnabledConfigs() {
  const { data, error } = await database.from('birthday_config').select('*').eq('enabled', true).limit(5000);
  if (error) throw error;
  return data ?? [];
}

/** Marks `date` (YYYY-MM-DD) as announced for the server. False when another process already did it. */
async function claimDay(guildId, date) {
  const { data, error } = await database
    .from('birthday_config')
    .update({ last_announced: date })
    .eq('guild_id', guildId)
    .or(`last_announced.is.null,last_announced.neq.${date}`)
    .select('guild_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function rememberRole(guildId, userId, roleId, removeAt) {
  const { error } = await database.from('birthday_roles').upsert({ guild_id: guildId, user_id: userId, role_id: roleId, remove_at: removeAt.toISOString() }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

async function listDueRoles() {
  const { data, error } = await database.from('birthday_roles').select('*').lte('remove_at', new Date().toISOString()).limit(200);
  if (error) throw error;
  return data ?? [];
}

async function forgetRole(guildId, userId) {
  const { error } = await database.from('birthday_roles').delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

module.exports = { MAX_UPCOMING, getBirthday, setBirthday, removeBirthday, listBirthdays, onDay, getConfig, upsertConfig, listEnabledConfigs, claimDay, rememberRole, listDueRoles, forgetRole };
