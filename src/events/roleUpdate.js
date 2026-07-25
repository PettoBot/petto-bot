const { Events } = require('discord.js');
const { handleRoleUpdate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleUpdate,
  execute(oldRole, newRole, client) {
    return handleRoleUpdate(oldRole, newRole, client).catch((err) => logger.error('[roleUpdate]', err));
  },
};
