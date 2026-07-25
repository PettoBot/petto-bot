const supabase = require('./supabase');

async function addNote({ guildId, userId, moderatorId, note }) {
  const { data, error } = await supabase
    .from('notes')
    .insert({ guild_id: guildId, user_id: userId, moderator_id: moderatorId, note })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getNote(guildId, noteId) {
  const { data, error } = await supabase.from('notes').select('*').eq('guild_id', guildId).eq('id', noteId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getNotesForUser(guildId, userId) {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

module.exports = { addNote, getNote, getNotesForUser };
