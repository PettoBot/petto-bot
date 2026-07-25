const { Events } = require('discord.js');
const { handleEmojiDelete } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildEmojiDelete,
  execute(emoji, client) {
    return handleEmojiDelete(emoji, client).catch((err) => logger.error('[emojiDelete]', err));
  },
};
