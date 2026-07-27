const { Events } = require('discord.js');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const actions = require('../utils/ticketActions');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    try {
      const settings = await settingsDb.getSettings(message.guild.id);
      // Nothing reads last_activity_at/staff_message_count unless one of these is on, skip the
      // per-message ticket lookup entirely for the common case (most guilds have neither).
      if (!settings.autoclose_inactivity_enabled && !settings.log_staff_message_counts) return;

      const ticket = await db.getTicketByChannel(message.channel.id);
      if (!ticket || ticket.status !== 'open') return;

      let staffMessage = false;
      if (settings.log_staff_message_counts) {
        const category = await db.getCategoryById(ticket.category_id);
        staffMessage = Boolean(category && actions.isStaffForCategory(message.member, category));
      }

      await db.touchActivity(ticket.id, { staffMessage });
    } catch (err) {
      logger.error('Ticket activity tracking failed:', err);
    }
  },
};
