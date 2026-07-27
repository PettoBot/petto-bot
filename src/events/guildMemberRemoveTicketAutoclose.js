const { Events } = require('discord.js');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('../utils/ticketActions');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      const settings = await settingsDb.getSettings(member.guild.id);
      if (!settings.autoclose_leave) return;

      const open = await db.listOpenTicketsByOpener(member.guild.id, member.id);
      for (const ticket of open) {
        if (!ticket.channel_id) continue;
        const channel = await member.guild.channels.fetch(ticket.channel_id).catch(() => null);
        if (!channel) continue;
        await actions
          .closeTicket({ guild: member.guild, client: member.client, channel, ticket, actor: member.client.user, reason: 'Automatically closed: the ticket opener left the server.' })
          .catch((err) => logger.error(`Ticket #${ticket.ticket_number}: autoclose-on-leave failed:`, err));
      }
    } catch (err) {
      logger.error(`Ticket autoclose-on-leave failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
