const database = require('./database');

async function getConfig(guildId) {
  const { data, error } = await database.from('jail_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('jail_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getJailed(guildId, userId) {
  const { data, error } = await database.from('jailed_members').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listJailed(guildId) {
  const { data, error } = await database.from('jailed_members').select('*').eq('guild_id', guildId).order('jailed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Records a jailed member. Written before any role is touched, so the saved roles survive a crash. */
async function addJailed({ guildId, userId, savedRoleIds, jailedBy, reason = null, expiresAt = null }) {
  const { data, error } = await database
    .from('jailed_members')
    .upsert({ guild_id: guildId, user_id: userId, saved_role_ids: savedRoleIds, jailed_by: jailedBy, reason, expires_at: expiresAt, jailed_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Replaces the roles a member gets back on release (used when a role is handed to them while they are jailed). */
async function setSavedRoles(guildId, userId, savedRoleIds) {
  const { error } = await database.from('jailed_members').update({ saved_role_ids: savedRoleIds }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

async function setJailCase(guildId, userId, caseNumber) {
  const { error } = await database.from('jailed_members').update({ case_number: caseNumber }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

/** Removes a jailed member; resolves to the removed row, or null when they were not jailed. */
async function removeJailed(guildId, userId) {
  const { data, error } = await database.from('jailed_members').delete().eq('guild_id', guildId).eq('user_id', userId).select('*');
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Jails whose timer has run out, across every server. Polled by the expiry job. */
async function getExpiredJails() {
  const { data, error } = await database.from('jailed_members').select('*').lte('expires_at', new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

module.exports = { getConfig, upsertConfig, getJailed, listJailed, addJailed, setSavedRoles, setJailCase, removeJailed, getExpiredJails };
