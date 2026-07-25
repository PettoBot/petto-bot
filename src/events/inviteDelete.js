const { Events } = require('discord.js');
const { handleInviteDelete } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.InviteDelete,
  execute(invite, client) {
    return handleInviteDelete(invite, client).catch((err) => logger.error('[inviteDelete]', err));
  },
};
