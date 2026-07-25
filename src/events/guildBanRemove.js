const { Events } = require('discord.js');
const { handleBanRemove } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildBanRemove,
  execute(ban, client) {
    return handleBanRemove(ban, client).catch((err) => logger.error('[guildBanRemove]', err));
  },
};
