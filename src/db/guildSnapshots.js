const database = require('./database');

async function saveSnapshot(row) {
  const { error } = await database.from('discord_guild_snapshots').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) throw error;
}

async function deleteSnapshots(guildIds) {
  const ids = [...guildIds].map(String);
  if (!ids.length) return;
  const { error } = await database.from('discord_guild_snapshots').delete().in('guild_id', ids);
  if (error) throw error;
}

async function listSnapshotIds() {
  const { data, error } = await database.from('discord_guild_snapshots').select('guild_id');
  if (error) throw error;
  return (data ?? []).map((row) => String(row.guild_id));
}

module.exports = { saveSnapshot, deleteSnapshots, listSnapshotIds };
