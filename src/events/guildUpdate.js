const { Events } = require('discord.js');
const { handleGuildUpdate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildUpdate,
  execute(oldGuild, newGuild, client) {
    return handleGuildUpdate(oldGuild, newGuild, client).catch((err) => logger.error('[guildUpdate]', err));
  },
};
