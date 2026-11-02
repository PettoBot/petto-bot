const database = require('./database');

async function createJob(row) {
  const { data, error } = await database.from('bulk_role_jobs').insert({ ...row, status: 'pending' }).select('*').single();
  if (error) throw error;
  return data;
}

/** The one job a guild cares about right now: whatever's pending/running, else the most recent finished one. */
async function getLatestJob(guildId) {
  const { data: active, error: activeError } = await database
    .from('bulk_role_jobs').select('*').eq('guild_id', guildId).in('status', ['pending', 'running']).maybeSingle();
  if (activeError) throw activeError;
  if (active) return active;

  const { data: last, error: lastError } = await database
    .from('bulk_role_jobs').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw lastError;
  return last;
}

async function getJob(id) {
  const { data, error } = await database.from('bulk_role_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function hasActiveJob(guildId) {
  const { data, error } = await database.from('bulk_role_jobs').select('id').eq('guild_id', guildId).in('status', ['pending', 'running']).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function listPending() {
  const { data, error } = await database.from('bulk_role_jobs').select('*').eq('status', 'pending').order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function updateJob(id, patch) {
  const { error } = await database.from('bulk_role_jobs').update(patch).eq('id', id);
  if (error) throw error;
}

/** The pending or running job of a guild, or null. */
async function getActiveJob(guildId) {
  const { data, error } = await database.from('bulk_role_jobs').select('*').eq('guild_id', guildId).in('status', ['pending', 'running']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/** The latest jobs of a guild, newest first (previews included). */
async function listRecent(guildId, limit = 5) {
  const { data, error } = await database.from('bulk_role_jobs').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** At start-up a job that was `running` was cut by a restart: it goes back to the queue and goes on from its cursor. Returns how many. */
async function requeueRunning() {
  const { data, error } = await database.from('bulk_role_jobs').update({ status: 'pending' }).eq('status', 'running').select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Ends a job that is still running (a job cancelled meanwhile stays cancelled). */
async function finishJob(id, patch) {
  const { error } = await database.from('bulk_role_jobs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running');
  if (error) throw error;
}

async function setPaused(id, guildId, paused) {
  const { data, error } = await database.from('bulk_role_jobs').update({ paused }).eq('id', id).eq('guild_id', guildId).in('status', ['pending', 'running']).select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function cancelJob(id, guildId) {
  const { error } = await database.from('bulk_role_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', id).eq('guild_id', guildId).in('status', ['pending', 'running']);
  if (error) throw error;
}

module.exports = { createJob, getLatestJob, getJob, getActiveJob, listRecent, hasActiveJob, listPending, requeueRunning, finishJob, setPaused, updateJob, cancelJob };
