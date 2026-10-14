const database = require('./database');

/**
 * Creates a numbered moderation case (ban/kick/mute/unmute/unban/tempban/tempmute/warn).
 * Case numbering is handled atomically in Postgres (see create_mod_case in
 * schema.sql) so concurrent actions in the same guild never collide.
 */
async function createCase({ guildId, userId, moderatorId, type, reason = null, expiresAt = null, source = 'moderator' }) {
  const { data, error } = await database.rpc('create_mod_case', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_moderator_id: moderatorId,
    p_type: type,
    p_reason: reason,
    p_expires_at: expiresAt,
    p_source: source,
  });

  if (error) throw error;
  return data;
}

async function getCase(guildId, caseNumber) {
  const { data, error } = await database
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('case_number', caseNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUserHistory(guildId, userId, { limit = 25 } = {}) {
  const { data, error } = await database
    .from('mod_actions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Returns one page of moderation cases for a guild. If userId is provided the
 * page is filtered to that user; otherwise it is the complete server history.
 */
async function getCaseHistory(guildId, { userId = null, limit = 10, offset = 0 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);

  let query = database
    .from('mod_actions')
    .select('*', { count: 'exact' })
    .eq('guild_id', guildId)
    .order('case_number', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (userId) query = query.eq('user_id', userId);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

/** Most recent case for a user (used by /linfr). */
async function getLastCase(guildId, userId) {
  const { data, error } = await database
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

  const { data, error } = await database
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
  // A warning has a dedicated row as well as its numbered case. Keep the
  // warning inactive before deleting the visible case, otherwise escalation
  // counts would continue to include a warning that staff can no longer see.
  const { error: warnError } = await database
    .from('warns')
    .update({ active: false })
    .eq('guild_id', guildId)
    .eq('case_number', caseNumber);
  if (warnError) throw warnError;

  const { data, error } = await database
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
  const { error: warnError } = await database
    .from('warns')
    .update({ active: false })
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (warnError) throw warnError;

  const { data, error } = await database
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
  const { error } = await database.from('mod_actions').update({ active: false }).eq('guild_id', guildId).eq('case_number', caseNumber);
  if (error) throw error;
}

/** The user's current active sanction of any of `types` (e.g. an unexpired mute/tempmute), if any. */
async function getActiveSanction(guildId, userId, types) {
  const { data, error } = await database
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
  const { data, error } = await database
    .from('mod_actions')
    .select('*')
    .in('type', ['tempban', 'tempmute'])
    .eq('active', true)
    .lte('expires_at', new Date().toISOString());

  if (error) throw error;
  return data;
}

/** Cases filtered by user, moderator, type and a word of the reason, newest first. The word is matched here so it never reaches a query. */
async function searchCases(guildId, { userId = null, moderatorId = null, type = null, text = null, limit = 10 } = {}) {
  let query = database.from('mod_actions').select('*').eq('guild_id', guildId).order('case_number', { ascending: false }).limit(text ? 500 : Math.min(50, Math.max(1, limit)));
  if (userId) query = query.eq('user_id', userId);
  if (moderatorId) query = query.eq('moderator_id', moderatorId);
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) throw error;
  const needle = text ? String(text).toLowerCase() : null;
  const rows = needle ? (data ?? []).filter((row) => String(row.reason ?? '').toLowerCase().includes(needle)) : data ?? [];
  return rows.slice(0, Math.min(50, Math.max(1, limit)));
}

/** Adds a link to the proof of a case (at most 10 per case). Answers the case, or null when it does not exist. */
async function addEvidence(guildId, caseNumber, url) {
  const row = await getCase(guildId, caseNumber);
  if (!row) return null;
  const evidence = [...new Set([...(row.evidence ?? []), url])].slice(0, 10);
  const { data, error } = await database.from('mod_actions').update({ evidence }).eq('guild_id', guildId).eq('case_number', caseNumber).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function clearEvidence(guildId, caseNumber) {
  const { data, error } = await database.from('mod_actions').update({ evidence: [] }).eq('guild_id', guildId).eq('case_number', caseNumber).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/** What each moderator did in the last `days`: totals by moderator and by type. Automatic cases (the bot itself) are counted apart. */
async function moderatorStats(guildId, days = 30, botId = null) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await database.from('mod_actions').select('type, source, moderator_id').eq('guild_id', guildId).gte('created_at', from).limit(20000);
  if (error) throw error;
  const byModerator = new Map();
  const byType = {};
  let automatic = 0;
  for (const row of data ?? []) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    if (row.moderator_id === botId || (row.source && row.source !== 'moderator')) { automatic += 1; continue; }
    byModerator.set(row.moderator_id, (byModerator.get(row.moderator_id) ?? 0) + 1);
  }
  return { total: (data ?? []).length, automatic, byType, moderators: [...byModerator.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count) };
}

module.exports = {
  searchCases,
  addEvidence,
  clearEvidence,
  moderatorStats,
  createCase,
  getCase,
  getUserHistory,
  getCaseHistory,
  getLastCase,
  updateCase,
  deleteCase,
  deleteAllForUser,
  deactivateCase,
  getActiveSanction,
  getExpiredSanctions,
};
