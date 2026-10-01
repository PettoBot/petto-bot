const database = require('./database');

const REPORT_STATUSES = ['open', 'claimed', 'resolved', 'dismissed'];

async function getConfig(guildId) {
  const { data, error } = await database.from('report_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('report_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** Stores a new report and gives it the next number of the server. */
async function createReport({ guildId, reporterId, reportedUserId, category = 'other', reason = null, sourceChannelId = null, messageLink = null, messageContent = null, imageUrls = [], anonymous = false, urgent = false }) {
  const { data, error } = await database.rpc('create_report', {
    p_guild_id: guildId,
    p_reporter_id: reporterId,
    p_reported_user_id: reportedUserId,
    p_category: category,
    p_reason: reason,
    p_source_channel_id: sourceChannelId,
    p_message_link: messageLink,
    p_message_content: messageContent,
    p_image_urls: imageUrls,
    p_anonymous: anonymous,
    p_urgent: urgent,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function getReport(guildId, reportNumber) {
  const { data, error } = await database.from('reports').select('*').eq('guild_id', guildId).eq('report_number', reportNumber).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateReport(guildId, reportNumber, patch) {
  const { data, error } = await database
    .from('reports')
    .update(patch)
    .eq('guild_id', guildId)
    .eq('report_number', reportNumber)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Removes a report that never made it to the report channel, so a failed delivery leaves no ghost entry. */
async function deleteReport(guildId, reportNumber) {
  const { error } = await database.from('reports').delete().eq('guild_id', guildId).eq('report_number', reportNumber);
  if (error) throw error;
}

/** One page of reports, newest first, optionally limited to one status or to reports about one user. */
async function listReports(guildId, { status = null, reportedUserId = null, limit = 10, offset = 0 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  let query = database
    .from('reports')
    .select('*', { count: 'exact' })
    .eq('guild_id', guildId)
    .order('report_number', { ascending: false })
    .range(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + safeLimit - 1);
  if (status) query = query.eq('status', status);
  if (reportedUserId) query = query.eq('reported_user_id', reportedUserId);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

/** Counts of reports by status, plus how many arrived in the last week. */
async function getReportStats(guildId) {
  const { data, error } = await database.from('reports').select('status, created_at, reported_user_id').eq('guild_id', guildId);
  if (error) throw error;
  const rows = data ?? [];
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const byStatus = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0]));
  const perUser = new Map();
  let lastWeek = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (new Date(row.created_at).getTime() >= weekAgo) lastWeek += 1;
    perUser.set(row.reported_user_id, (perUser.get(row.reported_user_id) ?? 0) + 1);
  }
  const mostReported = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([userId, count]) => ({ userId, count }));
  return { total: rows.length, lastWeek, byStatus, mostReported };
}

/** How many reports a member sent since a point in time, and when the latest one was sent (for cooldown and daily limit). */
async function getReporterActivity(guildId, reporterId, sinceMs) {
  const { data, error } = await database
    .from('reports')
    .select('created_at')
    .eq('guild_id', guildId)
    .eq('reporter_id', reporterId)
    .gte('created_at', new Date(sinceMs).toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return { count: rows.length, lastAt: rows[0] ? new Date(rows[0].created_at).getTime() : null };
}

async function getBlock(guildId, userId) {
  const { data, error } = await database.from('report_blocked_users').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function addBlock(guildId, userId, blockedBy, reason = null) {
  const { data, error } = await database
    .from('report_blocked_users')
    .upsert({ guild_id: guildId, user_id: userId, blocked_by: blockedBy, reason }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeBlock(guildId, userId) {
  const { data, error } = await database.from('report_blocked_users').delete().eq('guild_id', guildId).eq('user_id', userId).select('user_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function listBlocks(guildId, limit = 25) {
  const { data, error } = await database.from('report_blocked_users').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

module.exports = {
  REPORT_STATUSES,
  getConfig,
  upsertConfig,
  createReport,
  getReport,
  updateReport,
  deleteReport,
  listReports,
  getReportStats,
  getReporterActivity,
  getBlock,
  addBlock,
  removeBlock,
  listBlocks,
};
