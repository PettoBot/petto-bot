const database = require('./database');

/**
 * Saves the rating of a ticket once: a ticket has one rating (unique ticket_id), and a second click or a second modal does not
 * change it. Returns `{ created, rating }`: the new row, or the one that was already there.
 */
async function addRating(guildId, ticketId, userId, rating, comment) {
  const { data, error } = await database
    .from('ticket_ratings')
    .upsert({ guild_id: guildId, ticket_id: ticketId, user_id: userId, rating, comment: comment ?? null }) // ON CONFLICT DO NOTHING
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return { created: true, rating: data };
  return { created: false, rating: await getRating(ticketId) };
}

async function getRating(ticketId) {
  const { data, error } = await database.from('ticket_ratings').select('*').eq('ticket_id', ticketId).maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { addRating, getRating };
