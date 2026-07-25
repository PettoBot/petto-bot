const { Events } = require('discord.js');
const { handleBanAdd } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildBanAdd,
  execute(ban, client) {
    return handleBanAdd(ban, client).catch((err) => logger.error('[guildBanAdd]', err));
  },
};
