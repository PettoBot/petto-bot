const { Events } = require('discord.js');
const { handleSound } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildSoundboardSoundUpdate,
  execute(oldSound, sound, client) {
    return handleSound('update', sound, oldSound, client).catch((err) => logger.error('[soundboardUpdate]', err));
  },
};
