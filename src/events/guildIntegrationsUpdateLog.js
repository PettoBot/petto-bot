const { Events } = require('discord.js');
const { handleIntegrationsUpdate } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildIntegrationsUpdate,
  execute(guild, client) {
    return handleIntegrationsUpdate(guild, client).catch((err) => logger.error('[guildIntegrationsUpdateLog]', err));
  },
};
