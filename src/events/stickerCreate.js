const { Events } = require('discord.js');
const { handleStickerCreate } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildStickerCreate,
  execute(sticker, client) {
    return handleStickerCreate(sticker, client).catch((err) => logger.error('[stickerCreate]', err));
  },
};
