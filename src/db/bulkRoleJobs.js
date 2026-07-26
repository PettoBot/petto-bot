const supabase = require('./supabase');

async function createJob(row) {
  const { data, error } = await supabase.from('bulk_role_jobs').insert({ ...row, status: 'pending' }).select('*').single();
  if (error) throw error;
  return data;
}

/** The one job a guild cares about right now: whatever's pending/running, else the most recent finished one. */
async function getLatestJob(guildId) {
  const { data: active, error: activeError } = await supabase
    .from('bulk_role_jobs').select('*').eq('guild_id', guildId).in('status', ['pending', 'running']).maybeSingle();
  if (activeError) throw activeError;
  if (active) return active;

  const { data: last, error: lastError } = await supabase
    .from('bulk_role_jobs').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw lastError;
  return last;
}

async function getJob(id) {
  const { data, error } = await supabase.from('bulk_role_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function hasActiveJob(guildId) {
  const { data, error } = await supabase.from('bulk_role_jobs').select('id').eq('guild_id', guildId).in('status', ['pending', 'running']).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function listPending() {
  const { data, error } = await supabase.from('bulk_role_jobs').select('*').eq('status', 'pending').order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function updateJob(id, patch) {
  const { error } = await supabase.from('bulk_role_jobs').update(patch).eq('id', id);
  if (error) throw error;
}

async function cancelJob(id, guildId) {
  const { error } = await supabase.from('bulk_role_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', id).eq('guild_id', guildId).in('status', ['pending', 'running']);
  if (error) throw error;
}

module.exports = { createJob, getLatestJob, getJob, hasActiveJob, listPending, updateJob, cancelJob };
