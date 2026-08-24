const supabase = require('./supabase');
const vault = require('./vault');

async function createBackup(guildId, createdBy, label, snapshot, source = 'manual') {
  if (vault.isConfigured()) return vault.createBackup(guildId, createdBy, label, snapshot, source);
  const { data, error } = await supabase.rpc('create_guild_backup', {
    p_guild_id: guildId,
    p_created_by: createdBy,
    p_label: label || '',
    p_source: source,
    p_snapshot: snapshot,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function listBackups(guildId, limit = 10) {
  if (vault.isConfigured()) return vault.listBackups(guildId, limit);
  const { data, error } = await supabase
    .from('guild_backups')
    .select('backup_number, id, label, source, created_by, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getBackup(guildId, backupNumber = null) {
  if (vault.isConfigured()) return vault.getBackup(guildId, backupNumber);
  let query = supabase.from('guild_backups').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1);
  if (backupNumber) query = supabase.from('guild_backups').select('*').eq('guild_id', guildId).eq('backup_number', backupNumber).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function recordAudit(guildId, actorId, action, backupNumber = null, metadata = {}) {
  if (vault.isConfigured()) {
    await vault.recordAudit(guildId, actorId, action, backupNumber, metadata);
    return true;
  }

  const { error } = await supabase.from('guild_backup_audit').insert({
    guild_id: guildId,
    actor_id: actorId,
    action,
    backup_number: backupNumber,
    metadata,
  });
  if (error) throw error;
  return true;
}

async function listAudit(guildId, limit = 10) {
  if (vault.isConfigured()) return vault.listAudit(guildId, limit);
  const { data, error } = await supabase
    .from('guild_backup_audit')
    .select('id, actor_id, action, backup_number, metadata, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

module.exports = { createBackup, listBackups, getBackup, recordAudit, listAudit, vault };
