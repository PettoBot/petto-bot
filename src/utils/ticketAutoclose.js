const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('./ticketActions');
const logger = require('./logger');

/** Closes every open ticket, in every guild with autoclose-by-inactivity on, whose last message is older than that guild's configured threshold. */
async function checkTicketAutoclose(client) {
  for (const guild of client.guilds.cache.values()) {
    let settings;
    try {
      settings = await settingsDb.getSettings(guild.id);
    } catch (err) {
      logger.error(`Ticket autoclose: failed to load settings for guild ${guild.id}:`, err);
      continue;
    }
    if (!settings.autoclose_inactivity_enabled) continue;

    const cutoff = Date.now() - settings.autoclose_inactivity_hours * 60 * 60 * 1000;
    let openTickets;
    try {
      openTickets = await db.listOpenTicketsForGuild(guild.id);
    } catch (err) {
      logger.error(`Ticket autoclose: failed to list open tickets for guild ${guild.id}:`, err);
      continue;
    }

    for (const ticket of openTickets) {
      if (!ticket.channel_id) continue;
      if (new Date(ticket.last_activity_at).getTime() > cutoff) continue;

      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) continue;

      await actions
        .closeTicket({ guild, client, channel, ticket, actor: client.user, reason: `Automatically closed after ${settings.autoclose_inactivity_hours}h of inactivity.` })
        .catch((err) => logger.error(`Ticket #${ticket.ticket_number}: inactivity autoclose failed:`, err));
    }
  }
}

module.exports = { checkTicketAutoclose };
