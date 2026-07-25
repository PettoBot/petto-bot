const { Events } = require('discord.js');
const { handleEmojiUpdate } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildEmojiUpdate,
  execute(oldEmoji, newEmoji, client) {
    return handleEmojiUpdate(oldEmoji, newEmoji, client).catch((err) => logger.error('[emojiUpdate]', err));
  },
};
