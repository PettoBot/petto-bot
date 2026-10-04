const database = require('./database');

async function saveSnapshot(row) {
  // The PostgreSQL driver turns a JavaScript array into a PostgreSQL array, not into JSON, so the two lists go in as JSON text.
  const values = { ...row, channels: JSON.stringify(row.channels ?? []), roles: JSON.stringify(row.roles ?? []), updated_at: new Date().toISOString() };
  const { error } = await database.from('discord_guild_snapshots').upsert(values, { onConflict: 'guild_id' });
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
