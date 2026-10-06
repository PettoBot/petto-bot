const { Events } = require('discord.js');
const { handleSound } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildSoundboardSoundDelete,
  execute(sound, client) {
    return handleSound('delete', sound, null, client).catch((err) => logger.error('[soundboardDelete]', err));
  },
};
