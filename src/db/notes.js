const database = require('./database');

async function addNote({ guildId, userId, moderatorId, note }) {
  const { data, error } = await database
    .from('notes')
    .insert({ guild_id: guildId, user_id: userId, moderator_id: moderatorId, note })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getNote(guildId, noteId) {
  const { data, error } = await database.from('notes').select('*').eq('guild_id', guildId).eq('id', noteId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getNotesForUser(guildId, userId) {
  const { data, error } = await database
    .from('notes')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function removeNote(guildId, noteId) {
  const { data, error } = await database.from('notes').delete().eq('guild_id', guildId).eq('id', noteId).select('*');
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Deletes every note of a member. Returns how many there were. */
async function clearNotes(guildId, userId) {
  const { data, error } = await database.from('notes').delete().eq('guild_id', guildId).eq('user_id', userId).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

module.exports = { addNote, getNote, getNotesForUser, removeNote, clearNotes };
