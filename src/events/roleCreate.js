const { Events } = require('discord.js');
const { handleRoleCreate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleCreate,
  execute(role, client) {
    return handleRoleCreate(role, client).catch((err) => logger.error('[roleCreate]', err));
  },
};
