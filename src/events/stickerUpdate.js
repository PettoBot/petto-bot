const { Events } = require('discord.js');
const { handleStickerUpdate } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildStickerUpdate,
  execute(oldSticker, newSticker, client) {
    return handleStickerUpdate(oldSticker, newSticker, client).catch((err) => logger.error('[stickerUpdate]', err));
  },
};
