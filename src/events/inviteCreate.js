const { Events } = require('discord.js');
const { handleInviteCreate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.InviteCreate,
  execute(invite, client) {
    return handleInviteCreate(invite, client).catch((err) => logger.error('[inviteCreate]', err));
  },
};
