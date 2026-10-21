// The reads of the live tickets on the dashboard (src/web/ticketLiveRoutes.js). Only the columns the live view shows: a ticket that had
// a transcript made while it was open carries its whole HTML in `transcript_html`, which is never read here.
const database = require('./database');

const TICKET_COLUMNS = 'id,guild_id,ticket_number,category_id,channel_id,opener_id,claimed_by,status,priority,created_at,closed_at,last_activity_at,staff_message_count';
const MAX_OPEN = 100;

/** The open tickets of a server, newest first (at most 100). */
async function listOpenTickets(guildId) {
  const { data, error } = await database.from('tickets').select(TICKET_COLUMNS).eq('guild_id', guildId).eq('status', 'open').order('created_at', { ascending: false }).limit(MAX_OPEN);
  if (error) throw error;
  return data ?? [];
}

/** One ticket of a server by its number, open or closed. */
async function getTicket(guildId, number) {
  const { data, error } = await database.from('tickets').select(TICKET_COLUMNS).eq('guild_id', guildId).eq('ticket_number', number).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The ticket types of a server: what the list shows of them and who their staff is. */
async function listCategories(guildId) {
  const { data, error } = await database.from('ticket_categories').select('id,label,emoji,support_role_ids').eq('guild_id', guildId);
  if (error) throw error;
  return data ?? [];
}

module.exports = { listOpenTickets, getTicket, listCategories, MAX_OPEN };
