const { Events } = require('discord.js');
const { handleSound } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildSoundboardSoundCreate,
  execute(sound, client) {
    return handleSound('create', sound, null, client).catch((err) => logger.error('[soundboardCreate]', err));
  },
};
