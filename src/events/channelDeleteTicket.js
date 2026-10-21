// The channel of an open ticket is deleted: the ticket is closed, so it does not stay open with no channel (see ticketChannelGone.js).
const { Events } = require('discord.js');
const { handleTicketChannelDelete } = require('../utils/ticketChannelGone');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    try {
      await handleTicketChannelDelete(channel);
    } catch (error) {
      logger.warn(`[tickets] could not close the ticket of a deleted channel ${channel?.id}: ${error?.message ?? error}`);
    }
  },
};
