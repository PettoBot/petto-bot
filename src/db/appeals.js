const database = require('./database');

const CONFIG_DEFAULTS = {
  slug: null,
  enabled: false, greeting: null, language: 'en', rejoin_invite_code: null, auto_invite: false, allow_server_id: true,
  punishment_types: ['ban', 'mute'], punishment_details: ['reason', 'duration'], punishment_source: 'both', warns_max_age_days: 30,
  anonymous_messages: false, allow_replies: true, store_days: 7, submission_channel_id: null, log_channel_id: null, auto_thread: false,
  thread_name: 'Appeal by {username}', ping_role_ids: [], messages: {}, brand: {}, embed: {}, // i18n-ignore: English default kept in the database, shown translated (defaultText)
  // The appeal link in sanction DMs (`always` = for the sanctions members can appeal), the server's own line about it, and how long a
  // member waits after a punishment before appealing (0 = no wait).
  dm_link_mode: 'always', dm_link_types: ['ban', 'tempban', 'softban', 'kick', 'timeout', 'warn'], dm_note: null, min_wait_hours: 0,
};

async function getConfig(guildId) {
  const { data, error } = await database.from('appeal_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...CONFIG_DEFAULTS, ...data, guild_id: guildId };
}

async function getForm(guildId, formId) {
  const { data, error } = await database.from('appeal_forms').select('*').eq('guild_id', guildId).eq('id', formId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getSubmission(guildId, id) {
  const { data, error } = await database.from('appeal_submissions').select('*').eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createSubmission(row) {
  const { data, error } = await database.from('appeal_submissions').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateSubmission(id, patch) {
  const { data, error } = await database.from('appeal_submissions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

/** Marks a pending submission as resolved; returns null when someone else resolved it first. */
async function resolveSubmission(id, patch) {
  const { data, error } = await database.from('appeal_submissions').update(patch).eq('id', id).eq('status', 'pending').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function countPending(guildId, userId, formId) {
  const { count, error } = await database.from('appeal_submissions').select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId).eq('user_id', userId).eq('form_id', formId).eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

/** The appeals of a whole server that wait for an answer. */
async function countPendingAll(guildId) {
  const { count, error } = await database.from('appeal_submissions').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

/** Changes some settings of a server's appeals (the row is made when it has none). */
async function updateConfig(guildId, patch) {
  const { error } = await database.from('appeal_config').upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}

async function addMessage(row) {
  const { data, error } = await database.from('appeal_messages').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getBlock(guildId, userId) {
  const { data, error } = await database.from('appeal_blocks').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data?.until && Date.parse(data.until) <= Date.now()) return null;
  return data;
}

async function setBlock(guildId, userId, until, reason) {
  const { error } = await database.from('appeal_blocks').upsert({ guild_id: guildId, user_id: userId, until, reason: reason ?? null }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

/** Deletes the resolved submissions that were kept longer than a server wants. Returns how many went. */
async function deleteResolvedBefore(guildId, beforeIso) {
  const { data, error } = await database.from('appeal_submissions').delete().eq('guild_id', guildId).neq('status', 'pending').lt('resolved_at', beforeIso).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

async function listEnabledConfigs() {
  const { data, error } = await database.from('appeal_config').select('guild_id,store_days').eq('enabled', true);
  if (error) throw error;
  return data ?? [];
}

/** The servers that hold a link name, with what tells if they still use it. */
async function listNamed() {
  const { data, error } = await database.from('appeal_config').select('guild_id,slug,enabled,updated_at').not('slug', 'is', null);
  if (error) throw error;
  return data ?? [];
}

async function clearSlug(guildId) {
  const { error } = await database.from('appeal_config').update({ slug: null }).eq('guild_id', guildId);
  if (error) throw error;
}

async function lastSubmissionAt(guildId) {
  const { data, error } = await database.from('appeal_submissions').select('created_at').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.created_at ?? null;
}

async function deleteExpiredReservations(beforeIso) {
  const { data, error } = await database.from('appeal_name_reservations').delete().lt('reserved_until', beforeIso).select('slug');
  if (error) throw error;
  return data?.length ?? 0;
}

module.exports = { deleteExpiredReservations, listNamed, clearSlug, lastSubmissionAt, CONFIG_DEFAULTS, getConfig, getForm, getSubmission, createSubmission, updateSubmission, resolveSubmission, countPending, countPendingAll, updateConfig, addMessage, getBlock, setBlock, deleteResolvedBefore, listEnabledConfigs };
