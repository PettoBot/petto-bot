const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('./ticketActions');
const logger = require('./logger');
const config = require('../config');
const { forEachWithConcurrency } = require('./concurrency');
const { t, guildLanguage } = require('../i18n');

/** Closes every open ticket, in every guild with autoclose-by-inactivity on, whose last message is older than that guild's configured threshold. */
async function checkTicketAutoclose(client) {
  const enabledGuilds = await settingsDb.listAutocloseEnabled();
  await forEachWithConcurrency(enabledGuilds, async (row) => {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) return;
    const settings = { ...settingsDb.DEFAULTS, ...row, guild_id: row.guild_id };

    const cutoff = Date.now() - settings.autoclose_inactivity_hours * 60 * 60 * 1000;
    let openTickets;
    try {
      openTickets = await db.listOpenTicketsForGuild(guild.id);
    } catch (err) {
      logger.error(`Ticket autoclose: failed to list open tickets for guild ${guild.id}:`, err);
      return;
    }

    // Jobs run outside any server: the close reason is written in the language of this server.
    const lang = await guildLanguage(guild.id);
    for (const ticket of openTickets) {
      if (!ticket.channel_id) continue;
      if (new Date(ticket.last_activity_at).getTime() > cutoff) continue;

      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) continue;

      await actions
        .closeTicket({ guild, client, channel, ticket, actor: client.user, reason: t(lang, 'tickets.autoclose.inactivity', { hours: settings.autoclose_inactivity_hours }) })
        .catch((err) => logger.error(`Ticket #${ticket.ticket_number}: inactivity autoclose failed:`, err));
    }
  }, config.jobConcurrency);
}

module.exports = { checkTicketAutoclose };
