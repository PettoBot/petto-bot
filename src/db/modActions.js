const supabase = require('./supabase');

/**
 * Creates a numbered moderation case (ban/kick/mute/unmute/unban/tempban/tempmute/warn).
 * Case numbering is handled atomically in Postgres (see create_mod_case in
 * schema.sql) so concurrent actions in the same guild never collide.
 */
async function createCase({ guildId, userId, moderatorId, type, reason = null, expiresAt = null }) {
  const { data, error } = await supabase.rpc('create_mod_case', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_moderator_id: moderatorId,
    p_type: type,
    p_reason: reason,
    p_expires_at: expiresAt,
  });

  if (error) throw error;
  return data;
}

async function getCase(guildId, caseNumber) {
  const { data, error } = await supabase
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('case_number', caseNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUserHistory(guildId, userId, { limit = 25 } = {}) {
  const { data, error } = await supabase
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/** Most recent case for a user (used by /linfr). */
async function getLastCase(guildId, userId) {
  const { data, error } = await supabase
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Updates a case's reason and/or expiry (used by /modinf). Returns the updated row, or null if it didn't exist. */
async function updateCase(guildId, caseNumber, { reason, expiresAt } = {}) {
  const patch = {};
  if (reason !== undefined) patch.reason = reason;
  if (expiresAt !== undefined) patch.expires_at = expiresAt;
  if (!Object.keys(patch).length) return getCase(guildId, caseNumber);

  const { data, error } = await supabase
    .from('mod_actions')
    .update(patch)
    .eq('guild_id', guildId)
    .eq('case_number', caseNumber)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Deletes a single case by number (used by /delinf). Returns true if a row was deleted. */
async function deleteCase(guildId, caseNumber) {
  const { data, error } = await supabase
    .from('mod_actions')
    .delete()
    .eq('guild_id', guildId)
    .eq('case_number', caseNumber)
    .select('case_number');

  if (error) throw error;
  return data.length > 0;
}

/** Deletes every case for a user in a guild (used by /delinfs). Returns how many were deleted. */
async function deleteAllForUser(guildId, userId) {
  const { data, error } = await supabase
    .from('mod_actions')
    .delete()
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .select('case_number');

  if (error) throw error;
  return data.length;
}

/** Marks a case inactive — used when a mute/ban is reversed, so it stops counting as the user's current sanction. */
async function deactivateCase(guildId, caseNumber) {
  const { error } = await supabase.from('mod_actions').update({ active: false }).eq('guild_id', guildId).eq('case_number', caseNumber);
  if (error) throw error;
}

/** The user's current active sanction of any of `types` (e.g. an unexpired mute/tempmute), if any. */
async function getActiveSanction(guildId, userId, types) {
  const { data, error } = await supabase
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .in('type', types)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Every active tempban/tempmute across all guilds whose expiry has passed — polled by the expiry job. */
async function getExpiredSanctions() {
  const { data, error } = await supabase
    .from('mod_actions')
    .select('*')
    .in('type', ['tempban', 'tempmute'])
    .eq('active', true)
    .lte('expires_at', new Date().toISOString());

  if (error) throw error;
  return data;
}

module.exports = {
  createCase,
  getCase,
  getUserHistory,
  getLastCase,
  updateCase,
  deleteCase,
  deleteAllForUser,
  deactivateCase,
  getActiveSanction,
  getExpiredSanctions,
};
