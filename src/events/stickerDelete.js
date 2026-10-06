const { Events } = require('discord.js');
const { handleStickerDelete } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildStickerDelete,
  execute(sticker, client) {
    return handleStickerDelete(sticker, client).catch((err) => logger.error('[stickerDelete]', err));
  },
};
