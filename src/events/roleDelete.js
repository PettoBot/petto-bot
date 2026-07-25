const { Events } = require('discord.js');
const { handleRoleDelete } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleDelete,
  execute(role, client) {
    return handleRoleDelete(role, client).catch((err) => logger.error('[roleDelete]', err));
  },
};
