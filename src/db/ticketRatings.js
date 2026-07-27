const supabase = require('./supabase');

async function addRating(guildId, ticketId, userId, rating, comment) {
  const { data, error } = await supabase
    .from('ticket_ratings')
    .upsert({ guild_id: guildId, ticket_id: ticketId, user_id: userId, rating, comment: comment ?? null }, { onConflict: 'ticket_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getRating(ticketId) {
  const { data, error } = await supabase.from('ticket_ratings').select('*').eq('ticket_id', ticketId).maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { addRating, getRating };
